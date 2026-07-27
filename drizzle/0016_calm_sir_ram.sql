ALTER TABLE "posts" ADD COLUMN "published_at" timestamp;--> statement-breakpoint
-- Backfill: posts already published before this migration have no distinct
-- "went live" moment on record, so their created_at is the closest known
-- approximation — keeps their publicly displayed date unchanged.
UPDATE "posts" SET "published_at" = "created_at" WHERE "is_published" = true AND "published_at" IS NULL;