// Split engine — turns an expense + split spec into per-member owed amounts.
// Pure and framework-agnostic (no req/res, no DB) so it is easy to unit-test
// and to reason about in the live session. Supports the four split types that
// appear in the CSV: equal, unequal, percentage, share.
import { toMinor, allocateByWeights } from './money.js';
import { ApiError } from './helpers.js';

const PERCENT_TOLERANCE = 0.01;

// participants: array of member ids (the people sharing this expense).
// details: object keyed by member id -> value, meaning depends on splitType:
//   - unequal:    exact amount (major units) each person owes
//   - percentage: percent of the total each person owes (must sum to 100)
//   - share:      relative weight (e.g. 1, 2) — proportional split
//   - equal:      details ignored
// Returns [{ memberId, rawValue, owedMinor }] summing exactly to amountMinor.
export function computeSplits({ splitType, amountMinor, participants, details = {} }) {
  if (!participants || participants.length === 0) {
    throw new ApiError(400, 'split needs at least one participant');
  }

  switch (splitType) {
    case 'equal': {
      const owed = allocateByWeights(amountMinor, participants.map(() => 1));
      return participants.map((id, i) => ({ memberId: id, rawValue: null, owedMinor: owed[i] }));
    }

    case 'share': {
      const weights = participants.map((id) => num(details[id], `share for ${id}`));
      if (weights.some((w) => w <= 0)) throw new ApiError(400, 'share weights must be positive');
      const owed = allocateByWeights(amountMinor, weights);
      return participants.map((id, i) => ({ memberId: id, rawValue: weights[i], owedMinor: owed[i] }));
    }

    case 'percentage': {
      const pct = participants.map((id) => num(details[id], `percentage for ${id}`));
      const sum = pct.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 100) > PERCENT_TOLERANCE) {
        throw new ApiError(400, `percentages must sum to 100 (got ${sum})`);
      }
      const owed = allocateByWeights(amountMinor, pct);
      return participants.map((id, i) => ({ memberId: id, rawValue: pct[i], owedMinor: owed[i] }));
    }

    case 'unequal': {
      const owed = participants.map((id) => toMinor(num(details[id], `amount for ${id}`)));
      const sum = owed.reduce((a, b) => a + b, 0);
      if (sum !== amountMinor) {
        throw new ApiError(400, `unequal amounts sum to ${sum} but expense total is ${amountMinor} (minor units)`);
      }
      return participants.map((id, i) => ({ memberId: id, rawValue: owed[i] / 100, owedMinor: owed[i] }));
    }

    default:
      throw new ApiError(400, `unknown split type: ${splitType}`);
  }
}

function num(v, label) {
  const n = Number(v);
  if (v === undefined || v === null || Number.isNaN(n)) {
    throw new ApiError(400, `missing or invalid ${label}`);
  }
  return n;
}
