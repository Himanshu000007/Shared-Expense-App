// Import pipeline — the graded core. Takes the parsed CSV records + the group's
// members, and for every row: normalizes the messy values, DETECTS anomalies,
// classifies what the row should become (expense / settlement / dropped), and
// decides whether a human must review it before commit.
//
// Pure and DB-free: it returns staged rows + a report. Persisting and committing
// live in import.js. Each anomaly maps to a row in SCOPE.md's anomaly log.

// ---- name normalization & resolution -------------------------------------
// Lowercase, strip apostrophes/punctuation, collapse spaces. "Priya S" -> "priya s",
// "rohan " -> "rohan", "Dev's friend Kabir" -> "devs friend kabir".
export function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Resolve a raw CSV name to a group member.
//   exact  -> normalized name equals a member's name
//   alias  -> first token matches a member ("Priya S" -> Priya)
//   none   -> no match (e.g. "Dev's friend Kabir")
//   empty  -> blank
export function resolveName(raw, members) {
  const input = normalizeName(raw);
  if (!input) return { memberId: null, matchType: 'empty' };

  for (const m of members) {
    if (normalizeName(m.display_name) === input) {
      return { memberId: m.id, matchType: 'exact', member: m };
    }
  }
  const tokens = input.split(' ');
  if (tokens.length > 1) {
    for (const m of members) {
      if (normalizeName(m.display_name) === tokens[0]) {
        return { memberId: m.id, matchType: 'alias', member: m };
      }
    }
  }
  return { memberId: null, matchType: 'none' };
}

// ---- field parsers --------------------------------------------------------
function parseAmount(raw) {
  const trimmed = String(raw ?? '').trim();
  const hadComma = /,/.test(trimmed);
  const cleaned = trimmed.replace(/,/g, '');
  const value = Number(cleaned);
  const decimals = (cleaned.split('.')[1] || '').length;
  return {
    isEmpty: trimmed === '',
    isNaN: Number.isNaN(value),
    hadComma,
    subUnit: decimals > 2,
    value,
  };
}

const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

// Primary format DD-MM-YYYY; secondary "Mon-DD" (year inferred from the rest of
// the file, which is all 2026).
function parseDate(raw, inferYear = '2026') {
  const s = String(raw || '').trim();
  let m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) {
      return { iso: `${yyyy}-${mm}-${dd}`, format: 'standard', day: +dd, month: +mm };
    }
  }
  m = s.match(/^([A-Za-z]{3})-(\d{1,2})$/);
  if (m) {
    const mm = MONTHS[m[1].toLowerCase()];
    if (mm) {
      const dd = m[2].padStart(2, '0');
      return { iso: `${inferYear}-${mm}-${dd}`, format: 'month-name', day: +dd, month: +mm };
    }
  }
  return { iso: null, format: 'invalid' };
}

// "Rohan 700; Priya 400" or "Aisha 30%; Rohan 30%" -> [{ name, value, percent }]
function parseSplitDetails(raw) {
  if (!raw || !raw.trim()) return [];
  return raw.split(';').map((chunk) => {
    const m = chunk.trim().match(/^(.*?)\s+(-?\d+(?:\.\d+)?)\s*(%?)$/);
    if (!m) return null;
    return { name: m[1].trim(), value: Number(m[2]), percent: m[3] === '%' };
  }).filter(Boolean);
}

function isActiveOn(member, date) {
  const j = member.joined_at;
  const l = member.left_at;
  if (j && date < j) return false;
  if (l && date > l) return false;
  return true;
}

