import { fail, redirect } from '@sveltejs/kit';
import {
	ADMIN_HINT_COOKIE,
	SESSION_COOKIE,
	SESSION_MAX_AGE,
	checkPassword,
	createSession
} from '#lib/server/session.ts';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const form = await request.formData();
		const password = form.get('password');

		if (typeof password !== 'string' || !checkPassword(password)) {
			return fail(401, { error: 'Wrong password.' });
		}

		cookies.set(SESSION_COOKIE, createSession(), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: SESSION_MAX_AGE
		});
		// Readable by the page, unlike the session itself. See ADMIN_HINT_COOKIE.
		cookies.set(ADMIN_HINT_COOKIE, '1', {
			path: '/',
			httpOnly: false,
			sameSite: 'lax',
			maxAge: SESSION_MAX_AGE
		});

		redirect(303, '/admin');
	}
};
