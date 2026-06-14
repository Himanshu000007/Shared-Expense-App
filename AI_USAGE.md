# AI_USAGE.md

## AI tool used

- **Claude Code** (Anthropic's CLI coding agent, running Claude Opus) — used as the primary
  pair-programmer for scaffolding, SQL, the import pipeline, the React UI, and deployment help.

I (the engineer of record) drove every decision: I chose the stack, the data-handling
policies, and the architecture, reviewed all generated code, ran the migrations/tests myself,
and rejected or rewrote anything that was wrong. Nothing was committed that I hadn't read and
verified. The cases below are real moments from this build where the AI produced something
incorrect and I caught and fixed it.

## How I worked with it

- **Plan before code.** I had it write `SCOPE.md` (anomaly log + schema) and `DECISIONS.md`
  *first*, reviewed the policies, then implemented one feature at a time and committed between
  each (auth → groups → expenses → settlements → balances → import → frontend).
- **Verify, don't trust.** Every slice was checked by running it: `npm run db:migrate`,
  curl/`fetch` smoke tests (`server/scripts/smoke.mjs` — 26 assertions), and the importer run
  against the *actual* `expenses_export.csv` (`server/scripts/import.mjs`).
- **Override defaults.** When the AI reached for conventions I didn't want (an ORM, a deep
  folder structure), I redirected it (see Case 5).

## Key prompts (representative)

1. "Build a Shared Expenses App … first tell me what you understood and then the list of APIs."
2. "Use **MySQL** not Postgres for the project; make changes wherever needed."
3. "Do things **without Prisma** — write the SQL manually (`client.query('… WHERE id = $1', [id])`)."
4. "Make the architecture simpler … we made a file for even an error, that's too complex."
5. "Build the **import pipeline** next." / "Detect every anomaly, surface it, handle it per a policy."
6. "Start the **frontend**." / "Make it a soft, pastel theme like this reference."
7. "Make a clean CSV (no anomalies) with members Utkarsh, Himanshu, Ayushi, Shyam, Gautam to test the happy path."
8. "Add edit/delete for expenses and members."

---

## Cases where the AI was wrong, how I caught it, what I changed

### Case 1 — Used a MySQL reserved keyword as a column name
- **What the AI produced.** In the import staging schema it named a column `row_number`:
  `CREATE TABLE import_rows ( … row_number INT NOT NULL, … )`.
- **How I caught it.** Running `npm run db:migrate` failed: the `imports` table was created but
  `import_rows` errored with `ER_PARSE_ERROR … near 'row_number INT NOT NULL'`. `ROW_NUMBER`
  is a **reserved word** in MySQL 8 (the window function), so it can't be a bare identifier.
- **What I changed.** Renamed the column to `line_number` in `src/schema.sql` and updated every
  reference in `src/import.js` (the `INSERT`, the `ORDER BY`, and the row reads). Migration then
  succeeded. (Lesson: this exact bug wouldn't have happened on Postgres — it's MySQL-specific,
  which is the kind of thing the AI doesn't track unless told the precise engine.)

### Case 2 — Queried `group_id` from a table that doesn't have it
- **What the AI produced.** The import **commit** logic (`commitRow` in `src/import.js`) tried to
  find the group to attach new expenses/settlements to with
  `SELECT group_id FROM import_rows WHERE id = ?` and an `INSERT … VALUES (?, (SELECT group_id
  FROM import_rows …), …)`. But `import_rows` has **`import_id`**, not `group_id`.
- **How I caught it.** I ran the importer against the real CSV (`scripts/import.mjs`). Detection
  worked, but the commit summary showed **0 expenses inserted** and every expense row skipped
  with `Unknown column 'group_id' in 'field list'`.
- **What I changed.** Threaded the real `groupId` (from the `imports` record, `imp.group_id`)
  into the commit context and used it directly in the `INSERT`s, deleting the broken subquery.
  Re-ran: **27 expenses committed, 14 held for review, 1 dropped** — correct.

### Case 3 — Anomaly detector produced a false positive (over-flagged a valid date)
- **What the AI produced.** The `AMBIGUOUS_DATE` detector flagged a row if its date was out of
  order versus the *immediately previous or next* row (and day ≤ 12). On the real CSV this
  flagged **two** rows: the genuinely-bad `04-05-2026` (deep cleaning, out of place) **and** the
  perfectly valid `01-04-2026` (April rent) — only because April rent sits right after the bad
  row, so it looked "out of order" relative to a *broken* neighbour.
- **How I caught it.** I read the import report it printed: `AMBIGUOUS_DATE: 2` when, by hand,
  only one row in the file is actually ambiguous. A "silent guess" here would have wrongly sent a
  valid row to manual review.
- **What I changed.** Rewrote `detectAmbiguousDates` in `src/importPipeline.js` to only flag the
  outlier when its **neighbours agree with each other** (`prev <= next`) but the row itself falls
  outside `[prev, next]`. That isolates the single real offender. Re-ran: `AMBIGUOUS_DATE: 1`.

### Case 4 — Migration command that couldn't actually run
- **What the AI produced.** It first wrote the migrate script as
  `"db:migrate": "psql \"$DATABASE_URL\" -f src/schema.sql"`.
- **How I caught it.** Running `npm run db:migrate` failed with
  `database "<my-username>" does not exist`. Two problems: (a) `$DATABASE_URL` lives in the
  `.env` **file**, and npm does **not** load it into the shell, so the variable was empty and
  psql fell back to a DB named after my OS user; (b) `psql` wasn't even installed.
- **What I changed.** Replaced it with a small Node runner, `src/migrate.js`, that does
  `import 'dotenv/config'` (so it reads `.env` itself) and executes `schema.sql` through the
  existing driver pool — no `psql`, no shell env required. `npm run db:migrate` then printed
  `Migration applied.`

### Case 5 — Over-engineered structure & an ORM I didn't ask for (design correction)
- **What the AI produced.** The first backend defaulted to **Prisma** (an ORM) and split the auth
  feature across ~11 files (`controllers/`, `services/`, `models/`, `validators/`, …). Tracing
  "what happens on login" meant opening five files.
- **How I caught it.** Reviewing the file tree — it was layering for its own sake, and the
  assignment also mandates *relational DBs* and rewards code I can explain line-by-line.
- **What I changed.** I directed two corrections: drop Prisma for **hand-written SQL via
  `mysql2`** (no ORM), and collapse to a **flat, one-file-per-feature** structure (`auth.js`,
  `groups.js`, …) with only the genuinely complex core (import pipeline, split/balance engines)
  in their own files. Recorded as DECISIONS **D16** and **D17**.

---

## What I verified myself (to stay engineer of record)

- Ran every migration and read the resulting schema (`DESCRIBE`, `SHOW TABLES`).
- Wrote/ran end-to-end tests: 26-assertion backend smoke test; full import of the real
  `expenses_export.csv` (all 18 anomaly types detected); a from-scratch **clean** CSV that the
  importer confirms is 0-anomaly; and the **money invariant** (every expense's splits sum exactly
  to its total — verified `60/60` in SQL).
- Can trace any CSV anomaly to the exact detector in `importPipeline.js` and explain the policy
  it follows (cross-referenced in `SCOPE.md`).
