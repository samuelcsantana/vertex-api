import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DatabaseService } from '../../src/database/database.service';
import { users } from '../../src/database/schema';
import { UserRole } from '../../src/auth/interfaces/jwt-payload.interface';

export const uniqueEmail = (label = 'user') =>
  `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

// The real /auth/register + /auth/login HTTP round trip is already
// exercised in auth.e2e-spec.ts, including a check that the resulting
// cookie actually authenticates a follow-up request. Every other e2e suite
// just needs *a* valid session to exercise its own guards/business logic,
// and doing that via HTTP here would mean every spec file competing for
// the same 5-requests/60s login throttle bucket — inserting the user row
// directly and minting its token through the app's own JwtService sidesteps
// that shared, scarce budget without weakening what's actually under test.
export async function createTestUser(
  app: NestFastifyApplication,
  moduleFixture: TestingModule,
  options: { role?: UserRole; label?: string } = {},
) {
  const { role = 'user', label = role } = options;
  const email = uniqueEmail(label);

  const databaseService = moduleFixture.get(DatabaseService);
  const [user] = await databaseService.db
    .insert(users)
    .values({ email, passwordHash: 'unused-in-tests', role })
    .returning();

  const jwtService = moduleFixture.get(JwtService);
  const token = await jwtService.signAsync({
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    avatarUrl: user.avatarUrl,
  });

  return { userId: user.id, email, cookie: `access_token=${token}` };
}

export const createAuthenticatedUser = (
  app: NestFastifyApplication,
  moduleFixture: TestingModule,
  label = 'user',
) => createTestUser(app, moduleFixture, { role: 'user', label });

export const createAdminUser = (
  app: NestFastifyApplication,
  moduleFixture: TestingModule,
  label = 'admin',
) => createTestUser(app, moduleFixture, { role: 'admin', label });

// Kept for the one spec that deliberately exercises the real HTTP flow.
export async function loginViaHttp(
  app: NestFastifyApplication,
  email: string,
  password: string,
) {
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password });

  const setCookie = response.headers['set-cookie'] as
    string[] | string | undefined;
  const cookies: string[] = Array.isArray(setCookie)
    ? setCookie
    : [setCookie ?? ''];
  const accessTokenCookie = cookies.find((c) => c.startsWith('access_token='));

  if (!accessTokenCookie) {
    throw new Error(`Login for ${email} did not set an access_token cookie`);
  }

  return accessTokenCookie.split(';')[0];
}
