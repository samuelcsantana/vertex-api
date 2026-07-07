import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TestingModule } from '@nestjs/testing';
import { eq, like } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp } from './utils/create-test-app';
import { createAdminUser, createAuthenticatedUser } from './utils/auth-helpers';
import { DatabaseService } from '../src/database/database.service';
import { aboutContent, users } from '../src/database/schema';

// The About page is a real singleton row, not a disposable e2e fixture —
// GET /about here (as it would in production) may create that row on first
// touch. Whatever content is in place before this suite runs gets restored
// afterwards so a local/shared dev database isn't left with test copy in it.
describe('About (e2e)', () => {
  let app: NestFastifyApplication;
  let moduleFixture: TestingModule;
  let originalContent: string;

  beforeAll(async () => {
    ({ app, moduleFixture } = await createTestApp());

    const getResponse = await request(app.getHttpServer()).get('/about');
    originalContent = (getResponse.body as { content: string }).content;
  });

  afterAll(async () => {
    const databaseService = moduleFixture.get(DatabaseService);
    const [row] = await databaseService.db.select().from(aboutContent).limit(1);
    if (row) {
      await databaseService.db
        .update(aboutContent)
        .set({ content: originalContent })
        .where(eq(aboutContent.id, row.id));
    }

    await databaseService.db
      .delete(users)
      .where(like(users.email, 'e2e-%@example.com'));

    await app.close();
  });

  it('GET /about is public and returns the current content', async () => {
    const response = await request(app.getHttpServer()).get('/about');

    expect(response.status).toBe(200);
    expect(typeof (response.body as { content: string }).content).toBe(
      'string',
    );
  });

  it('PATCH /about rejects an unauthenticated request', async () => {
    const response = await request(app.getHttpServer())
      .patch('/about')
      .send({ content: 'Hijacked' });

    expect(response.status).toBe(401);
  });

  it('PATCH /about rejects a logged-in user who is not an admin', async () => {
    const { cookie } = await createAuthenticatedUser(
      app,
      moduleFixture,
      'about-viewer',
    );

    const response = await request(app.getHttpServer())
      .patch('/about')
      .set('Cookie', cookie)
      .send({ content: 'Hijacked' });

    expect(response.status).toBe(403);
  });

  it('allows an admin to update the content', async () => {
    const { cookie } = await createAdminUser(app, moduleFixture, 'about-admin');
    const newContent = `E2E about content ${Date.now()}`;

    const updateResponse = await request(app.getHttpServer())
      .patch('/about')
      .set('Cookie', cookie)
      .send({ content: newContent });

    expect(updateResponse.status).toBe(200);
    expect((updateResponse.body as { content: string }).content).toBe(
      newContent,
    );

    const getResponse = await request(app.getHttpServer()).get('/about');
    expect((getResponse.body as { content: string }).content).toBe(newContent);
  });
});
