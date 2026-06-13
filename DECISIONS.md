# DECISIONS.md

A log of every significant product/engineering decision, the options considered, and why the chosen option won. Ordered roughly by how foundational the decision is. Each entry is something I expect to defend in the live session.

---

## D1 — Stack: PERN (Postgres · Express · React · Node), not MERN

**Context.** The brief mentions a "MERN" stack (M = MongoDB) but **also** mandates "Use relational DBs only" (requirement #5). MongoDB is not relational, so the two cannot both hold. The hard requirement wins.

**Options.**
- (a) MongoDB — violates the explicit "relational DBs only" requirement. Rejected.
- (b) PostgreSQL with the Express / React / Node parts retained → the **PERN stack**.

**Decision: This project uses the PERN stack — PostgreSQL + Express + React + Node, with Prisma as the ORM.** The MongoDB "M" of MERN is replaced by PostgreSQL because the requirement demands a relational database, and because the domain is inherently relational and transactional: time-bounded membership, per-member split ledgers, and balance math that must sum exactly all want foreign keys, joins, and ACID transactions. Wherever the original brief said "MERN", the project as built is **PERN** — this is a deliberate, documented substitution, not an oversight.

**Trade-off / risk.** A reviewer skimming for the literal word "MongoDB" might flag it. Mitigation: this entry and the README state the PERN choice up front so the swap reads as an engineering decision driven by requirement #5.

---

## D2 — Money stored as integer minor units (paise)

**Options.** (a) floats/doubles; (b) `numeric`/decimal; (c) integer minor units.

**Decision: (c) integers in paise.** Floating point can't represent ₹0.10 exactly and accumulates error across many splits — fatal when Rohan asks why his balance is off by a paisa. Integers make every comparison exact. Display layer divides by 100. `numeric` would also be safe but integers make the largest-remainder rounding (D3) trivial and unambiguous.

---

## D3 — Largest-remainder rounding for splits

**Context.** ₹100 split 3 ways = ₹33.333…; the parts must still sum to ₹100.

**Options.** (a) round each share independently (sums to ₹99.99); (b) largest-remainder (give the leftover paise to the members with the largest fractional remainder).

**Decision: (b).** Guarantees `Σ shares == total` to the paise. Deterministic and ordering-stable (ties broken by member id) so the same input always produces the same allocation — important when the evaluators recompute a balance by hand. This is the "rounding rule" they may ask me to change live; it lives in one pure function so it is a one-line swap.

---

## D4 — Currency conversion: per-date historical, fixed fallback, stored in a table

**Context.** Priya: "the sheet pretends a dollar is a rupee." USD appears on the Goa-trip rows.

**Options.** (a) silent 1:1 (the bug Priya is complaining about) — rejected outright; (b) one fixed pinned rate; (c) per-date historical rate from an FX API.

**Decision: (c) with (b) as fallback, both persisted in `exchange_rates`.** For each USD expense we look up the rate for that **expense date**. If no dated rate is available (API down, offline, weekend with no quote), we fall back to a documented pinned rate stored as a `source = 'fixed'` row. Storing rates in a table (not hardcoding) means conversions are reproducible and auditable: the Import Report and each expense record which `exchange_rates` row was used.

**Why not just fixed?** It is simpler but less defensible to Priya — a March-9 villa booking and a March-12 refund could legitimately use different real rates. Why not pure API? It adds a hard external dependency and a failure mode; the fixed fallback removes that risk while keeping the historical path as primary.

---

## D5 — Time-bounded membership as a first-class concept

**Context.** Meera left end of March; Sam joined mid-April; Dev/Kabir are guests. Sam: "why would March electricity affect my balance?"

**Options.** (a) static member list per group; (b) `joined_at`/`left_at` window per member and validate every split against the expense date.

**Decision: (b).** Balances are only ever computed over members whose window contains the expense date. This single rule answers Sam (no pre-join liability), Meera (no post-move-out liability), and drives anomaly #18 (Meera wrongly listed on an April grocery split → auto-excluded and flagged).

---

## D6 — Guests (Dev, Kabir) are members without logins

**Options.** (a) force every participant to be a registered user; (b) allow guest members with `user_id = NULL`.

**Decision: (b).** Dev shared real expenses and Kabir joined for one day — their shares must exist for the math to be correct, but neither needs an account. A `is_guest` member captures this. Kabir is created scoped to the single parasailing expense.

---

## D7 — Staged, human-approved import (not a one-shot insert)

**Context.** Meera: "I want to approve anything the app deletes or changes."

**Options.** (a) parse-and-insert in one pass, auto-resolving everything; (b) stage rows → detect anomalies → human reviews blockers → commit in a transaction.

**Decision: (b).** Nothing financial is written until the user commits. Rows needing review (conflicting duplicate, missing payer, bad percentages, ambiguous date) block commit until resolved. Auto-resolvable issues (comma formatting, date reformat, USD conversion) are applied but still listed in the report. This is the difference between "silent guess" (a failing answer per the brief) and "handled deliberately."

---

## D8 — Conflicting duplicates & missing payer → always human review

**Context.** Thalassa ₹2400 vs ₹2450; row with no payer. (Confirmed with stakeholder: always review.)

**Options.** (a) heuristic auto-pick (e.g. keep first / keep higher); (b) always surface both and require a human choice.

**Decision: (b).** The brief explicitly calls out "if two people logged the same dinner with different amounts, which row wins?" as a judgment the app must not make silently. The note "hers is wrong" is a hint, not proof. We show both rows and let the user decide; the choice is recorded with their user id.

**Contrast:** *exact* duplicates (identical amount/payer/date) carry no information loss, so those are auto-deduplicated (survivor + audit link) — see SCOPE #1 vs #2.

---

## D9 — Settlement vs expense reclassification

**Context.** "Rohan paid Aisha back" ₹5000 logged as an expense; "Sam deposit share" paid only to Aisha.

**Options.** (a) import as expenses (wrong — inflates everyone's costs); (b) detect transfer-shaped rows and reclassify to `settlements` after confirmation.

**Decision: (b).** A row with an empty/transfer split, a single counterparty, and/or settlement keywords ("paid back", "deposit") is proposed as a settlement and confirmed by the user. Settlements move money between two people without creating shared cost — which is exactly what these rows are.

---

## D10 — Refunds are signed expenses, not deletions

**Context.** Parasailing `-30 USD` refund.

**Options.** (a) reject negatives as errors; (b) treat a negative as a refund: a valid expense that *reduces* what participants owe (`is_refund = true`).

**Decision: (b), with a confirm step.** A negative can be a refund or a typo, so we flag it for confirmation rather than guessing — but the default interpretation is a refund because the note says "one slot got cancelled." Modelling it as a signed expense keeps the audit trail (Rohan can see the refund line) instead of silently erasing the original charge.

---

## D11 — Percentages that don't sum to 100 → review, offer normalize

**Context.** Two rows total 110%.

**Options.** (a) silently rescale to 100; (b) reject; (c) surface and let the user choose normalize-or-reject.

**Decision: (c).** Silent rescaling is a "magic number" Rohan would object to. We show the user the 110% and offer "normalize proportionally" (each weight × 100/110) or "reject row." The math of normalization is documented so the resulting shares are explainable.

---

## D12 — Name normalization via an alias table

**Context.** `priya`, `Priya S`, `rohan ` (trailing space).

**Options.** (a) fuzzy-match at read time everywhere; (b) resolve once at import into a canonical `group_member`, storing the raw string as a `member_alias`.

**Decision: (b).** Resolve identity once, at the boundary. High-confidence matches (case/whitespace/token) auto-map; ambiguous ones go to review. Downstream code only ever deals with canonical member ids, and the alias table is a permanent record of how each messy string was interpreted — directly auditable in the live session.

---

## D13 — Two balance views: simplified + itemized

**Context.** Aisha wants "one number per person"; Rohan wants "exactly which expenses make that up."

**Options.** Build only one; or build both off the same ledger.

**Decision: build both** off the immutable `expense_splits` ledger. `GET …/balances/simplified` runs a greedy minimum-cash-flow algorithm (who pays whom, fewest transfers) for Aisha. `GET …/members/:id/balance` returns the per-expense breakdown for Rohan. Same source of truth, two projections — neither can disagree with the other.

---

## D14 — REST API (not GraphQL), JWT auth

**Options.** REST vs GraphQL; session vs JWT.

**Decision: REST + JWT.** The resource model (groups, expenses, settlements, imports) maps cleanly to REST; GraphQL's flexibility isn't needed for a fixed, small surface and would add schema overhead I'd have to defend. JWT keeps the API stateless and deployment simple across separate frontend/backend hosts.

---

## D15 — Deployment topology

**Decision.** Frontend (Vite/React static build) on Vercel or Netlify; Express/Node API + managed PostgreSQL on Render or Railway. Rationale: free tiers, managed Postgres with backups, and independent scaling of static frontend vs API. Single public URL for the app (requirement #1), with the API behind `/api`.

---

## D16 — MVC / layered architecture across the whole project

**Context.** The live evaluation says they can "point at any line and ask why it exists." That rewards a predictable structure where responsibility for each line is obvious, over ad-hoc code where logic lives wherever it was first typed.

**Options.** (a) route handlers that parse, validate, run business logic, and hit the DB inline; (b) a layered **MVC** separation on the backend, mirrored by a container/presentational split on the frontend.

**Decision: (b) MVC everywhere.** Both the backend and frontend follow a strict layered separation so every file has one job.

**Backend (Express) — MVC layers:**
- **Model** — Prisma schema + thin data-access modules. The only layer that talks to PostgreSQL.
- **Controller** — one function per route; reads `req`, calls a service, shapes the `res`. No business logic, no SQL.
- **Service** (business logic) — split math, balance engine, the import pipeline, FX conversion, settlement reclassification. Pure, unit-testable, framework-agnostic. **This is where the graded core lives.**
- **Routes** — wire URLs → middleware → controllers.
- **Middleware** — `requireAuth`, validation, error handling.

```
server/
  src/
    models/         # Prisma client + data-access helpers (DB layer)
    controllers/    # auth, group, expense, settlement, balance, import controllers
    services/       # splitEngine, balanceEngine, importPipeline, fx, anomalyDetectors
    routes/         # express routers, one per resource
    middleware/     # requireAuth, validate, errorHandler
    utils/          # money (paise), rounding (largest-remainder), date/csv parsers
    app.js          # express app assembly
    server.js       # entry point
  prisma/
    schema.prisma   # the relational model from SCOPE.md §2
    migrations/
  tests/            # service-layer unit tests (split math, balances, detectors)
```

**Frontend (React) — same spirit:**
```
client/
  src/
    pages/          # route-level views (Login, Groups, GroupDetail, ImportReview)
    components/     # presentational, reusable UI
    services/api/   # one module per backend resource (auth, groups, expenses, import)
    context/        # auth/session state
    hooks/          # data-fetching hooks
    utils/          # money formatting, date display
```

**Rule of thumb enforced in review:** controllers contain no math; services contain no `req`/`res`; models contain no business rules. A balance bug is therefore always in `services/balanceEngine`, never scattered — which is exactly what lets me trace any anomaly to one file in the live session.

---

## Open items to revisit during build
- Exact pinned USD→INR fallback rate value (to be recorded in `exchange_rates` and the README).
- Confidence threshold that separates auto-mapped vs review-required name aliases.
- Whether Kabir's guest share is redistributed if the user excludes him (default: re-split among remaining participants).
