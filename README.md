# Shared Expenses App

A shared-expenses tracker for a group of flatmates: groups with members who join and
leave over time, multi-currency expenses with several split types, balances, settlements,
and a CSV importer that detects and surfaces messy data instead of silently guessing.

- **Stack:** MySQL · Express · React · Node (the "M" of MERN, with MySQL as the relational store instead of MongoDB)
- **Data access:** hand-written, parameterized SQL via `mysql2` (no ORM)
- **AI used:** Claude (Anthropic) as the development collaborator — see `AI_USAGE.md`

Project docs: [`SCOPE.md`](SCOPE.md) (anomaly log + DB schema) · [`DECISIONS.md`](DECISIONS.md) (decision log) · [`docs/api/`](docs/api) (endpoint specs).

---

## 1. Prerequisites

- **Node.js** ≥ 18 (developed on v25)
- **Homebrew** (macOS) — used to install MySQL below

---

## 2. Set up MySQL (one time)

Pick the section for your OS. All three end with the **same** database, so the
`.env` connection string in step 3 works regardless of which you choose.

The app connects as user `root` with password `root` to a database named
`shared_expenses` on port `3306` (this matches the default `.env`).

### 2a. macOS (Homebrew)

```bash
# Install and start MySQL 8
brew install mysql
brew services start mysql

# Put the mysql client on your PATH (Homebrew may not auto-link it)
echo 'export PATH="/opt/homebrew/opt/mysql/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Verify the client works (should print: mysql  Ver 8.x)
mysql --version

# Homebrew's MySQL starts with root having an EMPTY password and no client
# password prompt. Set root's password to "root" so the default .env works:
mysql -u root -e "ALTER USER 'root'@'localhost' IDENTIFIED BY 'root'; FLUSH PRIVILEGES;"

# Create the database (now requires the password you just set)
mysql -u root -proot -e "CREATE DATABASE IF NOT EXISTS shared_expenses;"
```

MySQL now runs in the background and restarts at login.

### 2b. Windows

**Install MySQL 8.** Easiest is winget in PowerShell (or grab the MySQL Installer
from https://dev.mysql.com/downloads/installer/):

```powershell
winget install -e --id Oracle.MySQL
```

During the MySQL Installer:
- **Set the `root` password to `root`** (so the default `.env` works).
- Keep the **port** at **3306**.

**Add the client to your PATH** so `mysql` works in any terminal. In PowerShell
(adjust `8.0` to your installed version folder):

```powershell
# For this session only:
$env:Path += ";C:\Program Files\MySQL\MySQL Server 8.0\bin"

# Or permanently (new terminals will pick it up):
setx PATH "$($env:Path);C:\Program Files\MySQL\MySQL Server 8.0\bin"

# Verify (should print: mysql  Ver 8.x)
mysql --version
```

**Create the database** (enter the `root` password `root` when prompted):

```powershell
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS shared_expenses;"
```

> Prefer a GUI? Open **MySQL Workbench** (installed alongside) and run:
> `CREATE DATABASE shared_expenses;`

### 2c. Any OS — Docker (alternative)

If you have Docker, skip the native install entirely:

```bash
docker run --name se-mysql \
  -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=shared_expenses \
  -p 3306:3306 -d mysql:8
```

This creates the `root` user with password `root` and the `shared_expenses`
database in one go. (Give it ~20s to finish starting before migrating.)

---

## 3. Configure the backend (one time)

```bash
cd server
npm install
cp .env.example .env
```

The default `.env` already matches the database created above:

```
DATABASE_URL="mysql://root:root@localhost:3306/shared_expenses"
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

### Frontend (`client/`)

In a **separate terminal** (keep the API running):
```bash
cd client
npm install
npm run dev
```
Open **http://localhost:5173**. The dev server proxies `/api` to the backend on
:4000, so no extra config is needed locally. Register an account, create a group,
add members, add expenses, view balances, and import the CSV from the Import tab.

> For a production build: `npm run build` (output in `client/dist/`); set
> `VITE_API_URL` to the deployed API origin.

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

## API endpoints

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me` |
| Groups | `POST /api/groups` · `GET /api/groups` · `GET /api/groups/:id` |
| Members | `GET /api/groups/:id/members` · `POST /api/groups/:id/members` · `PATCH /api/groups/:id/members/:memberId` |
| Expenses | `POST /api/groups/:id/expenses` · `GET /api/groups/:id/expenses` · `GET /api/expenses/:id` |
| Settlements | `POST /api/groups/:id/settlements` · `GET /api/groups/:id/settlements` |
| Balances | `GET /api/groups/:id/balances` · `GET /api/groups/:id/balances/simplified` · `GET /api/groups/:id/members/:memberId/balance` |
| Import | `POST /api/groups/:id/import` (CSV upload) · `GET /api/imports/:id/report` · `GET /api/imports/:id` · `PATCH /api/imports/:id/rows/:rowId` · `POST /api/imports/:id/commit` |

Expenses support all four split types (`equal`, `unequal`, `percentage`, `share`),
multi-currency conversion (USD→base via `exchange_rates`), refunds, and reject
participants outside their `[joined_at, left_at]` membership window.

The import flow stages every CSV row, detects the data anomalies (see `SCOPE.md`),
holds rows that need a human decision out of the commit (nothing is changed
without approval), and produces an Import Report.

**Run the backend flows end-to-end** (server must be running):
```bash
node scripts/smoke.mjs    # group, all split types, USD, refund, settlement, balances (26 checks)
node scripts/import.mjs   # imports the real expenses_export.csv, prints the anomaly report + commit
node scripts/review.mjs   # proves a flagged row stays out of commit until approved
```

## Project status

- [x] Auth — register / login / me (JWT + bcrypt)
- [x] Groups + time-bounded membership
- [x] Expenses + all four split types + multi-currency + refunds
- [x] Settlements + balances (net, simplified, itemized)
- [x] CSV import + anomaly detection + review/approve + commit + Import Report
- [x] Frontend (`client/`) — login, groups, members, expenses, balances, import review UI
- [x] Deployment guide — see **[DEPLOYMENT.md](DEPLOYMENT.md)** (Railway API+MySQL · Vercel frontend)
