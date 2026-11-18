import { integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
	publishedAt: timestamp('published_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
