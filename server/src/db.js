// MySQL connection pool (mysql2) + helpers. No ORM — every query in the app is
// hand-written SQL with `?` placeholders (mysql2 escapes the params array,
// which is what prevents SQL injection).
import 'dotenv/config';
import mysql from 'mysql2/promise';

// Parse DATABASE_URL explicitly so we can pass extra options. dateStrings keeps
// DATE/TIMESTAMP columns as plain strings (e.g. '2026-03-08'), which makes date
// comparisons and JSON output simple and predictable.
const url = new URL(process.env.DATABASE_URL);
export const pool = mysql.createPool({
  host: url.hostname,
  port: url.port ? Number(url.port) : 3306,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ''),
  dateStrings: true,
});

// mysql2 returns [rows, fields]; we expose { rows } so callers read results the
// same way everywhere. For INSERT/UPDATE, `rows` is the result header.
export const query = async (text, params) => {
  const [rows] = await pool.query(text, params);
  return { rows };
};

// Run `work` inside a transaction. `work` receives a dedicated connection whose
// .query(text, params) returns [rows] (mysql2's native shape). Commits on
// success, rolls back on any thrown error, always releases the connection.
export async function withTransaction(work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
