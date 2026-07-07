import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TestingModule } from '@nestjs/testing';
import { like } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp } from './utils/create-test-app';
import { createAdminUser, createAuthenticatedUser } from './utils/auth-helpers';
import { DatabaseService } from '../src/database/database.service';
import { posts, users } from '../src/database/schema';

const uniqueSlug = (label: string) =>
  `e2e-comments-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function createPost(
  app: NestFastifyApplication,
  adminCookie: string,
  overrides: { allowComments?: boolean } = {},
) {
  const slug = uniqueSlug('post');
  const response = await request(app.getHttpServer())
    .post('/posts')
    .set('Cookie', adminCookie)
    .send({
      title: 'E2E Comments Post',
      slug,
      content: 'Body',
      isPublished: true,
      allowComments: overrides.allowComments ?? true,
    });

  return (response.body as { id: string }).id;
}

describe('Comments (e2e)', () => {
  let app: NestFastifyApplication;
  let moduleFixture: TestingModule;
  let adminCookie: string;

  beforeAll(async () => {
    ({ app, moduleFixture } = await createTestApp());
    ({ cookie: adminCookie } = await createAdminUser(
      app,
      moduleFixture,
      'comments-admin',
    ));
  });

  afterAll(async () => {
    const databaseService = moduleFixture.get(DatabaseService);
    // Deleting the posts cascades their comments away (onDelete: 'cascade'
    // on comments.postId), which has to happen before the e2e author/
    // commenter users can be deleted (authorId has no cascade, so a
    // dangling comment or post would block it).
    await databaseService.db
      .delete(posts)
      .where(like(posts.slug, 'e2e-comments-%'));
    await databaseService.db
      .delete(users)
      .where(like(users.email, 'e2e-%@example.com'));

    await app.close();
  });

  it('GET /posts/:postId/comments is public and returns an array', async () => {
    const postId = await createPost(app, adminCookie);

    const response = await request(app.getHttpServer()).get(
      `/posts/${postId}/comments`,
    );

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('POST rejects an unauthenticated request', async () => {
    const postId = await createPost(app, adminCookie);

    const response = await request(app.getHttpServer())
      .post(`/posts/${postId}/comments`)
      .send({ content: 'Hijacked' });

    expect(response.status).toBe(401);
  });

  it('POST 404s when the post does not exist', async () => {
    const { cookie } = await createAuthenticatedUser(
      app,
      moduleFixture,
      'commenter',
    );

    const response = await request(app.getHttpServer())
      .post('/posts/00000000-0000-0000-0000-000000000000/comments')
      .set('Cookie', cookie)
      .send({ content: 'Hi' });

    expect(response.status).toBe(404);
  });

  it('POST rejects a comment when the post has comments disabled', async () => {
    const postId = await createPost(app, adminCookie, { allowComments: false });
    const { cookie } = await createAuthenticatedUser(
      app,
      moduleFixture,
      'commenter',
    );

    const response = await request(app.getHttpServer())
      .post(`/posts/${postId}/comments`)
      .set('Cookie', cookie)
      .send({ content: 'Hi' });

    expect(response.status).toBe(400);
  });

  it('allows an authenticated user to post and then delete their own comment', async () => {
    const postId = await createPost(app, adminCookie);
    const { cookie } = await createAuthenticatedUser(
      app,
      moduleFixture,
      'commenter-owner',
    );

    const createResponse = await request(app.getHttpServer())
      .post(`/posts/${postId}/comments`)
      .set('Cookie', cookie)
      .send({ content: 'Nice post!' });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toMatchObject({ content: 'Nice post!' });
    const commentId = (createResponse.body as { id: string }).id;

    const listResponse = await request(app.getHttpServer()).get(
      `/posts/${postId}/comments`,
    );
    expect(
      (listResponse.body as { id: string }[]).some((c) => c.id === commentId),
    ).toBe(true);

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/comments/${commentId}`)
      .set('Cookie', cookie);
    expect(deleteResponse.status).toBe(200);
  });

  it('DELETE rejects a user who neither owns the comment nor is an admin', async () => {
    const postId = await createPost(app, adminCookie);
    const { cookie: ownerCookie } = await createAuthenticatedUser(
      app,
      moduleFixture,
      'commenter-owner2',
    );
    const { cookie: strangerCookie } = await createAuthenticatedUser(
      app,
      moduleFixture,
      'commenter-stranger',
    );

    const createResponse = await request(app.getHttpServer())
      .post(`/posts/${postId}/comments`)
      .set('Cookie', ownerCookie)
      .send({ content: 'Mine' });
    const commentId = (createResponse.body as { id: string }).id;

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/comments/${commentId}`)
      .set('Cookie', strangerCookie);
    expect(deleteResponse.status).toBe(403);
  });

  it('allows an admin to delete a comment they do not own', async () => {
    const postId = await createPost(app, adminCookie);
    const { cookie: ownerCookie } = await createAuthenticatedUser(
      app,
      moduleFixture,
      'commenter-owner3',
    );

    const createResponse = await request(app.getHttpServer())
      .post(`/posts/${postId}/comments`)
      .set('Cookie', ownerCookie)
      .send({ content: 'Mine too' });
    const commentId = (createResponse.body as { id: string }).id;

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/comments/${commentId}`)
      .set('Cookie', adminCookie);
    expect(deleteResponse.status).toBe(200);
  });
});
