// Review-loop test — proves a needs_review row stays out of commit until a
// human approves it (Meera's requirement). Imports without committing, approves
// the "Rohan paid Aisha back" settlement row, then commits and checks it lands.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = 'http://localhost:4000/api';
const here = dirname(fileURLToPath(import.meta.url));
const csvPath = join(here, '..', '..', 'expenses_export.csv');
let token = '';
const call = async (method, path, body) =>
  (await (await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })).json().catch(() => ({})));

token = (await call('POST', '/auth/register', { name: 'Admin', email: `rev+${Date.now()}@flat.com`, password: 'password123' })).token;
const G = (await call('POST', '/groups', { name: 'Flat 4B', baseCurrency: 'INR' })).group.id;
const add = (displayName, joinedAt, isGuest = false) => call('POST', `/groups/${G}/members`, { displayName, joinedAt, isGuest });
await add('Aisha', '2026-02-01'); await add('Rohan', '2026-02-01'); await add('Priya', '2026-02-01');
await add('Meera', '2026-02-01'); await add('Dev', '2026-02-01', true); await add('Sam', '2026-04-08');

// import (no commit yet)
const fd = new FormData();
fd.append('file', new Blob([readFileSync(csvPath)], { type: 'text/csv' }), 'expenses_export.csv');
const { importId } = await (await fetch(`${BASE}/groups/${G}/import`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })).json();

// find the settlement row that needs review
const { rows } = await call('GET', `/imports/${importId}`);
const settlementRow = rows.find((r) => JSON.parse(typeof r.raw === 'string' ? r.raw : JSON.stringify(r.raw)).description === 'Rohan paid Aisha back');
console.log(`Settlement row status before review: ${settlementRow.status} (target ${settlementRow.target_kind})`);

// commit WITHOUT approving -> settlement should NOT be created
let c = await call('POST', `/imports/${importId}/commit`);
console.log(`Commit #1 (no approval): settlements = ${c.summary.settlements}  [expect 0]`);

// now approve it and commit again is blocked (already committed); so test on a
// fresh import instead: re-import, approve, then commit.
const fd2 = new FormData();
fd2.append('file', new Blob([readFileSync(csvPath)], { type: 'text/csv' }), 'expenses_export.csv');
const imp2 = await (await fetch(`${BASE}/groups/${G}/import`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd2 })).json();
const rows2 = (await call('GET', `/imports/${imp2.importId}`)).rows;
const setRow2 = rows2.find((r) => JSON.parse(typeof r.raw === 'string' ? r.raw : JSON.stringify(r.raw)).description === 'Rohan paid Aisha back');
await call('PATCH', `/imports/${imp2.importId}/rows/${setRow2.id}`, { action: 'approve', resolution: { confirmedSettlement: true } });
c = await call('POST', `/imports/${imp2.importId}/commit`);
console.log(`Commit #2 (after approving the settlement): settlements = ${c.summary.settlements}  [expect 1]`);
