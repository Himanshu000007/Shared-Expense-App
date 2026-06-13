// Balances feature — three views off the same ledger:
//   - net per member                (group summary)
//   - simplified "who pays whom"     (Aisha's one-number-per-person view)
//   - itemized per member           (Rohan's "show me every line" view)
import { Router } from 'express';
import { query } from './db.js';
import { ApiError } from './helpers.js';
import { requireAuth } from './middleware.js';
import { assertGroupAccess, loadMembers } from './groups.js';
import { computeNet, simplify } from './balanceEngine.js';
import { fromMinor } from './money.js';

const router = Router();
router.use(requireAuth);

// Load the ledger for a group. Refunds are applied with flipped sign so a
// refund reduces (rather than adds to) what was spent.
async function loadLedger(groupId) {
  const { rows: expenses } = await query(
    'SELECT id, paid_by, amount_minor, is_refund FROM expenses WHERE group_id = ?',
    [groupId]
  );
  const { rows: splits } = await query(
    `SELECT s.member_id, s.owed_minor, e.is_refund
     FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
     WHERE e.group_id = ?`,
    [groupId]
  );
  const { rows: settlements } = await query(
    'SELECT from_member, to_member, amount_minor FROM settlements WHERE group_id = ?',
    [groupId]
  );

  return {
    expenses: expenses.map((e) => ({
      paidBy: e.paid_by,
      amountMinor: e.is_refund ? -e.amount_minor : e.amount_minor,
    })),
    splits: splits.map((s) => ({
      memberId: s.member_id,
      owedMinor: s.is_refund ? -s.owed_minor : s.owed_minor,
    })),
    settlements: settlements.map((st) => ({
      fromMember: st.from_member,
      toMember: st.to_member,
      amountMinor: st.amount_minor,
    })),
  };
}

// Net balance per member.
router.get('/groups/:id/balances', async (req, res, next) => {
  try {
    await assertGroupAccess(req.params.id, req.userId);
    const members = await loadMembers(req.params.id);
    const net = computeNet(await loadLedger(req.params.id));

    const balances = members.map((m) => ({
      memberId: m.id,
      displayName: m.display_name,
      netMinor: net[m.id] || 0,
      net: fromMinor(net[m.id] || 0),
    }));
    res.json({ baseCurrencyMinorUnits: 'paise', balances });
  } catch (err) {
    next(err);
  }
});

// Simplified settlements — who pays whom, fewest transfers.
router.get('/groups/:id/balances/simplified', async (req, res, next) => {
  try {
    await assertGroupAccess(req.params.id, req.userId);
    const members = await loadMembers(req.params.id);
    const name = new Map(members.map((m) => [m.id, m.display_name]));
    const net = computeNet(await loadLedger(req.params.id));

    const transactions = simplify(net).map((t) => ({
      from: name.get(t.from) || t.from,
      to: name.get(t.to) || t.to,
      amount: fromMinor(t.amountMinor),
      amountMinor: t.amountMinor,
    }));
    res.json({ transactions });
  } catch (err) {
    next(err);
  }
});

// Itemized breakdown for one member — every line that makes up their balance.
router.get('/groups/:id/members/:memberId/balance', async (req, res, next) => {
  try {
    await assertGroupAccess(req.params.id, req.userId);
    const { memberId, id: groupId } = req.params;

    // Lines where they paid (+) and lines where they owe a share (-).
    const { rows: paid } = await query(
      `SELECT id, description, expense_date, amount_minor, is_refund
       FROM expenses WHERE group_id = ? AND paid_by = ?`,
      [groupId, memberId]
    );
    const { rows: owed } = await query(
      `SELECT e.id, e.description, e.expense_date, s.owed_minor, e.is_refund
       FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
       WHERE e.group_id = ? AND s.member_id = ?`,
      [groupId, memberId]
    );
    const { rows: settlements } = await query(
      `SELECT id, from_member, to_member, amount_minor, settled_on
       FROM settlements WHERE group_id = ? AND (from_member = ? OR to_member = ?)`,
      [groupId, memberId, memberId]
    );

    const lines = [];
    for (const p of paid) {
      const v = p.is_refund ? -p.amount_minor : p.amount_minor;
      lines.push({ kind: 'paid', expenseId: p.id, description: p.description, date: p.expense_date, deltaMinor: v });
    }
    for (const o of owed) {
      const v = o.is_refund ? -o.owed_minor : o.owed_minor;
      lines.push({ kind: 'owes_share', expenseId: o.id, description: o.description, date: o.expense_date, deltaMinor: -v });
    }
    for (const st of settlements) {
      const v = st.from_member === memberId ? st.amount_minor : -st.amount_minor;
      lines.push({ kind: 'settlement', settlementId: st.id, date: st.settled_on, deltaMinor: v });
    }

    const netMinor = lines.reduce((a, l) => a + l.deltaMinor, 0);
    res.json({
      memberId,
      netMinor,
      net: fromMinor(netMinor),
      lines: lines.map((l) => ({ ...l, delta: fromMinor(l.deltaMinor) })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
