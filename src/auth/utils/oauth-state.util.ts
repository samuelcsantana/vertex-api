import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { OAuthStateMismatchException } from '../exceptions/oauth-state.exceptions';

export type OAuthProvider = 'google' | 'github';

// Long enough to read a consent screen and type a password and a second
// factor; short enough that an abandoned attempt stops mattering soon.
const OAUTH_ATTEMPT_MAX_AGE_SECONDS = 10 * 60;

/**
 * The two secrets one authorization request needs to keep between sending the
 * visitor to the provider and the provider sending them back.
 *
 * `state` is the CSRF defence of the authorization-code flow (RFC 6749
 * §10.12, RFC 9700 §4.7). Without it the callback cannot tell a response to a
 * request this browser made from one it never made, so an attacker can drive
 * the victim's browser through the callback with the attacker's own
 * authorization code and leave the victim signed in to the attacker's account.
 *
 * `codeVerifier` is PKCE (RFC 7636, RECOMMENDED for confidential clients by
 * RFC 9700 §2.1.1). The provider is only shown its SHA-256 on the way out and
 * must see the verifier itself at the token exchange, so an authorization code
 * that leaks from someone else's redirect cannot be injected into a callback
 * here (RFC 9700 §4.5): this browser's verifier won't match it.
 */
export interface OAuthAttempt {
  state: string;
  codeVerifier: string;
}

// What the OAuth guards hand to passport-oauth2. `state` as a string is
// sent as-is in the authorization URL; the two PKCE values are picked up by
// the strategies' authorizationParams/tokenParams overrides.
export type OAuthAuthenticateOptions = {
  state?: string;
  codeChallenge?: string;
  codeVerifier?: string;
};

function cookieName(provider: OAuthProvider): string {
  return `oauth_state_${provider}`;
}

// The browser only ever sends the cookie back to the callback route — the
// path of GOOGLE_CALLBACK_URL / GITHUB_CALLBACK_URL — and to nothing else on
// this API.
function cookiePath(provider: OAuthProvider): string {
  return `/auth/${provider}/callback`;
}

export function createOAuthAttempt(): OAuthAttempt {
  // 32 bytes from the CSPRNG encode to 43 base64url characters: the minimum
  // verifier length RFC 7636 §4.1 allows, and far past guessable for state.
  return {
    state: randomBytes(32).toString('base64url'),
    codeVerifier: randomBytes(32).toString('base64url'),
  };
}

// S256 from RFC 7636 §4.2. GitHub accepts no other method, and `plain` would
// put the verifier itself in the authorization URL.
export function codeChallengeFor(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

export function statesMatch(expected: string, provided: unknown): boolean {
  if (typeof provided !== 'string') {
    return false;
  }

  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);

  // timingSafeEqual throws on a length difference. The length of a random
  // state is no secret, so comparing it first gives nothing away.
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

export function pkceAuthorizationParams(
  options: OAuthAuthenticateOptions,
): Record<string, string> {
  return options.codeChallenge
    ? { code_challenge: options.codeChallenge, code_challenge_method: 'S256' }
    : {};
}

export function pkceTokenParams(
  options: OAuthAuthenticateOptions,
): Record<string, string> {
  return options.codeVerifier ? { code_verifier: options.codeVerifier } : {};
}

/**
 * Stores the attempt in a cookie on the redirect to the provider.
 *
 * Written to the raw Node response on purpose. passport-oauth2 sends that
 * redirect with `res.setHeader` + `res.end`, which the OAuth guards bind to
 * `reply.raw`, so Fastify's `onSend` hooks never run for it — and
 * `reply.setCookie` only queues a cookie for one of those hooks. Through
 * Fastify, this cookie would be silently dropped.
 *
 * Signed with COOKIE_SECRET so that a cookie planted from elsewhere (a
 * sibling subdomain can set cookies this host receives) cannot supply a
 * state the attacker already knows. SameSite=Lax rather than Strict because
 * the provider's redirect back is a cross-site top-level navigation, which
 * Lax still sends the cookie on and Strict would not.
 */
function rememberOAuthAttempt(
  reply: FastifyReply,
  provider: OAuthProvider,
  attempt: OAuthAttempt,
): void {
  // base64url never contains '.', so the pair splits back unambiguously.
  const value = reply.signCookie(`${attempt.state}.${attempt.codeVerifier}`);

  reply.raw.appendHeader(
    'Set-Cookie',
    reply.server.serializeCookie(cookieName(provider), value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: cookiePath(provider),
      maxAge: OAUTH_ATTEMPT_MAX_AGE_SECONDS,
    }),
  );
}

/**
 * Reads the attempt back on the callback and clears it whatever it holds: an
 * attempt is good for exactly one callback, so the same callback URL arriving
 * a second time finds nothing to match against.
 *
 * Unlike the redirect out, every callback response goes through Fastify's
 * own send path (a redirect from the controller or from an exception filter),
 * so the ordinary clearCookie is enough here.
 */
function takeOAuthAttempt(
  request: FastifyRequest,
  reply: FastifyReply,
  provider: OAuthProvider,
): OAuthAttempt | null {
  const signedValue = request.cookies?.[cookieName(provider)];

  reply.clearCookie(cookieName(provider), { path: cookiePath(provider) });

  if (!signedValue) {
    return null;
  }

  const unsigned = request.unsignCookie(signedValue);

  if (!unsigned.valid || !unsigned.value) {
    return null;
  }

  const [state, codeVerifier, ...rest] = unsigned.value.split('.');

  if (!state || !codeVerifier || rest.length > 0) {
    return null;
  }

  return { state, codeVerifier };
}

/**
 * What the OAuth guard passes to passport for this request.
 *
 * One guard serves both the route that sends the visitor to the provider and
 * the callback the provider sends them back to, so this branches the way
 * passport-oauth2 itself does: a `code` in the query is a callback, an
 * `error` is the provider reporting a failure, and anything else starts a new
 * attempt. Throwing here happens before passport runs, so an authorization
 * code that arrives with the wrong state is never exchanged.
 */
export function oauthAuthenticateOptions(
  provider: OAuthProvider,
  request: FastifyRequest,
  reply: FastifyReply,
): OAuthAuthenticateOptions {
  const query = (request.query ?? {}) as Record<string, unknown>;

  // The visitor declined, or the provider refused. passport fails the login
  // exactly as it did before state existed. The cookie is left alone: an
  // error response proves nothing about who sent it, and it expires anyway.
  if (query.error) {
    return {};
  }

  if (query.code) {
    const attempt = takeOAuthAttempt(request, reply, provider);

    if (!attempt || !statesMatch(attempt.state, query.state)) {
      throw new OAuthStateMismatchException();
    }

    return { codeVerifier: attempt.codeVerifier };
  }

  const attempt = createOAuthAttempt();
  rememberOAuthAttempt(reply, provider, attempt);

  return {
    state: attempt.state,
    codeChallenge: codeChallengeFor(attempt.codeVerifier),
  };
}
