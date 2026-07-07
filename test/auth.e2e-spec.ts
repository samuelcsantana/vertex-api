import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TestingModule } from '@nestjs/testing';
import { like } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp } from './utils/create-test-app';
import { DatabaseService } from '../src/database/database.service';
import { users } from '../src/database/schema';

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
  });

  describe('GET /auth/profile', () => {
    it('rejects a request with no session cookie', async () => {
      const response = await request(app.getHttpServer()).get('/auth/profile');

      expect(response.status).toBe(401);
    });
  });
});
