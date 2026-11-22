ALTER TABLE "videos" ADD COLUMN "upload_id" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "upload_bytes" bigint;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "upload_part_bytes" integer;