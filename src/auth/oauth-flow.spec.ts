import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import type { Profile } from 'passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleStrategy } from './strategies/google.strategy';
import { GithubStrategy } from './strategies/github.strategy';
import { DatabaseService } from '../database/database.service';
import { codeChallengeFor } from './utils/oauth-state.util';

const FRONTEND_URL = 'https://frontend.test';
const existingUser = {
  id: 'user-1',
  email: 'visitor@example.com',
  name: 'Visitor',
  avatarUrl: null,
  role: 'user' as const,
};

type TokenExchange = (
  code: string,
  params: Record<string, string>,
  callback: (err: unknown, accessToken?: string, refreshToken?: string) => void,
) => void;

// The unit tests in oauth-state.util.spec.ts fake the reply. What they cannot
// show is the part that depends on the real stack: passport-oauth2 sends the
// redirect to the provider by writing to the raw Node response, past Fastify's
// cookie hook. So this boots the real controller, guards and strategies on
// Fastify — only the database, the exchange-code store and the provider's
// HTTP endpoints are stubbed — and drives it with inject().
describe('OAuth login: state and PKCE through the real passport flow', () => {
  const originalEnv = process.env;
  let app: NestFastifyApplication;
  let exchangeToken: jest.Mock<
    ReturnType<TokenExchange>,
    Parameters<TokenExchange>
  >;
  const createOAuthExchangeCode = jest
    .fn()
    .mockResolvedValue('single-use-exchange-code');

  beforeAll(async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      FRONTEND_URL,
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GOOGLE_CALLBACK_URL: 'https://api.test/auth/google/callback',
      GITHUB_CLIENT_ID: 'github-client',
      GITHUB_CLIENT_SECRET: 'github-secret',
      GITHUB_CALLBACK_URL: 'https://api.test/auth/github/callback',
    };

    const returning = jest.fn().mockResolvedValue([existingUser]);
    const databaseService = {
      db: {
        query: {
          users: { findFirst: jest.fn().mockResolvedValue(existingUser) },
        },
        update: () => ({ set: () => ({ where: () => ({ returning }) }) }),
      },
    } as unknown as DatabaseService;

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: { createOAuthExchangeCode } },
        { provide: OtpService, useValue: {} },
        { provide: DatabaseService, useValue: databaseService },
        GoogleStrategy,
        GithubStrategy,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => false })
      .compile();

    // Google's token and userinfo endpoints, as passport-oauth2 calls them.
    const google = moduleRef.get(GoogleStrategy);
    exchangeToken = jest.fn<
      ReturnType<TokenExchange>,
      Parameters<TokenExchange>
    >((_code, _params, callback) => callback(null, 'access-token', undefined));
    (
      google as unknown as { _oauth2: { getOAuthAccessToken: TokenExchange } }
    )._oauth2.getOAuthAccessToken = exchangeToken;
    jest.spyOn(google, 'userProfile').mockImplementation((_token, done) =>
      done(null, {
        provider: 'google',
        id: 'google-123',
        displayName: 'Visitor',
        emails: [{ value: existingUser.email }],
      } satisfies Profile),
    );

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.register(cookie, { secret: 'test-cookie-secret-0123456789' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    process.env = originalEnv;
  });

  beforeEach(() => {
    exchangeToken.mockClear();
    createOAuthExchangeCode.mockClear();
  });

  function setCookies(headers: Record<string, unknown>): string[] {
    const value = headers['set-cookie'];
    if (value === undefined) return [];
    return Array.isArray(value) ? (value as string[]) : [value as string];
  }

  async function startLogin(provider: 'google' | 'github') {
    const response = await app.inject({
      method: 'GET',
      url: `/auth/${provider}`,
    });
    const location = new URL(response.headers.location as string);
    const [stateCookie] = setCookies(response.headers);
    const [cookiePair] = stateCookie.split(';');

    return { response, location, stateCookie, cookiePair };
  }

  function callback(query: string, cookieHeader?: string) {
    return app.inject({
      method: 'GET',
      url: `/auth/google/callback?${query}`,
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    });
  }

  it('sends Google a state and an S256 challenge, and sets the cookie despite the raw redirect', async () => {
    const { response, location, stateCookie } = await startLogin('google');

    expect(response.statusCode).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(location.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get('code_challenge')).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');

    expect(stateCookie).toMatch(/^oauth_state_google=/);
    expect(stateCookie).toContain('Path=/auth/google/callback');
    expect(stateCookie).toContain('HttpOnly');
    expect(stateCookie).toContain('SameSite=Lax');
    expect(stateCookie).toContain('Secure');
    expect(stateCookie).toContain('Max-Age=600');
  });

  it('sends GitHub the same, with its own cookie on its own callback path', async () => {
    const { location, stateCookie } = await startLogin('github');

    expect(`${location.origin}${location.pathname}`).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(stateCookie).toMatch(/^oauth_state_github=/);
    expect(stateCookie).toContain('Path=/auth/github/callback');
  });

  it('completes a login whose state matches, sending the verifier to the token endpoint', async () => {
    const { location, cookiePair } = await startLogin('google');
    const state = location.searchParams.get('state') as string;

    const response = await callback(
      `code=authorization-code&state=${state}`,
      cookiePair,
    );

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      `${FRONTEND_URL}/auth/callback?code=single-use-exchange-code`,
    );

    const [code, params] = exchangeToken.mock.calls[0];
    expect(code).toBe('authorization-code');
    expect(codeChallengeFor(params.code_verifier)).toBe(
      location.searchParams.get('code_challenge'),
    );

    const [cleared] = setCookies(response.headers);
    expect(cleared).toMatch(/^oauth_state_google=;/);
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('Path=/auth/google/callback');
  });

  it("refuses a callback carrying someone else's state, before exchanging the code", async () => {
    const { cookiePair } = await startLogin('google');
    const { location: attackerLocation } = await startLogin('google');

    const response = await callback(
      `code=attacker-code&state=${attackerLocation.searchParams.get('state')}`,
      cookiePair,
    );

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      `${FRONTEND_URL}/auth/callback?oauth_error=OAUTH_STATE_MISMATCH`,
    );
    expect(exchangeToken).not.toHaveBeenCalled();
    expect(createOAuthExchangeCode).not.toHaveBeenCalled();
    expect(setCookies(response.headers).join('\n')).toMatch(
      /oauth_state_google=;.*Max-Age=0/,
    );
  });

  it('refuses a callback from a browser that started no attempt', async () => {
    const response = await callback('code=attacker-code&state=forged');

    expect(response.headers.location).toBe(
      `${FRONTEND_URL}/auth/callback?oauth_error=OAUTH_STATE_MISMATCH`,
    );
    expect(exchangeToken).not.toHaveBeenCalled();
  });

  it('refuses the same callback URL a second time', async () => {
    const { location, cookiePair } = await startLogin('google');
    const query = `code=authorization-code&state=${location.searchParams.get('state')}`;

    const first = await callback(query, cookiePair);
    expect(first.headers.location).toBe(
      `${FRONTEND_URL}/auth/callback?code=single-use-exchange-code`,
    );

    // The first response cleared the cookie, so the browser has none to send.
    const replay = await callback(query);

    expect(replay.headers.location).toBe(
      `${FRONTEND_URL}/auth/callback?oauth_error=OAUTH_STATE_MISMATCH`,
    );
    expect(exchangeToken).toHaveBeenCalledTimes(1);
  });

  it('still lets passport fail a declined consent the way it always has', async () => {
    const response = await callback('error=access_denied');

    expect(response.statusCode).toBe(401);
    expect(setCookies(response.headers)).toEqual([]);
  });
});
