import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, isValidSession } from '#lib/server/session.ts';

// Pages and their data are text and shrink to about a third. Scripts and styles
// are compressed ahead of time by the build; images and video already are.
const COMPRESSIBLE = /^(text\/html|application\/json)/;

/** Compress a page or data response if the browser can read the result. */
function compress(request: Request, response: Response) {
	const accepted = request.headers.get('accept-encoding') ?? '';
	const format = /\bbr\b/.test(accepted) ? 'brotli' : /\bgzip\b/.test(accepted) ? 'gzip' : null;

	if (
		!format ||
		!response.body ||
		request.method === 'HEAD' ||
		response.headers.has('content-encoding') ||
		!COMPRESSIBLE.test(response.headers.get('content-type') ?? '')
	) {
		return response;
	}

	const headers = new Headers(response.headers);
	headers.set('content-encoding', format === 'brotli' ? 'br' : 'gzip');
	// A cache must keep the compressed and plain versions apart.
	headers.append('vary', 'accept-encoding');
	// The length is no longer known in advance.
	headers.delete('content-length');

	return new Response(
		response.body.pipeThrough(
			// Node supports brotli here; the browser-oriented type definitions do not list it yet.
			new CompressionStream(format as CompressionFormat)
		),
		{ status: response.status, statusText: response.statusText, headers }
	);
}

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

	return compress(event.request, response);
};
