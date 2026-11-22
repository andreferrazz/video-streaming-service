ALTER TABLE "videos" ADD COLUMN "locked_by" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "videos_status_created_at_idx" ON "videos" USING btree ("status","created_at");