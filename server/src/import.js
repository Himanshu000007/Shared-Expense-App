// Import feature — upload the CSV, stage every row with its detected anomalies,
// let the user review the blockers (Meera's requirement), then commit approved
// rows into real expenses/settlements. Nothing is financial until commit.
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { query, withTransaction } from './db.js';
import { ApiError } from './helpers.js';
import { requireAuth } from './middleware.js';
import { assertGroupAccess, loadMembers } from './groups.js';
import { parseCsv } from './csv.js';
import { analyze, resolveName } from './importPipeline.js';
import { getRate } from './fx.js';
import { computeSplits } from './splitEngine.js';
import { toMinor } from './money.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const router = Router();
router.use(requireAuth);

// POST /api/groups/:id/import — parse + detect + stage; returns the report.
router.post('/groups/:id/import', upload.single('file'), async (req, res, next) => {
  try {
    const group = await assertGroupAccess(req.params.id, req.userId);
    const csvText = req.file ? req.file.buffer.toString('utf8') : req.body?.csv;
    if (!csvText) throw new ApiError(400, 'attach the CSV as form field "file" (or body.csv)');

    const { records } = parseCsv(csvText);
    const members = await loadMembers(group.id);
    const { rows, report } = analyze(records, { baseCurrency: group.base_currency, members });

    // Persist the staging in one transaction.
    const importId = randomUUID();
    await withTransaction(async (conn) => {
      await conn.query(
        'INSERT INTO imports (id, group_id, filename, status, created_by) VALUES (?, ?, ?, ?, ?)',
        [importId, group.id, req.file?.originalname || null, 'reviewing', req.userId]
      );
      for (const r of rows) {
        const rowId = randomUUID();
        await conn.query(
          `INSERT INTO import_rows (id, import_id, line_number, raw, normalized, status, target_kind)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [rowId, importId, r.rowNumber, JSON.stringify(r.raw), JSON.stringify(r.normalized), r.status, r.targetKind]
        );
        for (const a of r.anomalies) {
          await conn.query(
            `INSERT INTO import_anomalies (id, import_row_id, type, severity, description, suggested_action, requires_review)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [randomUUID(), rowId, a.type, a.severity, a.description, a.suggestedAction, a.requiresReview ? 1 : 0]
          );
        }
      }
    });

    res.status(201).json({ importId, report });
  } catch (err) {
    next(err);
  }
});

// GET /api/imports/:importId/report — the Import Report from the staged data.
router.get('/imports/:importId/report', async (req, res, next) => {
  try {
    await assertImportAccess(req.params.importId, req.userId);
    res.json(await loadReport(req.params.importId));
  } catch (err) {
    next(err);
  }
});

