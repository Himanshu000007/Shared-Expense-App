-- Schema for the Shared Expenses App (MySQL). Hand-written SQL, no ORM.
-- Grows one resource per feature commit. This slice: users (login identity).
-- Idempotent so `npm run db:migrate` can be re-run safely.

-- A login identity. Distinct from a group member (a person inside a group, who
-- may be a guest with no login). One user maps to many group members later.
-- UUIDs are generated in the app (crypto.randomUUID) and stored as CHAR(36),
-- so no DB extension / function default is needed.
CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  name          VARCHAR(80)  NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
