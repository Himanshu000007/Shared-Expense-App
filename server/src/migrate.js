// Applies schema.sql to the DB in DATABASE_URL, using the mysql2 pool we
// already depend on. Loads .env itself, so `npm run db:migrate` needs no env
// exported in the shell and no mysql client installed.
// Run with: npm run db:migrate
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = readFileSync(join(here, 'schema.sql'), 'utf8');
  // Run statements one at a time (mysql2's default connection sends a single
  // statement per query). Fine for plain DDL like ours.
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await pool.query(stmt);
  }

  console.log('Migration applied.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
