# SCOPE.md

This document is the authoritative scope artifact for the Shared Expenses App. It contains:

1. **The anomaly log** — every data problem found in `expenses_export.csv`, how it is detected, the policy chosen, and the action taken by the importer.
2. **The database schema** — the relational model that backs the app.

The CSV is **never edited by hand**. Every transformation below happens inside the import pipeline and is recorded in the per-import **Import Report**.

---

## 1. Anomaly Log

### 1.1 How the importer classifies an anomaly

Each parsed row is run through a chain of detectors. Every detector that fires attaches an `anomaly` record with:

- `type` — machine code (e.g. `CONFLICTING_DUPLICATE`)
- `severity` — `info` | `warning` | `blocker`
- `suggested_action` — what the app proposes
- `requires_review` — if `true`, the row cannot be committed until a human approves/overrides (Meera's requirement)

Rows are staged, **not inserted**. A row becomes a real Expense or Settlement only after the import is committed, and only blockers/`requires_review` rows need an explicit human decision first.

### 1.2 The catalog

> Row numbers are 1-based on the data rows (header excluded), matching `expenses_export.csv` lines minus 1. The CSV file line number is given in parentheses.

| # | Row(s) | Anomaly | `type` | Detection | Policy & Action | Review? |
|---|--------|---------|--------|-----------|-----------------|---------|
| 1 | 4 & 5 (L5–6) | **Exact duplicate** — "Dinner at Marina Bites" vs "dinner - marina bites", same date/payer/amount | `EXACT_DUPLICATE` | Fingerprint = (date, payer, amount, currency, normalized-description, sorted split_with). Two rows share a fingerprint. | Keep the first occurrence, drop the second. Dropped row is linked to the survivor for audit. Auto-resolved but listed in report. | No (auto) |
| 2 | 23 & 24 (L24–25) | **Conflicting duplicate** — Thalassa dinner ₹2400 (Aisha) vs ₹2450 (Rohan); note says "hers is wrong" | `CONFLICTING_DUPLICATE` | Same date + fuzzy description match (token-set) but **different amount or payer**. | **Always human review.** Both rows shown side by side; user picks the winning row. No silent guess. | **Yes** |
| 3 | 13 (L14) | **Settlement logged as expense** — "Rohan paid Aisha back" ₹5000, empty `split_type` | `SETTLEMENT_AS_EXPENSE` | `split_type` empty **and** single counterparty in `split_with` **and**/or note keywords ("paid … back", "settlement"). | Reclassify as a **Settlement** (Rohan → Aisha ₹5000), not an expense. Surfaced for confirmation. | Yes (confirm) |
| 4 | 37 (L38) | **Deposit / quasi-settlement** — "Sam deposit share" ₹15000, split_with = Aisha only | `NON_SHARED_TRANSFER` | `split_with` has a single member ≠ payer; note keyword "deposit". | Treat as a **Settlement** (Sam → Aisha ₹15000), excluded from shared-expense splitting. | Yes (confirm) |
| 5 | 12 (L13) | **Missing payer** — blank `paid_by`, note "can't remember who paid" | `MISSING_PAYER` | `paid_by` empty after trim. | **Human review** — user must assign a payer or reject the row. Cannot be committed otherwise. | **Yes** |
| 6 | 6 (L7) | **Number formatting** — `"1,200"` quoted, comma thousands separator | `AMOUNT_FORMAT` | Amount fails strict numeric parse; succeeds after stripping commas/quotes/whitespace. | Normalize to `1200`. Auto-resolved, recorded. | No (auto) |
| 7 | 9 (L10) | **Sub-unit precision** — `899.995` (3 decimals, below paise) | `SUB_UNIT_PRECISION` | Parsed amount has >2 decimal places. | Round half-up to paise → `900.00`. Flag the adjustment in report. | No (auto) |
| 8 | 8, 10, 26 (L9, L11, L27) | **Name inconsistency** — `priya`, `Priya S`, `rohan ` (trailing space) | `UNKNOWN_OR_ALIAS_NAME` | Name not an exact member match; matched via alias table / case-insensitive + trimmed + token match. | Map to canonical member via `member_aliases`. High-confidence matches auto-applied; low-confidence sent to review. | Auto / Yes |
| 9 | 14 & 31 (L15, L32) | **Percentages ≠ 100** — both sum to **110%** (30/30/30/20) | `PERCENT_SUM_INVALID` | Sum of percentage split_details ≠ 100 (±0.01 tolerance). | **Human review.** Offer "normalize proportionally to 100%" or "reject". User chooses; nothing silently rescaled. | **Yes** |
| 10 | 19, 20, 22, 25 (L20, L21, L23, L26) | **Foreign currency** — USD amounts on the Goa trip | `FOREIGN_CURRENCY` | `currency` ≠ base (INR). | Convert to INR using `exchange_rates` for the expense **date** (per-date historical), falling back to the pinned fixed rate if no dated rate exists. Both original and converted amounts stored and shown. | No (auto, logged) |
| 11 | 25 (L26) | **Negative amount / refund** — `-30 USD` "one slot got cancelled" | `NEGATIVE_AMOUNT_REFUND` | Amount < 0. | Treat as a **refund**: a valid reverse-direction expense (payer is *owed back* by participants). Not an error. Flagged so the user can confirm it is a refund and not a typo. | Yes (confirm) |
| 12 | 22 (L23) | **Non-member participant** — "Dev's friend Kabir" in split_with | `NON_MEMBER_PARTICIPANT` | A name in `split_with` is not a group member and has no alias; note marks a one-day guest. | Create Kabir as a **guest participant** (no login, no standing membership) for this expense only, **or** exclude on user choice. Default: include as guest so the split math matches reality. | Yes (confirm) |
| 13 | 27 (L28) | **Missing currency** — blank `currency`, "forgot to set currency" | `MISSING_CURRENCY` | `currency` empty. | Default to base INR (all neighbours are INR) but **flag for confirmation** — never assumed silently in the report. | Yes (confirm) |
| 14 | 30 (L31) | **Zero amount** — `0` Swiggy, "counted twice earlier - fixing later" | `ZERO_AMOUNT` | Amount == 0. | Exclude from balances (no financial effect) and flag as a likely placeholder/void. | Yes (confirm) |
| 15 | 33 (L34) | **Ambiguous date** — `04-05-2026` (Apr 5 vs May 4?), also out of chronological order | `AMBIGUOUS_DATE` | Parseable as two valid calendar dates under different formats; position in file conflicts with sort order. | **Human review** — user picks the intended date. No silent interpretation. | **Yes** |
| 16 | 26 (L27) | **Non-standard date format** — `Mar-14` vs `DD-MM-YYYY` elsewhere | `DATE_FORMAT` | Fails primary `DD-MM-YYYY` parse; matches a known secondary pattern (`Mon-DD`, year inferred from surrounding rows). | Normalize to `2026-03-14`. Auto-resolved, flagged. | No (auto) |
| 17 | 41 (L42) | **split_type ⇄ split_details contradiction** — type `equal` but per-member shares supplied | `SPLIT_TYPE_MISMATCH` | `split_details` present while `split_type` implies none, or details inconsistent with type. | Honour the declared `split_type` (`equal`) and ignore the contradictory shares (here they are all `1` → equal anyway). Flag the contradiction. | Yes (confirm) |
| 18 | 35 (L36) | **Member outside membership window** — Meera in a 02-04 grocery split after moving out end of March | `MEMBER_OUTSIDE_WINDOW` | A split participant's `[joined_at, left_at]` window does not contain the expense date. | Exclude that member from the split and re-divide among valid members. Flagged. (Drives Sam's & Meera's requests.) | Yes (confirm) |
| 19 | 21, 34 (L22, L35) | **Share / ratio split type** — "Aisha 1; Rohan 2; …" | `SPLIT_TYPE_SHARE` (not an error) | `split_type == share`; parse ratio weights. | Supported natively. Listed here only to document that all four split types (equal, unequal, percentage, share) are exercised by the file. | No |

**Count:** 18 distinct anomaly classes detected (requirement was ≥12). #19 is a supported-feature note, not a defect.

### 1.3 Cross-cutting rules these anomalies imply

- **Money** is stored as **integer minor units** (paise). No floats in balances.
- **Rounding** uses the **largest-remainder method** so the sum of per-member shares always equals the expense total to the paise.
- **Membership is time-bounded.** Every split is validated against each member's `[joined_at, left_at]` window (anomaly #18; Sam & Meera's requests).
- **Guests** (Dev, Kabir) participate in expenses without being standing members and without a login.
- **Nothing is deleted or merged on commit without an approval trail** (Meera's requirement) — drops, merges, and reclassifications are all recorded in the Import Report with the deciding user.

---

## 2. Database Schema (MySQL 8)

Relational only — **MySQL 8 (InnoDB)**. Data access is performed using hand-written, parameterized SQL through `mysql2` (no ORM). The schema is maintained as plain SQL migration files. A `JSON` column is used only in import-staging tables for raw and normalized row payloads; all committed financial data is stored in normalized relational tables.

> **Type conventions (MySQL).**
>
> - UUIDs are generated application-side using `crypto.randomUUID()` and stored as `CHAR(36)`.
> - Timestamps use `TIMESTAMP`.
> - Variable text uses `VARCHAR` or `TEXT`.
> - Monetary values use `BIGINT` and are stored in minor units (paise).
> - Decimal values such as exchange rates use `DECIMAL`.
> - Structured staging payloads use MySQL's native `JSON` type.
> - Enumerated values use MySQL `ENUM`.

### 2.1 Entity overview

```
users ──< group_members >── groups
                 │
       member_aliases (name normalization)
                 │
groups ──< expenses >── expense_splits >── group_members
   │           │
   │       exchange_rates (per-date FX, fixed fallback)
   │
groups ──< settlements >── group_members (from / to)

imports ──< import_rows >── import_anomalies      (staging / review)
```

### 2.2 Tables

**`users`** — people who can log in.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| email | VARCHAR(255) UNIQUE | |
| password_hash | text | bcrypt |
| created_at | TIMESTAMP | |

**`groups`**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| base_currency | char(3) | default `INR` |
| created_by | uuid FK→users | |
| created_at | TIMESTAMP | |

**`group_members`** — a person *within a group*. May be a registered user, or a guest (Dev/Kabir) with `user_id = NULL`. Membership is time-bounded.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| group_id | uuid FK→groups | |
| user_id | uuid FK→users NULL | NULL ⇒ guest |
| display_name | text | canonical name e.g. "Priya" |
| is_guest | boolean | true for Dev, Kabir |
| joined_at | date | membership window start |
| left_at | date NULL | NULL ⇒ still a member |
| created_at | TIMESTAMP | |

**`member_aliases`** — maps messy CSV names to a canonical member (anomaly #8).
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| member_id | uuid FK→group_members | |
| alias | text | e.g. `priya`, `Priya S`, `rohan ` (stored normalized) |
| UNIQUE(group_id-scoped alias) | | enforced via member→group |

**`exchange_rates`** — per-date historical rates with a pinned fixed fallback (anomaly #10).
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| base_currency | char(3) | e.g. `USD` |
| quote_currency | char(3) | e.g. `INR` |
| rate | DECIMAL(18,6) | 1 base = `rate` quote |
| rate_date | date NULL | NULL ⇒ the fixed fallback row |
| source | text | `api` \| `fixed` |
| created_at | TIMESTAMP | |
| UNIQUE(base, quote, rate_date) | | |

**`expenses`**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| group_id | uuid FK→groups | |
| description | text | |
| paid_by | uuid FK→group_members | |
| original_amount_minor | bigint | minor units in original currency |
| original_currency | char(3) | |
| fx_rate_id | uuid FK→exchange_rates NULL | rate used, if converted |
| amount_minor | bigint | converted to group base (paise) |
| split_type | enum | `equal`\|`unequal`\|`percentage`\|`share` |
| expense_date | date | |
| is_refund | boolean | true ⇒ negative/refund (anomaly #11) |
| notes | text | |
| import_row_id | uuid FK→import_rows NULL | provenance |
| created_at | TIMESTAMP | |

**`expense_splits`** — one row per participating member; the line-item ledger that powers Rohan's drill-down.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| expense_id | uuid FK→expenses | |
| member_id | uuid FK→group_members | |
| raw_value | DECIMAL(18,4) NULL | the unequal amount / % / share weight as given |
| owed_minor | bigint | final amount this member owes, in base minor units |
| created_at | TIMESTAMP | |

> Net balance for a member = Σ(`amount_minor` of expenses they paid) − Σ(`owed_minor` across all `expense_splits`) ± settlements. Every term traces to a row → Rohan's audit trail.

**`settlements`** — payments / debt settlements (anomalies #3, #4; and the "settle debts" feature).
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| group_id | uuid FK→groups | |
| from_member | uuid FK→group_members | payer |
| to_member | uuid FK→group_members | receiver |
| amount_minor | bigint | base minor units |
| settled_on | date | |
| notes | text | |
| import_row_id | uuid FK→import_rows NULL | provenance |
| created_at | TIMESTAMP | |

**`imports`** — one per CSV upload.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| group_id | uuid FK→groups | |
| filename | text | |
| status | enum | `pending`\|`reviewing`\|`committed`\|`aborted` |
| created_by | uuid FK→users | |
| created_at | TIMESTAMP | |
| committed_at | TIMESTAMP NULL | |

**`import_rows`** — staging; nothing financial is real until commit.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| import_id | uuid FK→imports | |
| row_number | int | line in the CSV |
| raw | JSON | original parsed cells |
| normalized | JSON | post-normalization values |
| status | enum | `pending`\|`auto_resolved`\|`needs_review`\|`approved`\|`rejected` |
| resolution | JSON NULL | the human/auto decision applied |
| target_kind | enum NULL | `expense`\|`settlement`\|`dropped` |
| created_at | TIMESTAMP | |

**`import_anomalies`** — the per-row findings that become the Import Report.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| import_row_id | uuid FK→import_rows | |
| type | text | e.g. `CONFLICTING_DUPLICATE` |
| severity | enum | `info`\|`warning`\|`blocker` |
| description | text | human-readable |
| suggested_action | text | |
| chosen_action | text NULL | filled on resolution |
| resolved_by | uuid FK→users NULL | |
| resolved_at | TIMESTAMP NULL | |

### 2.3 Key invariants enforced in code / constraints

- `expense_date` ∈ `[paid_by.joined_at, COALESCE(paid_by.left_at, ∞)]` and same for every split member — else `MEMBER_OUTSIDE_WINDOW`.
- `Σ expense_splits.owed_minor == expenses.amount_minor` for every expense (checked in a DB transaction at commit).
- A committed `import_rows` row with `status = needs_review` is rejected — every review-required anomaly must be resolved first.
- Money is never stored or compared as floating point.
