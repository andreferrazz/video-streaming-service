import { redirect } from '@sveltejs/kit';
import { desc } from 'drizzle-orm';
import { videos } from 'shared/db';
import { db } from '#lib/server/db.ts';
import { SESSION_COOKIE } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const all = await db
		.select({
			id: videos.id,
			title: videos.title,
			status: videos.status,
			publishedAt: videos.publishedAt
		})
		.from(videos)
		.orderBy(desc(videos.createdAt));

	return { videos: all };
};

export const actions: Actions = {
	logout: async ({ cookies }) => {
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/admin/login');
	}
};
