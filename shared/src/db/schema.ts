import { bigint, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const videoStatus = pgEnum('video_status', [
	'uploading',
	'queued',
	'processing',
	'ready',
	'failed'
]);

export const videos = pgTable('videos', {
	id: uuid('id').primaryKey().defaultRandom(),
	slug: text('slug').notNull().unique(),
	title: text('title').notNull(),
	description: text('description').notNull().default(''),
	status: videoStatus('status').notNull().default('uploading'),
	progress: integer('progress').notNull().default(0),
	error: text('error'),
	durationSeconds: integer('duration_seconds'),
	width: integer('width'),
	height: integer('height'),
	// Bytes this video holds in the bucket: the original, the renditions and the
	// posters. The sum over all videos is what the storage limit is checked against.
	storedBytes: bigint('stored_bytes', { mode: 'number' }).notNull().default(0),
	// Set only while a direct upload is in progress: the id storage gave the
	// multipart upload, the size the browser declared, and the size of each part.
	uploadId: text('upload_id'),
	uploadBytes: bigint('upload_bytes', { mode: 'number' }),
	uploadPartBytes: integer('upload_part_bytes'),
	publishedAt: timestamp('published_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