// Description normalized for fuzzy duplicate comparison.
const descTokens = (s) => new Set(normalizeName(s).split(' ').filter(Boolean));
function jaccard(a, b) {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

// ---- the analyzer ---------------------------------------------------------
export function analyze(records, ctx) {
  const base = ctx.baseCurrency;
  const members = ctx.members;

  const rows = records.map((rec) => {
    const anomalies = [];
    const add = (type, severity, description, suggestedAction, requiresReview = false) =>
      anomalies.push({ type, severity, description, suggestedAction, requiresReview });

    // --- amount ---
    const a = parseAmount(rec.amount);
    if (a.hadComma) add('AMOUNT_FORMAT', 'info', `amount "${rec.amount}" had a thousands separator`, `parsed as ${a.value}`);
    if (a.subUnit) add('SUB_UNIT_PRECISION', 'info', `amount "${rec.amount}" has sub-paise precision`, `rounded to ${Math.round(a.value * 100) / 100}`);
    let amount = Math.round(Math.abs(a.value) * 100) / 100;
    let isRefund = false;
    let targetKind = 'expense';

    if (a.isEmpty || a.isNaN) add('INVALID_AMOUNT', 'blocker', 'amount is missing or not a number', 'fix or reject the row', true);
    if (!a.isNaN && a.value === 0) { add('ZERO_AMOUNT', 'warning', 'amount is zero', 'exclude from balances (likely a placeholder/void)', true); targetKind = 'dropped'; }
    if (!a.isNaN && a.value < 0) { isRefund = true; add('NEGATIVE_AMOUNT_REFUND', 'warning', `amount is negative (${a.value})`, 'treat as a refund (reverse-direction expense)', true); }

    // --- currency ---
    let currency = String(rec.currency || '').trim().toUpperCase();
    if (!currency) { add('MISSING_CURRENCY', 'warning', 'currency is blank', `default to base ${base} (confirm)`, true); currency = base; }
    else if (currency !== base) add('FOREIGN_CURRENCY', 'info', `amount is in ${currency}`, `convert to ${base} via exchange_rates`);

    // --- date ---
    const d = parseDate(rec.date);
    if (d.format === 'month-name') add('DATE_FORMAT', 'info', `non-standard date "${rec.date}"`, `normalized to ${d.iso}`);
    if (d.format === 'invalid') add('DATE_INVALID', 'blocker', `unparseable date "${rec.date}"`, 'fix or reject', true);
    const date = d.iso;

    // --- payer ---
    const payer = resolveName(rec.paid_by, members);
    if (payer.matchType === 'empty') add('MISSING_PAYER', 'blocker', 'paid_by is blank', 'assign a payer or reject', true);
    else if (payer.matchType === 'alias') add('UNKNOWN_OR_ALIAS_NAME', 'info', `payer "${rec.paid_by}" matched to ${payer.member.display_name}`, 'mapped via alias');
    else if (payer.matchType === 'none') add('UNKNOWN_OR_ALIAS_NAME', 'warning', `payer "${rec.paid_by}" is not a known member`, 'map to a member or reject', true);

    // --- split type & participants ---
    const st = String(rec.split_type || '').trim().toLowerCase();
    const detailsRaw = String(rec.split_details || '').trim();
    const rawParticipants = String(rec.split_with || '').split(';').map((s) => s.trim()).filter(Boolean);
    const notes = String(rec.notes || '');
    const depositKw = /deposit/i.test(notes);
    const settleKw = /paid .* back|settle|repay/i.test(notes);

    // Settlement / transfer shape: 0-1 counterparties and a transfer signal.
    const settlementShape = rawParticipants.length <= 1 && (st === '' || depositKw || settleKw);
    if (settlementShape && targetKind !== 'dropped') {
      targetKind = 'settlement';
      if (depositKw) add('NON_SHARED_TRANSFER', 'warning', 'looks like a deposit/transfer, not a shared expense', 'record as a settlement (confirm)', true);
      else add('SETTLEMENT_AS_EXPENSE', 'warning', 'logged as an expense but looks like a settlement', 'reclassify as a settlement (confirm)', true);
    } else if (st && !['equal', 'unequal', 'percentage', 'share'].includes(st)) {
      add('UNKNOWN_SPLIT_TYPE', 'warning', `unrecognized split_type "${st}"`, 'pick a valid split type', true);
    }

    // split_type says equal but per-member shares were supplied.
    if (st === 'equal' && detailsRaw) add('SPLIT_TYPE_MISMATCH', 'info', 'split_type=equal but split_details has shares', 'honor "equal", ignore the shares (confirm)', true);

    // percentage details must sum to 100.
    const parsedDetails = parseSplitDetails(detailsRaw);
    if (st === 'percentage' && parsedDetails.length) {
      const sum = parsedDetails.reduce((s, x) => s + x.value, 0);
      if (Math.abs(sum - 100) > 0.01) add('PERCENT_SUM_INVALID', 'warning', `percentages sum to ${sum}, not 100`, 'normalize to 100 or reject', true);
    }

    // Resolve participants for an expense.
    const participants = [];
    if (targetKind === 'expense') {
      for (const p of rawParticipants) {
        const r = resolveName(p, members);
        if (r.matchType === 'none') {
          add('NON_MEMBER_PARTICIPANT', 'warning', `participant "${p}" is not a group member`, 'add as a one-time guest, or exclude (confirm)', true);
        } else if (r.matchType === 'alias') {
          add('UNKNOWN_OR_ALIAS_NAME', 'info', `participant "${p}" matched to ${r.member.display_name}`, 'mapped via alias');
        }
        let active = true;
        if (r.member && date && !isActiveOn(r.member, date)) {
          active = false;
          add('MEMBER_OUTSIDE_WINDOW', 'warning', `${r.member.display_name} was not a member on ${date}`, 'exclude from this split (confirm)', true);
        }
        participants.push({ raw: p, memberId: r.memberId, matchType: r.matchType, active });
      }
    }

    const status = anomalies.some((x) => x.requiresReview) ? 'needs_review'
      : anomalies.length ? 'auto_resolved' : 'clean';

    return {
      rowNumber: rec.__rowNumber,
      raw: rec,
      normalized: {
        date, description: rec.description, payer: { raw: rec.paid_by, memberId: payer.memberId },
        amount, currency, isRefund, splitType: st, participants,
        details: parsedDetails, notes,
      },
      anomalies,
      status,
      targetKind,
      _descTokens: descTokens(rec.description),
    };
  });

  detectAmbiguousDates(rows);
  detectDuplicates(rows);

  // Recompute status (duplicate/date passes may have added review anomalies).
  for (const r of rows) {
    r.status = r.anomalies.some((x) => x.requiresReview) ? 'needs_review'
      : r.anomalies.length ? 'auto_resolved' : 'clean';
    delete r._descTokens;
  }

  return { rows, report: buildReport(rows) };
}

// A standard-format date is ambiguous when its neighbours are consistent with
// each other (prev <= next) but THIS row falls outside [prev, next], AND its day
// <= 12 so a DD/MM vs MM/DD swap is plausible. Checking that the neighbours
// agree isolates the single offending row (04-05-2026) instead of also blaming
// the correct row that happens to sit next to it.
function detectAmbiguousDates(rows) {
  const dated = rows.filter((r) => r.normalized.date && parseDate(r.raw.date).format === 'standard');
  for (let i = 1; i < dated.length - 1; i++) {
    const cur = dated[i].normalized.date;
    const prev = dated[i - 1].normalized.date;
    const next = dated[i + 1].normalized.date;
    const neighboursAgree = prev <= next;
    const curIsOutlier = cur < prev || cur > next;
    const day = parseDate(dated[i].raw.date).day;
    if (neighboursAgree && curIsOutlier && day <= 12) {
      dated[i].anomalies.push({
        type: 'AMBIGUOUS_DATE', severity: 'warning',
        description: `date "${dated[i].raw.date}" is out of order — DD-MM vs MM-DD is ambiguous`,
        suggestedAction: 'confirm the intended date', requiresReview: true,
      });
    }
  }
}

// Same date + similar description => duplicate. Same amount & payer => exact
// (auto-drop the later one). Different amount/payer => conflicting (review both).
function detectDuplicates(rows) {
  const exp = rows.filter((r) => r.targetKind !== 'dropped');
  for (let i = 0; i < exp.length; i++) {
    for (let j = i + 1; j < exp.length; j++) {
      const A = exp[i];
      const B = exp[j];
      if (A.normalized.date !== B.normalized.date) continue;
      if (jaccard(A._descTokens, B._descTokens) < 0.6) continue;

      const sameAmount = A.normalized.amount === B.normalized.amount;
      const samePayer = A.normalized.payer.memberId === B.normalized.payer.memberId;
      if (sameAmount && samePayer) {
        B.targetKind = 'dropped';
        B.anomalies.push({ type: 'EXACT_DUPLICATE', severity: 'info',
          description: `exact duplicate of row ${A.rowNumber} ("${A.raw.description}")`,
          suggestedAction: 'drop this duplicate (auto)', requiresReview: false });
      } else {
        const note = { type: 'CONFLICTING_DUPLICATE', severity: 'warning',
          description: `possible duplicate of row ${A.rowNumber} but amount/payer differ (₹${A.normalized.amount} vs ₹${B.normalized.amount})`,
          suggestedAction: 'pick which row is correct', requiresReview: true };
        A.anomalies.push({ ...note, description: `possible duplicate of row ${B.rowNumber} but amount/payer differ` });
        B.anomalies.push(note);
      }
    }
  }
}

function buildReport(rows) {
  const totals = { rows: rows.length, clean: 0, autoResolved: 0, needsReview: 0,
    expenses: 0, settlements: 0, dropped: 0, anomalies: 0 };
  const byType = {};

  for (const r of rows) {
    if (r.status === 'clean') totals.clean++;
    if (r.status === 'auto_resolved') totals.autoResolved++;
    if (r.status === 'needs_review') totals.needsReview++;
    if (r.targetKind === 'expense') totals.expenses++;
    if (r.targetKind === 'settlement') totals.settlements++;
    if (r.targetKind === 'dropped') totals.dropped++;
    for (const an of r.anomalies) { totals.anomalies++; byType[an.type] = (byType[an.type] || 0) + 1; }
  }

  return {
    totals,
    anomaliesByType: byType,
    rows: rows.map((r) => ({
      rowNumber: r.rowNumber,
      description: r.raw.description,
      status: r.status,
      targetKind: r.targetKind,
      anomalies: r.anomalies.map((a) => ({ type: a.type, severity: a.severity, description: a.description, action: a.suggestedAction })),
    })),
  };
}
