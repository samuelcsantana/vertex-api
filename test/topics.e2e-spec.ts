import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TestingModule } from '@nestjs/testing';
import { like } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp } from './utils/create-test-app';
import { createAdminUser, createAuthenticatedUser } from './utils/auth-helpers';
import { DatabaseService } from '../src/database/database.service';
import { topics, users } from '../src/database/schema';

const uniqueName = (label: string) =>
  `E2E Topic ${label} ${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe('Topics (e2e)', () => {
  let app: NestFastifyApplication;
  let moduleFixture: TestingModule;

  beforeAll(async () => {
    ({ app, moduleFixture } = await createTestApp());
  });

  afterAll(async () => {
    const databaseService = moduleFixture.get(DatabaseService);
    await databaseService.db
      .delete(topics)
      .where(like(topics.name, 'E2E Topic%'));
    await databaseService.db
      .delete(users)
      .where(like(users.email, 'e2e-%@example.com'));

    await app.close();
  });

  it('GET /topics is public and returns an array', async () => {
    const response = await request(app.getHttpServer()).get('/topics');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('POST /topics rejects an unauthenticated request', async () => {
    const response = await request(app.getHttpServer())
      .post('/topics')
      .send({ name: uniqueName('unauth') });

    expect(response.status).toBe(401);
  });

  it('POST /topics rejects a logged-in user who is not an admin', async () => {
    const { cookie } = await createAuthenticatedUser(
      app,
      moduleFixture,
      'topic-viewer',
    );

    const response = await request(app.getHttpServer())
      .post('/topics')
      .set('Cookie', cookie)
      .send({ name: uniqueName('nonadmin') });

    expect(response.status).toBe(403);
  });

  it('allows an admin to create, rename, and delete a topic end to end', async () => {
    const { cookie } = await createAdminUser(app, moduleFixture, 'topic-admin');
    const name = uniqueName('create');

    const createResponse = await request(app.getHttpServer())
      .post('/topics')
      .set('Cookie', cookie)
      .send({ name });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toMatchObject({ name });
    const topicId = (createResponse.body as { id: string }).id;

    const listResponse = await request(app.getHttpServer()).get('/topics');
    expect(
      (listResponse.body as { id: string }[]).some((t) => t.id === topicId),
    ).toBe(true);

    const renamedName = uniqueName('renamed');
    const updateResponse = await request(app.getHttpServer())
      .patch(`/topics/${topicId}`)
      .set('Cookie', cookie)
      .send({ name: renamedName });
    expect(updateResponse.status).toBe(200);
    expect((updateResponse.body as { name: string }).name).toBe(renamedName);

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/topics/${topicId}`)
      .set('Cookie', cookie);
    expect(deleteResponse.status).toBe(200);

    const listAfterDelete = await request(app.getHttpServer()).get('/topics');
    expect(
      (listAfterDelete.body as { id: string }[]).some((t) => t.id === topicId),
    ).toBe(false);
  });

  it('PATCH /topics/:id 404s for a topic that does not exist', async () => {
    const { cookie } = await createAdminUser(app, moduleFixture, 'topic-admin');

    const response = await request(app.getHttpServer())
      .patch('/topics/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookie)
      .send({ name: uniqueName('missing') });

    expect(response.status).toBe(404);
  });
});
