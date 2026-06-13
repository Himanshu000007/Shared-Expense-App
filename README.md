# Shared Expenses App

A shared-expenses tracker for a group of flatmates: groups with members who join and
leave over time, multi-currency expenses with several split types, balances, settlements,
and a CSV importer that detects and surfaces messy data instead of silently guessing.

- **Stack:** PERN — **P**ostgreSQL · **E**xpress · **R**eact · **N**ode
- **Data access:** hand-written, parameterized SQL via `node-postgres` (no ORM)
- **AI used:** Claude (Anthropic) as the development collaborator — see `AI_USAGE.md`

Project docs: [`SCOPE.md`](SCOPE.md) (anomaly log + DB schema) · [`DECISIONS.md`](DECISIONS.md) (decision log) · [`docs/api/`](docs/api) (endpoint specs).

---

## 1. Prerequisites

- **Node.js** ≥ 18 (developed on v25)
- **Homebrew** (macOS) — used to install PostgreSQL below

---

## 2. Set up PostgreSQL (one time)

Pick the section for your OS. All three end with the **same** database, so the
`.env` connection string in step 3 works regardless of which you choose.

### 2a. macOS (Homebrew)

```bash
# Install and start PostgreSQL 16
brew install postgresql@16
brew services start postgresql@16

# Put psql / createdb on your PATH (postgresql@16 is keg-only, so not auto-linked)
echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Verify the client works (should print: psql (PostgreSQL) 16.x)
psql --version

# Create the database
createdb shared_expenses

# Create a "postgres" login role so the default connection string works as-is
psql postgres -c "CREATE ROLE postgres WITH LOGIN SUPERUSER PASSWORD 'postgres';"
```

Postgres now runs in the background and restarts at login.

### 2b. Windows

**Install PostgreSQL 16.** Easiest is winget in PowerShell (or grab the installer
from https://www.postgresql.org/download/windows/):

```powershell
winget install -e --id PostgreSQL.PostgreSQL.16
```

During the installer:
- **Set the `postgres` superuser password to `postgres`** (so the default `.env` works).
- Keep the **port** at **5432**.
- The installer already creates the `postgres` login role, so no extra role step is needed.

**Add the tools to your PATH** so `psql` / `createdb` work in any terminal. In PowerShell:

```powershell
# For this session only:
$env:Path += ";C:\Program Files\PostgreSQL\16\bin"

# Or permanently (new terminals will pick it up):
setx PATH "$($env:Path);C:\Program Files\PostgreSQL\16\bin"

# Verify (should print: psql (PostgreSQL) 16.x)
psql --version
```

**Create the database** (it will prompt for the `postgres` password you set — `postgres`):

```powershell
createdb -U postgres shared_expenses
```

> Don't want to touch PATH? Use the **"SQL Shell (psql)"** app the installer adds
> from the Start menu, then run: `CREATE DATABASE shared_expenses;`

### 2c. Any OS — Docker (alternative)

If you have Docker, skip the native install entirely:

```bash
docker run --name se-postgres \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=shared_expenses \
  -p 5432:5432 -d postgres:16
```

This creates the `postgres` user, the password `postgres`, and the
`shared_expenses` database in one go.

---

## 3. Configure the backend (one time)

```bash
cd server
npm install
cp .env.example .env
```

The default `.env` already matches the database created above:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/shared_expenses"
JWT_SECRET="change-me-to-a-long-random-string"
JWT_TTL="7d"
PORT=4000
```

---

## 4. Start the app

Run these from the `server/` folder.

```bash
# 1. Create the database tables (safe to re-run; loads .env automatically)
npm run db:migrate
#    → "Migration applied."

# 2. Start the API server
npm run dev
#    → "API listening on :4000"
```

The API is now live at **http://localhost:4000**. Leave this terminal running.

> Frontend (`client/`) will be added later; this section will be updated when it is.

---

## 5. Test the API

Open a **second terminal** and run the calls below. Quick health check first:

```bash
curl -s localhost:4000/api/health
# → {"status":"ok"}
```

### Auth endpoints

```bash
# Register → expect 201 { user, token }
curl -s -X POST localhost:4000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Himanshu","email":"himanshu@google.com","password":"password123"}'

# Login → expect 200 { user, token }   (copy the "token" from the response)
curl -s -X POST localhost:4000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"himanshu@google.com","password":"password123"}'

# Me → expect 200 { user }   (paste the token from above)
curl -s localhost:4000/api/auth/me -H "Authorization: Bearer <PASTE_TOKEN>"
```

### Error paths (these are supposed to fail — that's the point)

```bash
# Duplicate email → expect 409 "Email already registered"
curl -s -X POST localhost:4000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Himanshu","email":"himanshu@google.com","password":"password123"}'

# Wrong password → expect 401 "Invalid email or password"
curl -s -X POST localhost:4000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"himanshu@google.com","password":"wrongpass"}'

# No token → expect 401 "Missing or malformed Authorization header"
curl -s localhost:4000/api/auth/me

# Bad input (short password) → expect 400 with field errors
curl -s -X POST localhost:4000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"X","email":"bad","password":"123"}'
```

| Call | Expected status |
|---|---|
| register (new email) | 201 |
| login (correct password) | 200 |
| me (valid token) | 200 |
| register (duplicate email) | 409 |
| login (wrong password) | 401 |
| me (no token) | 401 |
| register (invalid body) | 400 |

---

## Project status

- [x] Auth — register / login / me (JWT + bcrypt)
- [ ] Groups + time-bounded membership
- [ ] Expenses + split types
- [ ] Balances + settlements
- [ ] CSV import + anomaly report
- [ ] Frontend (`client/`)
