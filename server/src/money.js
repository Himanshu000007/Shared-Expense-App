// Money utilities. All amounts are integer minor units (paise/cents) internally.
// Never store or compare money as floating point.

// Major units (e.g. 48000.50 rupees) -> integer minor units (paise).
export const toMinor = (major) => Math.round(Number(major) * 100);

// Minor units -> major number (for display only).
export const fromMinor = (minor) => minor / 100;

// Distribute `totalMinor` across `weights` using the largest-remainder method,
// so the parts always sum EXACTLY to totalMinor (no lost/extra paise).
// Ties broken by index, so the allocation is deterministic and reproducible.
export function allocateByWeights(totalMinor, weights) {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) throw new Error('split weights must sum to more than 0');

  const exact = weights.map((w) => (totalMinor * w) / totalWeight);
  const floors = exact.map((x) => Math.floor(x));
  const allocated = floors.reduce((a, b) => a + b, 0);
  let leftover = totalMinor - allocated; // number of 1-paise units still to give

  // Hand the leftover paise to the largest fractional remainders first.
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = floors.slice();
  for (let k = 0; k < leftover; k++) result[order[k].i] += 1;
  return result;
}
