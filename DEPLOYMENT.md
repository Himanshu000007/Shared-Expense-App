# Deployment

The app deploys as three pieces:

| Piece | Host | Why |
|---|---|---|
| MySQL database | **Railway** (MySQL plugin) | managed MySQL, one click |
| Express API (`server/`) | **Railway** (Node service) | runs in the same project as the DB (private networking) |
| React frontend (`client/`) | **Vercel** | best static/Vite host, free |

You need: a **GitHub repo** with this code pushed, a **Railway** account, and a **Vercel** account.

> Prefer fully free? See [Alternative: Render + Aiven](#alternative-fully-free) at the bottom. The code is identical; only the dashboards differ.

---

## Step 0 — Push the latest code

```bash
git add -A
git commit -m "chore: production config (ssl, start:prod, vercel rewrites)"
git push
```

---

## Step 1 — Database + API on Railway

1. Go to **railway.app → New Project → Deploy from GitHub repo** → pick this repo.
2. **Add MySQL:** in the project, click **New → Database → Add MySQL**. Railway provisions it and exposes a `MYSQL_URL` variable.
3. **Configure the API service** (the one created from your repo):
   - **Settings → Source → Root Directory:** `server`
   - **Settings → Deploy → Custom Start Command:** `npm run start:prod`
     (this runs the migration, then starts the server)
4. **Settings → Variables** on the API service — add:
   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{MySQL.MYSQL_URL}}` &nbsp;(reference — type it exactly; Railway links it to the MySQL service) |
   | `JWT_SECRET` | a long random string (e.g. run `openssl rand -hex 32`) |
   | `JWT_TTL` | `7d` |

   > Railway sets `PORT` automatically and the app reads it. Leave `DB_SSL` unset (Railway's internal network doesn't need TLS).
5. **Generate a public URL:** API service → **Settings → Networking → Generate Domain**. You get something like `https://shared-expenses-api.up.railway.app`.
6. **Verify:** open `https://<your-api-domain>/api/health` → should show `{"status":"ok"}`.

The migration ran on boot, so the tables (and the seeded USD→INR rate) exist in the production MySQL.

---

## Step 2 — Frontend on Vercel

1. Go to **vercel.com → Add New → Project** → import the same GitHub repo.
2. **Root Directory:** `client` (Vercel auto-detects Vite — build `npm run build`, output `dist`).
3. **Environment Variables** — add:
   | Variable | Value |
   |---|---|
   | `VITE_API_URL` | `https://<your-api-domain>/api` &nbsp;(the Railway API URL from Step 1.5, **with `/api`**) |
4. **Deploy.** Vercel gives you the public app URL, e.g. `https://shared-expenses.vercel.app` — **this is the URL you submit.**

`client/vercel.json` already adds the SPA rewrite, so deep links like `/groups/:id` work on refresh.

---

## Step 3 — Smoke test the live app

1. Open the Vercel URL → register an account.
2. Create a group, add members, add an expense, check balances.
3. Open the **Import** tab and upload `expenses_export.csv` → confirm the anomaly report appears and commit works.

Done — that Vercel URL is your public deployed app.

---

## Notes

- **CORS:** the API uses `cors()` (open) and Bearer tokens (no cookies), so the Vercel origin can call it with no extra config.
- **Redeploys:** push to GitHub → both Railway and Vercel auto-redeploy. The migration is idempotent (`CREATE TABLE IF NOT EXISTS`), so it's safe each boot.
- **Env never committed:** real secrets live only in the Railway/Vercel dashboards; `.env` is gitignored.

---

## Alternative: fully free

If you want $0 hosting:

- **API:** [Render](https://render.com) → New **Web Service** → root `server`, build `npm install`, start `npm run start:prod`. (Free tier sleeps when idle — first request after idle is slow.)
- **MySQL:** [Aiven](https://aiven.io) free MySQL plan. Its connection string requires TLS, so also set `DB_SSL=true` on the API service. Use the Aiven URL as `DATABASE_URL`.
- **Frontend:** Vercel, same as Step 2.
