-- Schema for the Shared Expenses App (PostgreSQL). Hand-written SQL, no ORM.
-- Grows one resource per feature commit. This slice: users (login identity).
-- Idempotent so `npm run db:migrate` can be re-run safely.

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- provides gen_random_uuid()

-- A login identity. Distinct from a group member (a person inside a group, who
-- may be a guest with no login). One user maps to many group members later.
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
