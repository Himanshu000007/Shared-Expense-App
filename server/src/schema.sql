-- Schema for the Shared Expenses App (MySQL 8 / InnoDB). Hand-written SQL, no ORM.
-- Idempotent so `npm run db:migrate` can be re-run safely.
-- UUIDs are generated in the app (crypto.randomUUID) and stored as CHAR(36).
-- Money is stored as integer minor units (paise) in BIGINT — never floats.

-- A login identity. Distinct from a group member (a person inside a group,
-- who may be a guest with no login).
CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  name          VARCHAR(80)  NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A group/household. base_currency is what balances are expressed in.
CREATE TABLE IF NOT EXISTS `groups` (
  id            CHAR(36)    NOT NULL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  base_currency CHAR(3)     NOT NULL DEFAULT 'INR',
  created_by    CHAR(36)    NOT NULL,
  created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_groups_user FOREIGN KEY (created_by) REFERENCES users(id)
);

-- A person inside a group. user_id is NULL for guests (e.g. Dev, Kabir).
-- Membership is time-bounded: [joined_at, left_at]. left_at NULL = still in.
CREATE TABLE IF NOT EXISTS group_members (
  id           CHAR(36)    NOT NULL PRIMARY KEY,
  group_id     CHAR(36)    NOT NULL,
  user_id      CHAR(36)    NULL,
  display_name VARCHAR(80) NOT NULL,
  is_guest     BOOLEAN     NOT NULL DEFAULT FALSE,
  joined_at    DATE        NOT NULL,
  left_at      DATE        NULL,
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_members_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  CONSTRAINT fk_members_user  FOREIGN KEY (user_id)  REFERENCES users(id)
);

-- FX rates. A row with rate_date = a date is the historical rate for that day;
-- a row with rate_date IS NULL is the fixed fallback. 1 base = `rate` quote.
CREATE TABLE IF NOT EXISTS exchange_rates (
  id             CHAR(36)      NOT NULL PRIMARY KEY,
  base_currency  CHAR(3)       NOT NULL,
  quote_currency CHAR(3)       NOT NULL,
  rate           DECIMAL(18,6) NOT NULL,
  rate_date      DATE          NULL,
  source         VARCHAR(20)   NOT NULL DEFAULT 'fixed',
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- An expense. Amounts are stored both in the original currency and converted
-- to the group's base currency (amount_minor) using fx_rate_id.
CREATE TABLE IF NOT EXISTS expenses (
  id                    CHAR(36) NOT NULL PRIMARY KEY,
  group_id              CHAR(36) NOT NULL,
  description           VARCHAR(255) NOT NULL,
  paid_by               CHAR(36) NOT NULL,
  original_amount_minor BIGINT   NOT NULL,
  original_currency     CHAR(3)  NOT NULL,
  fx_rate_id            CHAR(36) NULL,
  amount_minor          BIGINT   NOT NULL,
  split_type            ENUM('equal','unequal','percentage','share') NOT NULL,
  expense_date          DATE     NOT NULL,
  is_refund             BOOLEAN  NOT NULL DEFAULT FALSE,
  notes                 VARCHAR(500) NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_exp_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  CONSTRAINT fk_exp_payer FOREIGN KEY (paid_by)  REFERENCES group_members(id),
  CONSTRAINT fk_exp_fx    FOREIGN KEY (fx_rate_id) REFERENCES exchange_rates(id)
);

-- One row per participating member: the line-item ledger that powers the
-- itemized balance drill-down. owed_minor is in the group's base currency.
CREATE TABLE IF NOT EXISTS expense_splits (
  id         CHAR(36) NOT NULL PRIMARY KEY,
  expense_id CHAR(36) NOT NULL,
  member_id  CHAR(36) NOT NULL,
  raw_value  DECIMAL(18,4) NULL,
  owed_minor BIGINT   NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_split_exp    FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
  CONSTRAINT fk_split_member FOREIGN KEY (member_id)  REFERENCES group_members(id)
);

-- A payment from one member to another (settling a debt / recording a payment).
CREATE TABLE IF NOT EXISTS settlements (
  id           CHAR(36) NOT NULL PRIMARY KEY,
  group_id     CHAR(36) NOT NULL,
  from_member  CHAR(36) NOT NULL,
  to_member    CHAR(36) NOT NULL,
  amount_minor BIGINT   NOT NULL,
  settled_on   DATE     NOT NULL,
  notes        VARCHAR(500) NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_settle_group FOREIGN KEY (group_id)    REFERENCES `groups`(id) ON DELETE CASCADE,
  CONSTRAINT fk_settle_from  FOREIGN KEY (from_member) REFERENCES group_members(id),
  CONSTRAINT fk_settle_to    FOREIGN KEY (to_member)   REFERENCES group_members(id)
);

-- One CSV import. Nothing financial is real until status = 'committed'.
CREATE TABLE IF NOT EXISTS imports (
  id           CHAR(36) NOT NULL PRIMARY KEY,
  group_id     CHAR(36) NOT NULL,
  filename     VARCHAR(255) NULL,
  status       ENUM('reviewing','committed','aborted') NOT NULL DEFAULT 'reviewing',
  created_by   CHAR(36) NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  committed_at TIMESTAMP NULL,
  CONSTRAINT fk_import_group FOREIGN KEY (group_id)   REFERENCES `groups`(id) ON DELETE CASCADE,
  CONSTRAINT fk_import_user  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- One staged row per CSV line. raw/normalized/resolution are JSON payloads.
CREATE TABLE IF NOT EXISTS import_rows (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  import_id   CHAR(36) NOT NULL,
  line_number INT      NOT NULL,
  raw         JSON     NOT NULL,
  normalized  JSON     NULL,
  status      ENUM('clean','auto_resolved','needs_review','approved','rejected') NOT NULL,
  target_kind ENUM('expense','settlement','dropped') NULL,
  resolution  JSON     NULL,
  committed_ref CHAR(36) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_irow_import FOREIGN KEY (import_id) REFERENCES imports(id) ON DELETE CASCADE
);

-- The detected anomalies per staged row — this is what the Import Report lists.
CREATE TABLE IF NOT EXISTS import_anomalies (
  id               CHAR(36) NOT NULL PRIMARY KEY,
  import_row_id    CHAR(36) NOT NULL,
  type             VARCHAR(40) NOT NULL,
  severity         ENUM('info','warning','blocker') NOT NULL,
  description      VARCHAR(500) NOT NULL,
  suggested_action VARCHAR(255) NOT NULL,
  requires_review  BOOLEAN NOT NULL DEFAULT FALSE,
  chosen_action    VARCHAR(255) NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_anom_row FOREIGN KEY (import_row_id) REFERENCES import_rows(id) ON DELETE CASCADE
);

-- Seed the fixed USD->INR fallback rate (idempotent via fixed PK + INSERT IGNORE).
INSERT IGNORE INTO exchange_rates (id, base_currency, quote_currency, rate, rate_date, source)
VALUES ('00000000-0000-0000-0000-000000000001', 'USD', 'INR', 83.000000, NULL, 'fixed');
