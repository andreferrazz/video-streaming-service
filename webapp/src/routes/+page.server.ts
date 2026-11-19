import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { videos } from 'shared/db';
import { db } from '#lib/server/db.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const published = await db
		.select({ id: videos.id, slug: videos.slug, title: videos.title })
		.from(videos)
		.where(and(eq(videos.status, 'ready'), isNotNull(videos.publishedAt)))
		.orderBy(desc(videos.publishedAt));

	return { videos: published };
};
