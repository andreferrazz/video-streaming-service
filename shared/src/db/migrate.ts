import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Applies any migrations in shared/drizzle that the database has not seen yet.
// Run once per deploy, before the web app and the worker start.
const url = process.env.DATABASE_URL;
if (!url) throw new Error('Missing environment variable DATABASE_URL');

const client = postgres(url, { max: 1 });
await migrate(drizzle(client), {
	migrationsFolder: new URL('../../drizzle', import.meta.url).pathname
});
await client.end();

console.log('migrations applied');
