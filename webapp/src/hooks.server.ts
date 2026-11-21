import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, isValidSession } from '#lib/server/session.ts';

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/');

	// Public pages use this too, to let the admin preview unpublished videos.
	event.locals.admin = isValidSession(event.cookies.get(SESSION_COOKIE));

	if (isAdminPath && pathname !== '/admin/login' && !event.locals.admin) {
		redirect(303, '/admin/login');
	}

	const response = await resolve(event);

	// Admin pages show private data. Say so explicitly, so that no cache between
	// the server and the browser ever keeps a copy, however it is configured.
	if (isAdminPath) {
		response.headers.set('cache-control', 'private, no-store');
	}

	return response;
};
