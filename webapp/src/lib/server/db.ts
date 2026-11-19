import { DATABASE_URL } from '$app/env/private';
import { createDb } from 'shared/db';

export const db = createDb(DATABASE_URL);
