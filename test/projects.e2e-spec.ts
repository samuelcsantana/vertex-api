import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TestingModule } from '@nestjs/testing';
import { like } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp } from './utils/create-test-app';
import { createAdminUser, createAuthenticatedUser } from './utils/auth-helpers';
import { DatabaseService } from '../src/database/database.service';
import { projects, users } from '../src/database/schema';

const uniqueTitle = (label: string) =>
  `E2E Project ${label} ${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe('Projects (e2e)', () => {
  let app: NestFastifyApplication;
  let moduleFixture: TestingModule;

  beforeAll(async () => {
    ({ app, moduleFixture } = await createTestApp());
  });

  afterAll(async () => {
    const databaseService = moduleFixture.get(DatabaseService);
    await databaseService.db
      .delete(projects)
      .where(like(projects.title, 'E2E Project%'));
    await databaseService.db
      .delete(users)
      .where(like(users.email, 'e2e-%@example.com'));

    await app.close();
  });

  it('GET /projects is public and returns an array', async () => {
    const response = await request(app.getHttpServer()).get('/projects');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('GET /projects/:id 404s for a project that does not exist', async () => {
    const response = await request(app.getHttpServer()).get(
      '/projects/00000000-0000-0000-0000-000000000000',
    );

    expect(response.status).toBe(404);
  });

  it('POST /projects rejects an unauthenticated request', async () => {
    const response = await request(app.getHttpServer())
      .post('/projects')
      .send({ title: uniqueTitle('unauth'), description: 'x', techStack: [] });

    expect(response.status).toBe(401);
  });

  it('POST /projects rejects a logged-in user who is not an admin', async () => {
    const { cookie } = await createAuthenticatedUser(
      app,
      moduleFixture,
      'project-viewer',
    );

    const response = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', cookie)
      .send({
        title: uniqueTitle('nonadmin'),
        description: 'x',
        techStack: [],
      });

    expect(response.status).toBe(403);
  });

  it('allows an admin to create, read, update, and delete a project end to end', async () => {
    const { cookie } = await createAdminUser(
      app,
      moduleFixture,
      'project-admin',
    );
    const title = uniqueTitle('happy-path');

    const createResponse = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', cookie)
      .send({ title, description: 'A project', techStack: ['TypeScript'] });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toMatchObject({ title });
    const projectId = (createResponse.body as { id: string }).id;

    const readResponse = await request(app.getHttpServer()).get(
      `/projects/${projectId}`,
    );
    expect(readResponse.status).toBe(200);
    expect(readResponse.body).toMatchObject({ id: projectId });

    const updateResponse = await request(app.getHttpServer())
      .patch(`/projects/${projectId}`)
      .set('Cookie', cookie)
      .send({ description: 'Updated description' });
    expect(updateResponse.status).toBe(200);
    expect((updateResponse.body as { description: string }).description).toBe(
      'Updated description',
    );

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/projects/${projectId}`)
      .set('Cookie', cookie);
    expect(deleteResponse.status).toBe(200);

    const afterDeleteResponse = await request(app.getHttpServer()).get(
      `/projects/${projectId}`,
    );
    expect(afterDeleteResponse.status).toBe(404);
  });
});
