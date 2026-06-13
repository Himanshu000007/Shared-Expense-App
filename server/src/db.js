// node-postgres connection pool + a thin query() helper. No ORM — every query
// in the app is hand-written, parameterized SQL.
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Always pass values as the params array ($1, $2, …), never string-interpolated
// into the SQL text. This is what prevents SQL injection.
export const query = (text, params) => pool.query(text, params);
