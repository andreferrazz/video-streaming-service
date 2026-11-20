import type { LayoutServerLoad } from './$types';

// Lets the header show the admin link only to someone who is logged in.
export const load: LayoutServerLoad = ({ locals }) => {
	return { admin: locals.admin };
};
