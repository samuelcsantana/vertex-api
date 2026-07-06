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
  slug: varchar('slug').notNull().unique(),
  content: text('content').notNull(),
  isPublished: boolean('is_published').default(false).notNull(),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
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

export const postsRelations = relations(posts, ({ many }) => ({
  postsToTopics: many(postsToTopics),
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
