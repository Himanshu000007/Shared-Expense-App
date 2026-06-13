// Expenses feature — create/list/read expenses with all four split types,
// multi-currency conversion, and time-bounded membership validation.
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query, withTransaction } from './db.js';
import { ApiError } from './helpers.js';
import { requireAuth, validate } from './middleware.js';
import { assertGroupAccess, loadMembers, isActiveOn } from './groups.js';
import { getRate } from './fx.js';
import { computeSplits } from './splitEngine.js';
import { toMinor } from './money.js';

// --- 1. validation ---------------------------------------------------------
const createExpenseSchema = z.object({
  description: z.string().trim().min(1, 'required').max(255),
  paidBy: z.string().uuid('paidBy must be a member id'),
  amount: z.number().positive('amount must be > 0'),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  splitType: z.enum(['equal', 'unequal', 'percentage', 'share']),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD'),
  splitWith: z.array(z.string().uuid()).min(1, 'at least one participant'),
  details: z.record(z.union([z.number(), z.string()])).optional(),
  notes: z.string().max(500).optional(),
  isRefund: z.boolean().optional(),
});

// --- 2. data shaping -------------------------------------------------------
async function loadExpenseWithSplits(expenseId) {
  const { rows: e } = await query('SELECT * FROM expenses WHERE id = ?', [expenseId]);
  if (!e[0]) return null;
  const { rows: splits } = await query(
    'SELECT member_id, raw_value, owed_minor FROM expense_splits WHERE expense_id = ?',
    [expenseId]
  );
  return { ...e[0], splits };
}

// --- 3. routes -------------------------------------------------------------
const router = Router();
router.use(requireAuth);

// Create an expense in a group.
router.post('/groups/:id/expenses', validate(createExpenseSchema), async (req, res, next) => {
  try {
    const group = await assertGroupAccess(req.params.id, req.userId);
    const body = req.body;

    // All participants (incl. payer) must be members of THIS group...
    const members = await loadMembers(group.id);
    const byId = new Map(members.map((m) => [m.id, m]));
    const everyone = [body.paidBy, ...body.splitWith];
    for (const id of everyone) {
      const m = byId.get(id);
      if (!m) throw new ApiError(400, `member ${id} is not in this group`);
      // ...and active on the expense date (Sam/Meera time-bounded rule).
      if (!isActiveOn(m, body.expenseDate)) {
        throw new ApiError(400, `${m.display_name} was not a member on ${body.expenseDate}`);
      }
    }

    // Convert to the group's base currency.
    const currency = body.currency || group.base_currency;
    const originalMinor = toMinor(body.amount);
    const { rate, fxRateId } = await getRate(currency, group.base_currency, body.expenseDate);
    const amountMinor = Math.round(originalMinor * rate);

    // Compute per-member owed amounts (throws 400 on bad split spec).
    const splits = computeSplits({
      splitType: body.splitType,
      amountMinor,
      participants: body.splitWith,
      details: body.details || {},
    });

    const expenseId = randomUUID();
    await withTransaction(async (conn) => {
      await conn.query(
        `INSERT INTO expenses
           (id, group_id, description, paid_by, original_amount_minor, original_currency,
            fx_rate_id, amount_minor, split_type, expense_date, is_refund, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          expenseId, group.id, body.description, body.paidBy, originalMinor, currency,
          fxRateId, amountMinor, body.splitType, body.expenseDate, body.isRefund ? 1 : 0,
          body.notes || null,
        ]
      );
      for (const s of splits) {
        await conn.query(
          `INSERT INTO expense_splits (id, expense_id, member_id, raw_value, owed_minor)
           VALUES (?, ?, ?, ?, ?)`,
          [randomUUID(), expenseId, s.memberId, s.rawValue, s.owedMinor]
        );
      }
    });

    res.status(201).json({ expense: await loadExpenseWithSplits(expenseId) });
  } catch (err) {
    next(err);
  }
});

// List a group's expenses (newest first).
router.get('/groups/:id/expenses', async (req, res, next) => {
  try {
    await assertGroupAccess(req.params.id, req.userId);
    const { rows } = await query(
      'SELECT * FROM expenses WHERE group_id = ? ORDER BY expense_date DESC, created_at DESC',
      [req.params.id]
    );
    res.json({ expenses: rows });
  } catch (err) {
    next(err);
  }
});

// One expense with its splits.
router.get('/expenses/:expenseId', async (req, res, next) => {
  try {
    const expense = await loadExpenseWithSplits(req.params.expenseId);
    if (!expense) throw new ApiError(404, 'Expense not found');
    await assertGroupAccess(expense.group_id, req.userId);
    res.json({ expense });
  } catch (err) {
    next(err);
  }
});

export default router;
