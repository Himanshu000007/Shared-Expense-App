// Settlements feature — record a payment from one member to another
// (settling a debt). These move money between two people without creating
// shared cost; the balance engine applies them on top of expense splits.
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query } from './db.js';
import { ApiError } from './helpers.js';
import { requireAuth, validate } from './middleware.js';
import { assertGroupAccess, loadMembers, today } from './groups.js';
import { toMinor } from './money.js';

const createSettlementSchema = z.object({
  fromMember: z.string().uuid(),
  toMember: z.string().uuid(),
  amount: z.number().positive('amount must be > 0'),
  settledOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').optional(),
  notes: z.string().max(500).optional(),
});

const router = Router();
router.use(requireAuth);

// Record a payment fromMember -> toMember in the group's base currency.
router.post('/groups/:id/settlements', validate(createSettlementSchema), async (req, res, next) => {
  try {
    await assertGroupAccess(req.params.id, req.userId);
    const body = req.body;
    if (body.fromMember === body.toMember) {
      throw new ApiError(400, 'fromMember and toMember must differ');
    }

    const ids = new Set((await loadMembers(req.params.id)).map((m) => m.id));
    if (!ids.has(body.fromMember) || !ids.has(body.toMember)) {
      throw new ApiError(400, 'both members must belong to this group');
    }

    const id = randomUUID();
    await query(
      `INSERT INTO settlements (id, group_id, from_member, to_member, amount_minor, settled_on, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, req.params.id, body.fromMember, body.toMember, toMinor(body.amount), body.settledOn || today(), body.notes || null]
    );
    const { rows } = await query('SELECT * FROM settlements WHERE id = ?', [id]);
    res.status(201).json({ settlement: rows[0] });
  } catch (err) {
    next(err);
  }
});

// List a group's settlements.
router.get('/groups/:id/settlements', async (req, res, next) => {
  try {
    await assertGroupAccess(req.params.id, req.userId);
    const { rows } = await query(
      'SELECT * FROM settlements WHERE group_id = ? ORDER BY settled_on DESC, created_at DESC',
      [req.params.id]
    );
    res.json({ settlements: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
