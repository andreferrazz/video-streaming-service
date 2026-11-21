import { createHmac, timingSafeEqual } from 'node:crypto';
import { ADMIN_PASSWORD, SESSION_SECRET } from '$app/env/private';

export const SESSION_COOKIE = 'admin_session';
/**
 * A second cookie that page scripts can read. It grants nothing: it only tells
 * the header to show the admin link, so public pages can be the same for
 * everyone and therefore cacheable. Access is still decided by SESSION_COOKIE.
 */
export const ADMIN_HINT_COOKIE = 'admin_hint';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // seconds

function sign(value: string) {
	return createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

function safeEqual(a: string, b: string) {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

export function checkPassword(password: string) {
	// Compare digests so the comparison takes the same time whatever the input length.
	return safeEqual(sign(password), sign(ADMIN_PASSWORD));
}

/** The cookie value is the expiry time plus a signature over it. */
export function createSession() {
	const expires = String(Date.now() + SESSION_MAX_AGE * 1000);
	return `${expires}.${sign(expires)}`;
}

export function isValidSession(cookie: string | undefined) {
	if (!cookie) return false;
	const [expires, signature] = cookie.split('.');
	if (!expires || !signature) return false;
	return safeEqual(signature, sign(expires)) && Number(expires) > Date.now();
}
