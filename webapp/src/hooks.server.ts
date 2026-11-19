import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, isValidSession } from '#lib/server/session.ts';

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	const isAdmin = pathname === '/admin' || pathname.startsWith('/admin/');

	if (isAdmin && pathname !== '/admin/login') {
		if (!isValidSession(event.cookies.get(SESSION_COOKIE))) {
			redirect(303, '/admin/login');
		}
	}

	return resolve(event);
};
