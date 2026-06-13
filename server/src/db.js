// MySQL connection pool (mysql2) + a thin query() helper. No ORM — every query
// in the app is hand-written SQL with `?` placeholders (mysql2 escapes the
// params array, which is what prevents SQL injection).
import 'dotenv/config';
import mysql from 'mysql2/promise';

export const pool = mysql.createPool(process.env.DATABASE_URL);

// mysql2 returns [rows, fields]; we expose { rows } so callers read results
// the same way everywhere. For INSERT/UPDATE, `rows` is the result header.
export const query = async (text, params) => {
  const [rows] = await pool.query(text, params);
  return { rows };
};
