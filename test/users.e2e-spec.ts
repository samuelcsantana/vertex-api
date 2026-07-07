import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TestingModule } from '@nestjs/testing';
import { like } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp } from './utils/create-test-app';
import { createAdminUser, createAuthenticatedUser } from './utils/auth-helpers';
import { DatabaseService } from '../src/database/database.service';
import { posts, users } from '../src/database/schema';

const uniqueSlug = (label: string) =>
  `e2e-users-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe('Users (e2e)', () => {
  let app: NestFastifyApplication;
  let moduleFixture: TestingModule;
  let adminCookie: string;

  beforeAll(async () => {
    ({ app, moduleFixture } = await createTestApp());
    ({ cookie: adminCookie } = await createAdminUser(
      app,
      moduleFixture,
      'users-admin',
    ));
  });

  afterAll(async () => {
    const databaseService = moduleFixture.get(DatabaseService);
    await databaseService.db
      .delete(posts)
      .where(like(posts.slug, 'e2e-users-%'));
    await databaseService.db
      .delete(users)
      .where(like(users.email, 'e2e-%@example.com'));

    await app.close();
  });

  describe('GET /users', () => {
    it('rejects an unauthenticated request', async () => {
      const response = await request(app.getHttpServer()).get('/users');

      expect(response.status).toBe(401);
    });

    it('rejects a logged-in user who is not an admin', async () => {
      const { cookie } = await createAuthenticatedUser(
        app,
        moduleFixture,
        'viewer',
      );

      const response = await request(app.getHttpServer())
        .get('/users')
        .set('Cookie', cookie);

      expect(response.status).toBe(403);
    });

    it('lists users for an admin, without exposing passwordHash', async () => {
      const response = await request(app.getHttpServer())
        .get('/users')
        .set('Cookie', adminCookie);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      const anyUser = (response.body as Record<string, unknown>[])[0];
      expect(anyUser).not.toHaveProperty('passwordHash');
    });
  });

  describe('PATCH /users/:id/ban', () => {
    it('rejects an unauthenticated request', async () => {
      const response = await request(app.getHttpServer())
        .patch('/users/00000000-0000-0000-0000-000000000000/ban')
        .send({ isBanned: true });

      expect(response.status).toBe(401);
    });

    it('rejects a logged-in user who is not an admin', async () => {
      const { cookie } = await createAuthenticatedUser(
        app,
        moduleFixture,
        'ban-nonadmin',
      );

      const response = await request(app.getHttpServer())
        .patch('/users/00000000-0000-0000-0000-000000000000/ban')
        .set('Cookie', cookie)
        .send({ isBanned: true });

      expect(response.status).toBe(403);
    });

    it('rejects an admin trying to ban their own account', async () => {
      const { userId, cookie } = await createAdminUser(
        app,
        moduleFixture,
        'self-ban',
      );

      const response = await request(app.getHttpServer())
        .patch(`/users/${userId}/ban`)
        .set('Cookie', cookie)
        .send({ isBanned: true });

      expect(response.status).toBe(400);
    });

    it('bans a user, and their existing session is rejected afterwards', async () => {
      const { userId, cookie: targetCookie } = await createAuthenticatedUser(
        app,
        moduleFixture,
        'to-be-banned',
      );

      const banResponse = await request(app.getHttpServer())
        .patch(`/users/${userId}/ban`)
        .set('Cookie', adminCookie)
        .send({ isBanned: true });
      expect(banResponse.status).toBe(200);
      expect(banResponse.body).toMatchObject({ isBanned: true });

      const profileResponse = await request(app.getHttpServer())
        .get('/auth/profile')
        .set('Cookie', targetCookie);
      expect(profileResponse.status).toBe(401);
    });
  });

  describe('DELETE /users/:id', () => {
    it('rejects an unauthenticated request', async () => {
      const response = await request(app.getHttpServer()).delete(
        '/users/00000000-0000-0000-0000-000000000000',
      );

      expect(response.status).toBe(401);
    });

    it('rejects a logged-in user who is not an admin', async () => {
      const { cookie } = await createAuthenticatedUser(
        app,
        moduleFixture,
        'delete-nonadmin',
      );

      const response = await request(app.getHttpServer())
        .delete('/users/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookie);

      expect(response.status).toBe(403);
    });

    it('rejects an admin trying to delete their own account', async () => {
      const { userId, cookie } = await createAdminUser(
        app,
        moduleFixture,
        'self-delete',
      );

      const response = await request(app.getHttpServer())
        .delete(`/users/${userId}`)
        .set('Cookie', cookie);

      expect(response.status).toBe(400);
    });

    it('refuses to delete a user who has authored posts', async () => {
      const { userId: authorId, cookie: authorCookie } = await createAdminUser(
        app,
        moduleFixture,
        'author',
      );

      await request(app.getHttpServer())
        .post('/posts')
        .set('Cookie', authorCookie)
        .send({
          title: 'E2E Users Post',
          slug: uniqueSlug('post'),
          content: 'Body',
          isPublished: true,
        });

      const response = await request(app.getHttpServer())
        .delete(`/users/${authorId}`)
        .set('Cookie', adminCookie);

      expect(response.status).toBe(400);
    });

    it('deletes a user and cascades their comments', async () => {
      const { userId, cookie: targetCookie } = await createAuthenticatedUser(
        app,
        moduleFixture,
        'to-be-deleted',
      );
      const postSlug = uniqueSlug('for-comment');

      const postResponse = await request(app.getHttpServer())
        .post('/posts')
        .set('Cookie', adminCookie)
        .send({
          title: 'E2E Users Post For Comment',
          slug: postSlug,
          content: 'Body',
          isPublished: true,
          allowComments: true,
        });
      const postId = (postResponse.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/posts/${postId}/comments`)
        .set('Cookie', targetCookie)
        .send({ content: 'Comment from a user about to be deleted' });

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/users/${userId}`)
        .set('Cookie', adminCookie);
      expect(deleteResponse.status).toBe(200);

      const commentsResponse = await request(app.getHttpServer()).get(
        `/posts/${postId}/comments`,
      );
      expect(
        (commentsResponse.body as { authorId: string }[]).some(
          (c) => c.authorId === userId,
        ),
      ).toBe(false);
    });

    it('404s when the user does not exist', async () => {
      const response = await request(app.getHttpServer())
        .delete('/users/00000000-0000-0000-0000-000000000000')
        .set('Cookie', adminCookie);

      expect(response.status).toBe(404);
    });
  });
});
