// Import test — runs the pipeline against the real expenses_export.csv.
// Sets up the flat's membership timeline, uploads the CSV, prints the Import
// Report, then commits. Requires the API running on :4000.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = 'http://localhost:4000/api';
const here = dirname(fileURLToPath(import.meta.url));
const csvPath = join(here, '..', '..', 'expenses_export.csv');
let token = '';

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await res.json().catch(() => ({})));
}

// 1. user + group
token = (await call('POST', '/auth/register', { name: 'Admin', email: `admin+${Date.now()}@flat.com`, password: 'password123' })).token;
const group = (await call('POST', '/groups', { name: 'Flat 4B', baseCurrency: 'INR' })).group;
const G = group.id;

// 2. membership timeline (the spine of the whole problem)
const add = async (displayName, joinedAt, isGuest = false) =>
  (await call('POST', `/groups/${G}/members`, { displayName, joinedAt, isGuest })).member;
const aisha = await add('Aisha', '2026-02-01');
const rohan = await add('Rohan', '2026-02-01');
const priya = await add('Priya', '2026-02-01');
const meera = await add('Meera', '2026-02-01');
const dev = await add('Dev', '2026-02-01', true);
const sam = await add('Sam', '2026-04-08');
await call('PATCH', `/groups/${G}/members/${meera.id}`, { leftAt: '2026-03-31' }); // Meera moves out

// 3. upload the CSV
const buf = readFileSync(csvPath);
const fd = new FormData();
fd.append('file', new Blob([buf], { type: 'text/csv' }), 'expenses_export.csv');
const up = await fetch(`${BASE}/groups/${G}/import`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
const { importId, report } = await up.json();

// 4. print the Import Report
console.log('\n================  IMPORT REPORT  ================');
console.log('Totals:', report.totals);
console.log('\nAnomalies detected by type:');
for (const [t, c] of Object.entries(report.anomaliesByType).sort()) console.log(`  ${String(c).padStart(2)}  ${t}`);
console.log('\nPer-row (only rows with anomalies):');
for (const r of report.rows) {
  if (!r.anomalies.length) continue;
  console.log(`\n  row ${r.rowNumber}  [${r.status}/${r.targetKind}]  "${r.description}"`);
  for (const a of r.anomalies) console.log(`     - ${a.type}: ${a.description}  -> ${a.action}`);
}

// 5. commit (only clean/auto rows commit; needs_review rows are held back)
const commit = await call('POST', `/imports/${importId}/commit`);
console.log('\n================  COMMIT SUMMARY  ================');
console.log('Inserted:', { expenses: commit.summary.expenses, settlements: commit.summary.settlements, dropped: commit.summary.dropped });
console.log('Skipped (held for review or unresolved):');
for (const s of commit.summary.skipped) console.log(`  row ${s.rowNumber}: ${s.reason}`);

console.log(`\nImport id: ${importId}`);
