import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'Postgres connection string'
	},
	ADMIN_PASSWORD: {
		description: 'Password for the admin area'
	},
	SESSION_SECRET: {
		description: 'Key used to sign the admin session cookie',
		schema: (value) => {
			if (!value || value.length < 32) {
				throw new Error('SESSION_SECRET must be at least 32 characters');
			}
			return value;
		}
	}
});