// GET /api/imports/:importId — full staged rows + anomalies (for the review UI).
router.get('/imports/:importId', async (req, res, next) => {
  try {
    await assertImportAccess(req.params.importId, req.userId);
    const rows = await loadRows(req.params.importId);
    res.json({ importId: req.params.importId, rows });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/imports/:importId/rows/:rowId — approve / reject a staged row.
router.patch('/imports/:importId/rows/:rowId', async (req, res, next) => {
  try {
    await assertImportAccess(req.params.importId, req.userId);
    const { action, resolution } = req.body || {};
    if (!['approve', 'reject'].includes(action)) throw new ApiError(400, 'action must be "approve" or "reject"');
    const status = action === 'approve' ? 'approved' : 'rejected';

    const { rows: result } = await query(
      'UPDATE import_rows SET status = ?, resolution = ? WHERE id = ? AND import_id = ?',
      [status, resolution ? JSON.stringify(resolution) : null, req.params.rowId, req.params.importId]
    );
    if (result.affectedRows === 0) throw new ApiError(404, 'row not found');
    res.json({ ok: true, status });
  } catch (err) {
    next(err);
  }
});

// POST /api/imports/:importId/commit — insert approved/auto rows for real.
router.post('/imports/:importId/commit', async (req, res, next) => {
  try {
    const imp = await assertImportAccess(req.params.importId, req.userId);
    if (imp.status === 'committed') throw new ApiError(409, 'this import was already committed');

    const members = await loadMembers(imp.group_id);
    const { rows: g } = await query('SELECT base_currency FROM `groups` WHERE id = ?', [imp.group_id]);
    const base = g[0].base_currency;

    const staged = await loadRows(req.params.importId);
    const summary = { expenses: 0, settlements: 0, dropped: 0, skipped: [] };

    for (const row of staged) {
      // Only commit rows that need no review (clean/auto) or were approved.
      if (!['clean', 'auto_resolved', 'approved'].includes(row.status)) {
        summary.skipped.push({ rowNumber: row.line_number, reason: `status ${row.status}` });
        continue;
      }
      if (row.target_kind === 'dropped') { summary.dropped++; continue; }

      try {
        const ref = await commitRow(row, { members, base, groupId: imp.group_id });
        if (ref?.kind === 'expense') summary.expenses++;
        if (ref?.kind === 'settlement') summary.settlements++;
        await query('UPDATE import_rows SET committed_ref = ? WHERE id = ?', [ref.id, row.id]);
      } catch (e) {
        summary.skipped.push({ rowNumber: row.line_number, reason: e.message });
      }
    }

    await query('UPDATE imports SET status = ?, committed_at = NOW() WHERE id = ?', ['committed', req.params.importId]);
    res.json({ committed: true, summary });
  } catch (err) {
    next(err);
  }
});

// --- commit helpers --------------------------------------------------------
async function commitRow(row, ctx) {
  const n = row.normalized; // parsed JSON (object)
  const { rate, fxRateId } = await getRate(n.currency, ctx.base, n.date);
  const amountMinor = Math.round(toMinor(n.amount) * rate);

  if (row.target_kind === 'settlement') {
    const fromId = n.payer.memberId;
    const toId = resolveName(row.raw.split_with, ctx.members).memberId;
    if (!fromId || !toId) throw new Error('settlement parties did not resolve');
    const id = randomUUID();
    await query(
      `INSERT INTO settlements (id, group_id, from_member, to_member, amount_minor, settled_on, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, ctx.groupId, fromId, toId, amountMinor, n.date, n.notes || null]
    );
    return { kind: 'settlement', id };
  }

  // expense
  const payerId = n.payer.memberId;
  if (!payerId) throw new Error('payer did not resolve');
  const active = n.participants.filter((p) => p.memberId && p.active);
  if (active.length === 0) throw new Error('no active participants');

  const splits = buildSplits(n, active, amountMinor, ctx.members);

  const expenseId = randomUUID();
  await withTransaction(async (conn) => {
    await conn.query(
      `INSERT INTO expenses
        (id, group_id, description, paid_by, original_amount_minor, original_currency,
         fx_rate_id, amount_minor, split_type, expense_date, is_refund, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [expenseId, ctx.groupId, n.description, payerId, toMinor(n.amount), n.currency,
       fxRateId, amountMinor, normalizeSplitType(n.splitType), n.date, n.isRefund ? 1 : 0, n.notes || null]
    );
    for (const s of splits) {
      await conn.query(
        'INSERT INTO expense_splits (id, expense_id, member_id, raw_value, owed_minor) VALUES (?, ?, ?, ?, ?)',
        [randomUUID(), expenseId, s.memberId, s.rawValue, s.owedMinor]
      );
    }
  });
  return { kind: 'expense', id: expenseId };
}

// Treat a blank/unknown split type as equal (the SPLIT_TYPE_MISMATCH policy
// also resolves to equal).
const VALID = ['equal', 'unequal', 'percentage', 'share'];
const normalizeSplitType = (st) => (VALID.includes(st) ? st : 'equal');

function buildSplits(n, active, amountMinor, members) {
  const st = normalizeSplitType(n.splitType);
  const ids = active.map((p) => p.memberId);

  if (st === 'equal') {
    return computeSplits({ splitType: 'equal', amountMinor, participants: ids });
  }

  // Map "Name value" details onto member ids for the active participants.
  const valueByMember = {};
  for (const d of n.details) {
    const r = resolveName(d.name, members);
    if (r.memberId) valueByMember[r.memberId] = d.value;
  }
  let details = {};
  for (const id of ids) {
    if (valueByMember[id] === undefined) throw new Error('missing split detail for a participant');
    details[id] = valueByMember[id];
  }

  // Normalize percentages to 100 (covers the 110% rows once approved).
  if (st === 'percentage') {
    const sum = ids.reduce((a, id) => a + details[id], 0);
    if (sum > 0 && Math.abs(sum - 100) > 0.01) {
      for (const id of ids) details[id] = (details[id] * 100) / sum;
    }
  }
  return computeSplits({ splitType: st, amountMinor, participants: ids, details });
}

// --- shared loaders --------------------------------------------------------
async function assertImportAccess(importId, userId) {
  const { rows } = await query('SELECT * FROM imports WHERE id = ?', [importId]);
  if (!rows[0]) throw new ApiError(404, 'import not found');
  await assertGroupAccess(rows[0].group_id, userId);
  return rows[0];
}

async function loadRows(importId) {
  const { rows } = await query(
    'SELECT * FROM import_rows WHERE import_id = ? ORDER BY line_number',
    [importId]
  );
  const { rows: anomalies } = await query(
    `SELECT a.* FROM import_anomalies a
     JOIN import_rows r ON r.id = a.import_row_id WHERE r.import_id = ?`,
    [importId]
  );
  const byRow = {};
  for (const a of anomalies) (byRow[a.import_row_id] ||= []).push(a);
  return rows.map((r) => ({ ...r, anomalies: byRow[r.id] || [] }));
}

async function loadReport(importId) {
  const rows = await loadRows(importId);
  const totals = { rows: rows.length, clean: 0, autoResolved: 0, needsReview: 0,
    approved: 0, rejected: 0, expenses: 0, settlements: 0, dropped: 0, anomalies: 0 };
  const byType = {};
  for (const r of rows) {
    if (r.status === 'clean') totals.clean++;
    if (r.status === 'auto_resolved') totals.autoResolved++;
    if (r.status === 'needs_review') totals.needsReview++;
    if (r.status === 'approved') totals.approved++;
    if (r.status === 'rejected') totals.rejected++;
    if (r.target_kind === 'expense') totals.expenses++;
    if (r.target_kind === 'settlement') totals.settlements++;
    if (r.target_kind === 'dropped') totals.dropped++;
    for (const a of r.anomalies) { totals.anomalies++; byType[a.type] = (byType[a.type] || 0) + 1; }
  }
  return {
    totals,
    anomaliesByType: byType,
    rows: rows.map((r) => ({
      rowNumber: r.line_number,
      description: JSON.parse(typeof r.raw === 'string' ? r.raw : JSON.stringify(r.raw)).description,
      status: r.status,
      targetKind: r.target_kind,
      anomalies: r.anomalies.map((a) => ({ type: a.type, severity: a.severity, description: a.description, action: a.suggested_action, requiresReview: !!a.requires_review })),
    })),
  };
}

export default router;
