ALTER TABLE "posts" ADD COLUMN "title_es" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "slug_en" varchar;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "slug_es" varchar;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "content_es" text;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_slug_en_unique" UNIQUE("slug_en");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_slug_es_unique" UNIQUE("slug_es");