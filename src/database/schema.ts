import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  jsonb,
  timestamp,
  pgEnum,
  primaryKey,
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('role', ['user', 'admin']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email').notNull().unique(),
  passwordHash: varchar('password_hash').notNull(),
  name: varchar('name'),
  avatarUrl: text('avatar_url'),
  githubId: text('github_id').unique(),
  isBanned: boolean('is_banned').default(false).notNull(),
  role: userRoleEnum('role').default('user').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title').notNull(),
  description: text('description').notNull(),
  techStack: jsonb('tech_stack').$type<string[]>().notNull().default([]),
  link: varchar('link'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title').notNull(),
  titleEn: text('title_en'),
  titleEs: text('title_es'),
  // slug is the pt (default-locale) slug and stays required — it's also
  // the fallback URL for en/es when a post has no translated slug of its
  // own yet (see PostsService.findPublishedBySlug).
  slug: varchar('slug').notNull().unique(),
  slugEn: varchar('slug_en').unique(),
  slugEs: varchar('slug_es').unique(),
  content: text('content').notNull(),
  contentEn: text('content_en'),
  contentEs: text('content_es'),
  isPublished: boolean('is_published').default(false).notNull(),
  allowComments: boolean('allow_comments').default(true).notNull(),
  coverUrl: text('cover_url'),
  coverAlt: text('cover_alt'),
  // Manually-written SEO snippet for search results — falls back to an
  // auto-generated excerpt of `content` when left blank (see
  // blog/[slug]/page.tsx's generateMetadata on the frontend).
  metaDescription: text('meta_description'),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Singleton: exactly one row holds the editable content for the public
// About page — there is no list/CRUD concept here, just get/update.
export const aboutContent = pgTable('about_content', {
  id: uuid('id').primaryKey().defaultRandom(),
  content: text('content').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const topics = pgTable('topics', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const postsToTopics = pgTable(
  'posts_to_topics',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.postId, table.topicId] })],
);

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id')
    .notNull()
    .references(() => posts.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
  comments: many(comments),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, {
    fields: [posts.authorId],
    references: [users.id],
  }),
  postsToTopics: many(postsToTopics),
  comments: many(comments),
}));

export const topicsRelations = relations(topics, ({ many }) => ({
  postsToTopics: many(postsToTopics),
}));

export const postsToTopicsRelations = relations(postsToTopics, ({ one }) => ({
  post: one(posts, {
    fields: [postsToTopics.postId],
    references: [posts.id],
  }),
  topic: one(topics, {
    fields: [postsToTopics.topicId],
    references: [topics.id],
  }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  post: one(posts, {
    fields: [comments.postId],
    references: [posts.id],
  }),
  author: one(users, {
    fields: [comments.authorId],
    references: [users.id],
  }),
}));
