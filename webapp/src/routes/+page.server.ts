import { desc, isNotNull } from 'drizzle-orm';
import { videos } from 'shared/db';
import { db } from '#lib/server/db.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const published = await db
		.select({ slug: videos.slug, title: videos.title, description: videos.description })
		.from(videos)
		.where(isNotNull(videos.publishedAt))
		.orderBy(desc(videos.publishedAt));

	return { videos: published };
};
