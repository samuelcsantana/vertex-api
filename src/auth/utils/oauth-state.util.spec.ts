import { fastifyCookie, sign, unsign } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  codeChallengeFor,
  createOAuthAttempt,
  oauthAuthenticateOptions,
  OAuthAuthenticateOptions,
  pkceAuthorizationParams,
  pkceTokenParams,
  statesMatch,
} from './oauth-state.util';
import { OAuthStateMismatchException } from '../exceptions/oauth-state.exceptions';

const COOKIE_SECRET = 'test-cookie-secret-test-cookie-secret';
const COOKIE_NAME = 'oauth_state_google';

// Just enough of a browser to carry the state cookie between the redirect out
// and the callback: it keeps what the API sets and forgets what it clears.
// The request/reply fakes use @fastify/cookie's real signer, so a value this
// test tampers with fails the same check it would fail in production.
function createBrowser() {
  const jar = new Map<string, string>();
  const setCookieHeaders: string[] = [];

  function request(query: Record<string, unknown>): FastifyRequest {
    return {
      query,
      cookies: Object.fromEntries(jar),
      unsignCookie: (value: string) => unsign(value, COOKIE_SECRET),
    } as unknown as FastifyRequest;
  }

  function reply(): FastifyReply {
    return {
      raw: {
        appendHeader: (_name: string, header: string) => {
          setCookieHeaders.push(header);
          const [pair] = header.split(';');
          const separator = pair.indexOf('=');
          jar.set(
            pair.slice(0, separator),
            decodeURIComponent(pair.slice(separator + 1)),
          );
        },
      },
      server: { serializeCookie: fastifyCookie.serialize },
      signCookie: (value: string) => sign(value, COOKIE_SECRET),
      clearCookie: (name: string) => jar.delete(name),
    } as unknown as FastifyReply;
  }

  function visit(query: Record<string, unknown> = {}) {
    return oauthAuthenticateOptions('google', request(query), reply());
  }

  return { jar, setCookieHeaders, visit };
}

function startAttempt(browser: ReturnType<typeof createBrowser>) {
  const options = browser.visit();

  return {
    state: options.state as string,
    codeChallenge: options.codeChallenge as string,
  };
}

