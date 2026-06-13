// Applies schema.sql to the DB in DATABASE_URL, using the pg pool we already
// depend on. Loads .env itself, so `npm run db:migrate` needs no env exported
// in the shell and no psql installed. Run with: npm run db:migrate
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = readFileSync(join(here, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Migration applied.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
