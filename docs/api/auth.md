# API Spec — Auth

Base path: `/api/auth`. All bodies are JSON. Auth uses a **stateless JWT** (Bearer token) — chosen in DECISIONS D14. Tokens are signed with `JWT_SECRET`, carry `{ sub: user.id, email }`, and expire after `JWT_TTL` (default 7d).

A `user` is the login identity. It is distinct from a `group_member` (a person inside a group, who may be a guest with no login). One user can be a member of many groups; the link is `group_members.user_id`.

The public `user` object returned by every endpoint below — **never** includes `password_hash`:

```json
{ "id": "uuid", "name": "Aisha", "email": "aisha@example.com", "createdAt": "2026-06-13T10:00:00Z" }
```

---

## 1. `POST /api/auth/register`

**What it does.** Creates a new user account and logs them in immediately by returning a token. This is how a new person gets into the app.

- **Auth:** none (public).
- **Request body:**
  | field | type | rules |
  |---|---|---|
  | `name` | string | required, 1–80 chars, trimmed |
  | `email` | string | required, valid email, stored lowercase, **unique** |
  | `password` | string | required, min 8 chars |

- **Behavior:**
  1. Validate the body; reject on any rule failure.
  2. Check the email isn't already registered.
  3. Hash the password with **bcrypt** (cost 12) — the plaintext is never stored.
  4. Insert the `users` row.
  5. Sign a JWT for the new user.

- **Success — `201 Created`:**
  ```json
  { "user": { "id": "…", "name": "Aisha", "email": "aisha@example.com", "createdAt": "…" },
    "token": "eyJhbGci…" }
  ```

- **Errors:**
  | status | when |
  |---|---|
  | `400 Bad Request` | missing/invalid field (e.g. bad email, password < 8) |
  | `409 Conflict` | email already registered |

---

## 2. `POST /api/auth/login`

**What it does.** Authenticates an existing user with email + password and returns a fresh token. This is the normal returning-user sign-in.

- **Auth:** none (public).
- **Request body:**
  | field | type | rules |
  |---|---|---|
  | `email` | string | required |
  | `password` | string | required |

- **Behavior:**
  1. Look up the user by (lowercased) email.
  2. Compare the supplied password against `password_hash` with bcrypt.
  3. On match, sign and return a JWT.

- **Success — `200 OK`:** same shape as register (`{ user, token }`).

- **Errors:**
  | status | when |
  |---|---|
  | `400 Bad Request` | missing email or password |
  | `401 Unauthorized` | no such user **or** wrong password — *same* message ("Invalid email or password") so the response can't be used to discover which emails exist |

---

## 3. `GET /api/auth/me`

**What it does.** Returns the currently authenticated user. The frontend calls this on load to restore the session from a stored token and to confirm the token is still valid.

- **Auth:** **required.** Header `Authorization: Bearer <token>`.
- **Request body:** none.
- **Behavior:**
  1. `requireAuth` middleware verifies the JWT signature and expiry, extracts `sub`.
  2. Load the user by id (handles the case where the user was deleted after the token was issued).
  3. Return the public user object.

- **Success — `200 OK`:**
  ```json
  { "user": { "id": "…", "name": "Aisha", "email": "aisha@example.com", "createdAt": "…" } }
  ```

- **Errors:**
  | status | when |
  |---|---|
  | `401 Unauthorized` | missing/malformed `Authorization` header, invalid signature, or expired token |
  | `404 Not Found` | token valid but the user no longer exists |

---

## Shared `requireAuth` middleware

Used by `/me` and every protected route in the rest of the API (groups, expenses, imports…):

1. Read `Authorization: Bearer <token>`; `401` if absent/malformed.
2. `jwt.verify(token, JWT_SECRET)`; `401` on bad signature or expiry.
3. Attach `req.userId = payload.sub` for downstream handlers.

> Note: this middleware only proves *who the user is*. Per-group permission (is this user a member of the group they're acting on?) is a separate check enforced at the group/expense routes, not here.
