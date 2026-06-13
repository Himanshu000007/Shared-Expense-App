// Auth feature — everything for /api/auth in one file:
//   1. request validation (zod)
//   2. data access (hand-written SQL)
//   3. routes + handlers
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from './db.js';
import { ApiError, signToken, toPublicUser } from './helpers.js';
import { validate, requireAuth } from './middleware.js';

const BCRYPT_COST = 12;

// --- 1. request validation -------------------------------------------------
const registerSchema = z.object({
  name: z.string().trim().min(1, 'required').max(80, 'max 80 chars'),
  email: z.string().trim().email('must be a valid email'),
  password: z.string().min(8, 'min 8 characters'),
});

const loginSchema = z.object({
  email: z.string().trim().min(1, 'required'),
  password: z.string().min(1, 'required'),
});

// --- 2. data access (raw SQL) ----------------------------------------------
async function findUserByEmail(email) {
  const { rows } = await query('SELECT * FROM users WHERE email = ?', [email]);
  return rows[0] || null;
}

async function findUserById(id) {
  const { rows } = await query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0] || null;
}

async function createUser({ name, email, passwordHash }) {
  // MySQL has no RETURNING: generate the UUID here, insert it, then read back.
  const id = randomUUID();
  await query(
    `INSERT INTO users (id, name, email, password_hash)
     VALUES (?, ?, ?, ?)`,
    [id, name, email, passwordHash]
  );
  return findUserById(id);
}

// --- 3. routes -------------------------------------------------------------
const router = Router();

// POST /api/auth/register — create account, log in immediately.
router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const email = req.body.email.toLowerCase();
    if (await findUserByEmail(email)) {
      throw new ApiError(409, 'Email already registered');
    }
    const passwordHash = await bcrypt.hash(req.body.password, BCRYPT_COST);
    const user = await createUser({ name: req.body.name, email, passwordHash });
    res.status(201).json({ user: toPublicUser(user), token: signToken(user) });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login — verify credentials, return user + token.
router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const email = req.body.email.toLowerCase();
    const user = await findUserByEmail(email);
    // Same error for unknown email and wrong password — no email enumeration.
    if (!user || !(await bcrypt.compare(req.body.password, user.password_hash))) {
      throw new ApiError(401, 'Invalid email or password');
    }
    res.json({ user: toPublicUser(user), token: signToken(user) });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — current user resolved from the Bearer token.
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await findUserById(req.userId);
    if (!user) throw new ApiError(404, 'User not found');
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

export default router;
