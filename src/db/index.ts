import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from 'dotenv';

config({ path: '.env' });

const client = postgres(process.env.DB_URI!, {
  max: process.env.VERCEL === '1' ? 1 : 3,
  prepare: false,
});

export const db = drizzle({ client });

