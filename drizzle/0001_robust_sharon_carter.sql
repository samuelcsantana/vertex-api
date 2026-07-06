CREATE TYPE "public"."role" AS ENUM('user', 'admin');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "role" DEFAULT 'user' NOT NULL;