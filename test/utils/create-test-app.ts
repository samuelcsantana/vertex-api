import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { AppModule } from '../../src/app.module';

// Test.createTestingModule().createNestApplication() defaults to Express
// (@nestjs/platform-express) when called with no adapter — not installed
// here, since this project uses Fastify throughout (see main.ts). Fastify
// also needs an explicit ready() call after init(), which Express doesn't.
//
// @fastify/cookie is registered here too: main.ts does this imperatively
// in bootstrap(), outside the Nest module system, so createTestingModule()
// (which only wires up what's declared via @Module) doesn't pick it up on
// its own — res.setCookie() would be undefined without it.
export async function createTestApp(): Promise<{
  app: NestFastifyApplication;
  moduleFixture: TestingModule;
}> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );

  await app.register(cookie, { secret: process.env.COOKIE_SECRET });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return { app, moduleFixture };
}