describe('PKCE values', () => {
  it('derives the S256 challenge from the verifier (RFC 7636, Appendix B)', () => {
    expect(
      codeChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    ).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('creates a fresh 43-character base64url state and verifier each time', () => {
    const first = createOAuthAttempt();
    const second = createOAuthAttempt();

    for (const value of [first.state, first.codeVerifier]) {
      expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(first.state).not.toBe(first.codeVerifier);
    expect(second.state).not.toBe(first.state);
    expect(second.codeVerifier).not.toBe(first.codeVerifier);
  });

  it('adds the challenge and S256 to the authorization request', () => {
    expect(pkceAuthorizationParams({ codeChallenge: 'challenge' })).toEqual({
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
    });
    expect(pkceAuthorizationParams({})).toEqual({});
  });

  it('adds the verifier to the token request', () => {
    expect(pkceTokenParams({ codeVerifier: 'verifier' })).toEqual({
      code_verifier: 'verifier',
    });
    expect(pkceTokenParams({})).toEqual({});
  });
});

describe('statesMatch', () => {
  it('accepts an identical state', () => {
    expect(statesMatch('abc', 'abc')).toBe(true);
  });

  it('rejects a different state of the same or another length', () => {
    expect(statesMatch('abc', 'abd')).toBe(false);
    expect(statesMatch('abc', 'abcd')).toBe(false);
  });

  it('rejects a missing or repeated query parameter', () => {
    expect(statesMatch('abc', undefined)).toBe(false);
    expect(statesMatch('abc', ['abc', 'abc'])).toBe(false);
  });
});

describe('oauthAuthenticateOptions', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('on the way out to the provider', () => {
    it('sends a state and an S256 challenge, and keeps both secrets in a cookie', () => {
      const browser = createBrowser();

      const { state, codeChallenge } = startAttempt(browser);

      const [cookieState, verifier, signature] = (
        browser.jar.get(COOKIE_NAME) as string
      ).split('.');
      expect(cookieState).toBe(state);
      expect(codeChallenge).toBe(codeChallengeFor(verifier));
      expect(signature).toBeTruthy();
    });

    it('scopes the cookie to the callback, HttpOnly, Lax, ten minutes, Secure in production', () => {
      process.env = { ...originalEnv, NODE_ENV: 'production' };
      const browser = createBrowser();

      startAttempt(browser);

      const [header] = browser.setCookieHeaders;
      expect(header).toMatch(new RegExp(`^${COOKIE_NAME}=`));
      expect(header).toContain('Path=/auth/google/callback');
      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Lax');
      expect(header).toContain('Max-Age=600');
      expect(header).toContain('Secure');
    });

    it('starts a different attempt every time', () => {
      const browser = createBrowser();

      const first = startAttempt(browser);
      const second = startAttempt(browser);

      expect(second.state).not.toBe(first.state);
      expect(second.codeChallenge).not.toBe(first.codeChallenge);
    });
  });

  describe('on the callback', () => {
    it('accepts the matching state and hands passport the verifier', () => {
      const browser = createBrowser();
      const { state, codeChallenge } = startAttempt(browser);

      const options: OAuthAuthenticateOptions = browser.visit({
        code: 'authorization-code',
        state,
      });

      expect(codeChallengeFor(options.codeVerifier as string)).toBe(
        codeChallenge,
      );
    });

    it('clears the cookie once it has been read', () => {
      const browser = createBrowser();
      const { state } = startAttempt(browser);

      browser.visit({ code: 'authorization-code', state });

      expect(browser.jar.has(COOKIE_NAME)).toBe(false);
    });

    it("refuses a state that isn't this browser's — the login-CSRF case", () => {
      const browser = createBrowser();
      startAttempt(browser);

      // The attacker's own callback URL: their authorization code, and the
      // state from the attempt *they* started.
      const attacker = createBrowser();
      const { state: attackerState } = startAttempt(attacker);

      expect(() =>
        browser.visit({ code: 'attacker-code', state: attackerState }),
      ).toThrow(OAuthStateMismatchException);
      expect(browser.jar.has(COOKIE_NAME)).toBe(false);
    });

    it('refuses a callback when this browser started no attempt', () => {
      const browser = createBrowser();

      expect(() =>
        browser.visit({ code: 'authorization-code', state: 'anything' }),
      ).toThrow(OAuthStateMismatchException);
    });

    it('refuses a callback with no state parameter', () => {
      const browser = createBrowser();
      startAttempt(browser);

      expect(() => browser.visit({ code: 'authorization-code' })).toThrow(
        OAuthStateMismatchException,
      );
    });

    it('refuses the same callback URL a second time', () => {
      const browser = createBrowser();
      const { state } = startAttempt(browser);
      browser.visit({ code: 'authorization-code', state });

      expect(() =>
        browser.visit({ code: 'authorization-code', state }),
      ).toThrow(OAuthStateMismatchException);
    });

    it('refuses a cookie that was not signed with this API’s secret', () => {
      const browser = createBrowser();
      const known = createOAuthAttempt();
      // A cookie planted from elsewhere, with a state the attacker knows.
      browser.jar.set(
        COOKIE_NAME,
        sign(`${known.state}.${known.codeVerifier}`, 'some-other-secret'),
      );

      expect(() =>
        browser.visit({ code: 'attacker-code', state: known.state }),
      ).toThrow(OAuthStateMismatchException);
    });

    it('leaves a provider-reported error to passport, as before', () => {
      const browser = createBrowser();
      startAttempt(browser);

      expect(browser.visit({ error: 'access_denied' })).toEqual({});
      expect(browser.jar.has(COOKIE_NAME)).toBe(true);
    });
  });
});
