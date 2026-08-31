import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
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
  // How the user wants to be shown publicly — wins over `name` everywhere
  // a visitor-facing surface renders an identity (displayName ?? name).
  // OTP first-logins default it to the email local-part so comments never
  // show a generic "User" nor the raw email.
  displayName: varchar('display_name'),
  avatarUrl: text('avatar_url'),
  githubId: text('github_id').unique(),
  googleId: text('google_id').unique(),
  isBanned: boolean('is_banned').default(false).notNull(),
  role: userRoleEnum('role').default('user').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Pending passwordless-login codes. Like the OAuth exchange codes above,
// these live in Postgres rather than in the API process: an OTP has to
// survive a restart or a deploy, and it has to be findable by whichever
// process handles the verify request. email is unique — one active code per
// address; a new request replaces the previous row.
export const emailOtps = pgTable('email_otps', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email').notNull().unique(),
  codeHash: varchar('code_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Codes the OAuth popup carries back to the frontend, traded for a real
// access token over POST /auth/exchange. In Postgres and not in a Map in the
// API process: the request that mints a code and the one that spends it are
// two separate HTTP calls, so any deployment running more than one process
// can land them in different memory. That failure is intermittent and
// invisible locally, which is the worst combination there is.
//
// The row holds the user id, not a frozen token payload, so the token is
// built from the current row when the code is spent — a role changed inside
// the 60-second window cannot ride into a token that lives for seven days.
export const oauthExchangeCodes = pgTable('oauth_exchange_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  // SHA-256 of the code, never the code itself: a leaked row does not contain
  // the value a caller has to present. Unique because the hash is what the
  // exchange looks the row up by.
  codeHash: varchar('code_hash').notNull().unique(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
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
  // null while the post is a draft — stamped once, the moment isPublished
  // first flips to true (see PostsService.create/update), and never
  // overwritten again so a later unpublish/republish keeps showing the
  // original publish date instead of the republish date. createdAt stays
  // the true (immutable) row-creation time even for drafts; this is the
  // separate "went live" date the public site actually displays.
  publishedAt: timestamp('published_at'),
  allowComments: boolean('allow_comments').default(true).notNull(),
  // Cover image is per locale, same fallback rule as title/content: a
  // locale without its own cover serves the pt one. Localized because
  // covers can carry embedded text (e.g. the article title in the art).
  coverUrl: text('cover_url'),
  coverUrlEn: text('cover_url_en'),
  coverUrlEs: text('cover_url_es'),
  coverAlt: text('cover_alt'),
  coverAltEn: text('cover_alt_en'),
  coverAltEs: text('cover_alt_es'),
  // Manually-written SEO snippet for search results — per locale, same as
  // title/content: a locale without its own override falls back to an
  // auto-generated excerpt of that locale's own (possibly also-fallback)
  // content, not to another locale's hand-written text (see
  // localized-content.ts's getLocalizedMetaDescription and
  // blog/[slug]/page.tsx's generateMetadata on the frontend).
  metaDescription: text('meta_description'),
  metaDescriptionEn: text('meta_description_en'),
  metaDescriptionEs: text('meta_description_es'),
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
  // content is the pt (default-locale) text and stays required — en/es are
  // optional translations that fall back to pt on the frontend, mirroring
  // posts' content/content_en/content_es.
  content: text('content').notNull(),
  contentEn: text('content_en'),
  contentEs: text('content_es'),
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
