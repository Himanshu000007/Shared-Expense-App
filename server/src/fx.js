// Currency conversion. Looks up the rate to convert `from` -> `to` for a given
// date: the per-date historical rate first, then the fixed fallback row
// (rate_date IS NULL). Rates live in the exchange_rates table (DECISIONS D4).
import { query } from './db.js';
import { ApiError } from './helpers.js';

// Returns { rate, fxRateId }. rate is "1 `from` = rate `to`". For same-currency
// conversions, rate is 1 and there is no fx row.
export async function getRate(fromCurrency, toCurrency, date) {
  if (fromCurrency === toCurrency) return { rate: 1, fxRateId: null };

  // 1) Historical rate for the exact date.
  let { rows } = await query(
    `SELECT id, rate FROM exchange_rates
     WHERE base_currency = ? AND quote_currency = ? AND rate_date = ?
     LIMIT 1`,
    [fromCurrency, toCurrency, date]
  );
  if (rows[0]) return { rate: Number(rows[0].rate), fxRateId: rows[0].id };

  // 2) Fixed fallback (rate_date IS NULL).
  ({ rows } = await query(
    `SELECT id, rate FROM exchange_rates
     WHERE base_currency = ? AND quote_currency = ? AND rate_date IS NULL
     LIMIT 1`,
    [fromCurrency, toCurrency]
  ));
  if (rows[0]) return { rate: Number(rows[0].rate), fxRateId: rows[0].id };

  throw new ApiError(400, `no exchange rate available for ${fromCurrency}->${toCurrency}`);
}
