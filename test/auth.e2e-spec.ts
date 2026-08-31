import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TestingModule } from '@nestjs/testing';
import { like } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp } from './utils/create-test-app';
import { DatabaseService } from '../src/database/database.service';
import { users } from '../src/database/schema';
import { AuthService } from '../src/auth/auth.service';

// Runs against a real, unmocked backend — matching how this project's
// frontend E2E suite works too. Needs a real Postgres reachable via
// DATABASE_URL (docker compose up -d) and the OAuth env vars set (Google/
// GithubStrategy throw in their constructor if client ID/secret are
// missing, so the app won't even boot without them).
describe('Auth (e2e)', () => {
  let app: NestFastifyApplication;
  let moduleFixture: TestingModule;

  beforeAll(async () => {
    ({ app, moduleFixture } = await createTestApp());
  });

  afterAll(async () => {
    // Register calls below create real rows — clean up rather than let
    // throwaway users accumulate in whatever Postgres this points at on
    // every local run.
    const databaseService = moduleFixture.get(DatabaseService);
    await databaseService.db
      .delete(users)
      .where(like(users.email, 'e2e-%@example.com'));

    await app.close();
  });

  const uniqueEmail = () =>
    `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

  describe('POST /auth/register', () => {
    it('registers a new user', async () => {
      const email = uniqueEmail();

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'testpass123' });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ email });
    });

    it('rejects a duplicate email', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'testpass123' });

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'testpass123' });

      expect(response.status).toBe(409);
    });
  });

  describe('POST /auth/login', () => {
    it('logs in with valid credentials and sets an access_token cookie', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'testpass123' });

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'testpass123' });

      expect(response.status).toBe(200);
      const setCookie = response.headers['set-cookie'] as
        string[] | string | undefined;
      const cookies: string[] = Array.isArray(setCookie)
        ? setCookie
        : [setCookie ?? ''];
      expect(cookies.some((c) => c.startsWith('access_token='))).toBe(true);
    });

    it('rejects invalid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: uniqueEmail(), password: 'wrongpass' });

      expect(response.status).toBe(401);
    });

    it('the cookie it sets actually authenticates a follow-up request', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'testpass123' });
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'testpass123' });
      const setCookie = loginResponse.headers['set-cookie'] as
        string[] | string;
      const cookies: string[] = Array.isArray(setCookie)
        ? setCookie
        : [setCookie];
      const accessTokenCookie = cookies.find((c) =>
        c.startsWith('access_token='),
      )!;

      const profileResponse = await request(app.getHttpServer())
        .get('/auth/profile')
        .set('Cookie', accessTokenCookie.split(';')[0]);

      expect(profileResponse.status).toBe(200);
      expect(profileResponse.body).toMatchObject({ email });
    });
  });

  describe('POST /auth/exchange', () => {
    it('rejects an invalid exchange code', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/exchange')
        .send({ code: 'not-a-real-code' });

      expect(response.status).toBe(401);
    });

    it('rejects a request with no code at all', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/exchange')
        .send({});

      expect(response.status).toBe(400);
    });

    // The OAuth callback that normally mints a code needs a real provider
    // round trip, so the code is minted straight from the service here. That
    // is enough to exercise the half these tests exist for: the code now
    // lives in Postgres, and it is Postgres — not the API process — that has
    // to enforce single use. A code minted in this process being spendable at
    // all is also the property that broke when it lived in a Map.
    it('exchanges a real minted code for a token, exactly once', async () => {
      // The user is inserted directly rather than registered over HTTP: the
      // register route is rate limited to 5/60s per IP, and every spec in this
      // suite shares one process and one counter under --runInBand, so going
      // through the endpoint makes this test's outcome depend on how many
      // other tests ran first.
      const databaseService = moduleFixture.get(DatabaseService);
      const [user] = await databaseService.db
        .insert(users)
        .values({ email: uniqueEmail(), passwordHash: 'not-a-real-hash' })
        .returning({ id: users.id });

      const authService = moduleFixture.get(AuthService);
      const code = await authService.createOAuthExchangeCode(user.id);

      const first = await request(app.getHttpServer())
        .post('/auth/exchange')
        .send({ code });

      expect(first.status).toBe(200);
      const issued = first.body as { access_token?: string };
      expect(typeof issued.access_token).toBe('string');

      const second = await request(app.getHttpServer())
        .post('/auth/exchange')
        .send({ code });

      expect(second.status).toBe(401);
    });
  });

  describe('GET /auth/profile', () => {
    it('rejects a request with no session cookie', async () => {
      const response = await request(app.getHttpServer()).get('/auth/profile');

      expect(response.status).toBe(401);
    });
  });
});
