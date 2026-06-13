// End-to-end smoke test for the backend. Requires the API running on :4000.
// Run: node scripts/smoke.mjs
const BASE = 'http://localhost:4000/api';
let token = '';
let pass = 0;
let fail = 0;

function ok(cond, label) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

async function call(method, path, body, expect) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (expect !== undefined) ok(res.status === expect, `${method} ${path} -> ${res.status} (want ${expect})`);
  return { status: res.status, json };
}

console.log('\n# Auth + group setup');
const email = `aisha+${Date.now()}@flat.com`;
let r = await call('POST', '/auth/register', { name: 'Aisha', email, password: 'password123' }, 201);
token = r.json.token;

r = await call('POST', '/groups', { name: 'Flat 4B', baseCurrency: 'INR' }, 201);
const groupId = r.json.group.id;
const aisha = r.json.members[0].id; // creator, joined today

// Add members who joined back in February.
const addMember = async (displayName, isGuest = false) =>
  (await call('POST', `/groups/${groupId}/members`, { displayName, isGuest, joinedAt: '2026-02-01' }, 201)).json.member.id;
const rohan = await addMember('Rohan');
const priya = await addMember('Priya');
const meera = await addMember('Meera');
const dev = await addMember('Dev', true);

console.log('\n# Split types');
// equal
await call('POST', `/groups/${groupId}/expenses`, {
  description: 'Wifi Feb', paidBy: rohan, amount: 1199, splitType: 'equal',
  expenseDate: '2026-02-05', splitWith: [rohan, priya, meera],
}, 201);

// unequal (must sum to total)
await call('POST', `/groups/${groupId}/expenses`, {
  description: 'Cake', paidBy: rohan, amount: 1500, splitType: 'unequal',
  expenseDate: '2026-02-20', splitWith: [rohan, priya, meera],
  details: { [rohan]: 700, [priya]: 400, [meera]: 400 },
}, 201);

// percentage (must sum to 100)
await call('POST', `/groups/${groupId}/expenses`, {
  description: 'Brunch', paidBy: priya, amount: 2200, splitType: 'percentage',
  expenseDate: '2026-02-25', splitWith: [rohan, priya, meera],
  details: { [rohan]: 30, [priya]: 30, [meera]: 40 },
}, 201);

// share (weights)
const shareRes = await call('POST', `/groups/${groupId}/expenses`, {
  description: 'Scooters', paidBy: priya, amount: 3600, splitType: 'share',
  expenseDate: '2026-03-10', splitWith: [rohan, priya, dev],
  details: { [rohan]: 2, [priya]: 1, [dev]: 2 },
}, 201);
const sSum = shareRes.json.expense.splits.reduce((a, s) => a + s.owed_minor, 0);
ok(sSum === 360000, `share splits sum exactly to total (got ${sSum})`);

console.log('\n# Multi-currency + refund');
// USD -> INR at fixed 83
const usd = await call('POST', `/groups/${groupId}/expenses`, {
  description: 'Goa villa', paidBy: dev, amount: 540, currency: 'USD', splitType: 'equal',
  expenseDate: '2026-03-09', splitWith: [rohan, priya, dev],
}, 201);
ok(usd.json.expense.amount_minor === 540 * 83 * 100, `USD 540 -> INR ${usd.json.expense.amount_minor} minor`);

// refund (negative effect on balances)
await call('POST', `/groups/${groupId}/expenses`, {
  description: 'Parasailing refund', paidBy: dev, amount: 30, currency: 'USD', splitType: 'equal',
  expenseDate: '2026-03-12', splitWith: [rohan, priya, dev], isRefund: true,
}, 201);

console.log('\n# Settlement');
await call('POST', `/groups/${groupId}/settlements`, {
  fromMember: rohan, toMember: priya, amount: 500, settledOn: '2026-03-01',
}, 201);

console.log('\n# Validation rejections (should be 400)');
await call('POST', `/groups/${groupId}/expenses`, {
  description: 'Bad %', paidBy: rohan, amount: 100, splitType: 'percentage',
  expenseDate: '2026-02-05', splitWith: [rohan, priya], details: { [rohan]: 30, [priya]: 30 },
}, 400); // sums to 60, not 100
await call('POST', `/groups/${groupId}/expenses`, {
  description: 'Bad unequal', paidBy: rohan, amount: 100, splitType: 'unequal',
  expenseDate: '2026-02-05', splitWith: [rohan, priya], details: { [rohan]: 30, [priya]: 30 },
}, 400); // sums to 60, not 100
// Aisha joined today -> a Feb expense for her must be rejected (time-bounded).
await call('POST', `/groups/${groupId}/expenses`, {
  description: 'Aisha too early', paidBy: aisha, amount: 100, splitType: 'equal',
  expenseDate: '2026-02-05', splitWith: [aisha],
}, 400);

console.log('\n# Meera leaves end of March; April expense including her -> 400');
await call('PATCH', `/groups/${groupId}/members/${meera}`, { leftAt: '2026-03-31' }, 200);
await call('POST', `/groups/${groupId}/expenses`, {
  description: 'April groceries', paidBy: rohan, amount: 2640, splitType: 'equal',
  expenseDate: '2026-04-02', splitWith: [rohan, priya, meera],
}, 400);

console.log('\n# Balances');
const bal = await call('GET', `/groups/${groupId}/balances`, null, 200);
const sum = bal.json.balances.reduce((a, b) => a + b.netMinor, 0);
ok(sum === 0, `net balances sum to zero (got ${sum})`);
const simp = await call('GET', `/groups/${groupId}/balances/simplified`, null, 200);
ok(Array.isArray(simp.json.transactions), 'simplified returns transactions array');
const item = await call('GET', `/groups/${groupId}/members/${rohan}/balance`, null, 200);
ok(Array.isArray(item.json.lines) && item.json.lines.length > 0, 'itemized balance has line items');

console.log('\n# Net balances:');
for (const b of bal.json.balances) console.log(`  ${b.displayName.padEnd(8)} ${b.net}`);
console.log('\n# Simplified (who pays whom):');
for (const t of simp.json.transactions) console.log(`  ${t.from} -> ${t.to}: ${t.amount}`);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
