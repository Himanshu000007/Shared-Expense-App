// Balance engine — pure functions that turn the ledger (expenses, splits,
// settlements) into net balances and a minimal set of settling transactions.
// No DB, no req/res, so it's directly unit-testable and easy to walk through
// by hand in the live session.

// net balance for a member = (what they paid) - (what they owe) + (settlement effects)
//   positive  => the group owes them money
//   negative  => they owe the group money
//
// expenses:    [{ paidBy, amountMinor }]            (refunds passed pre-signed)
// splits:      [{ memberId, owedMinor }]            (refunds passed pre-signed)
// settlements: [{ fromMember, toMember, amountMinor }]
export function computeNet({ expenses, splits, settlements }) {
  const net = {};
  const add = (id, v) => { net[id] = (net[id] || 0) + v; };

  for (const e of expenses) add(e.paidBy, e.amountMinor);     // payer fronted the money
  for (const s of splits) add(s.memberId, -s.owedMinor);      // each owes their share

  // A settlement: from_member hands money to to_member, reducing from's debt.
  for (const st of settlements) {
    add(st.fromMember, st.amountMinor);
    add(st.toMember, -st.amountMinor);
  }
  return net;
}

// Greedy minimum-cash-flow: repeatedly settle the biggest debtor against the
// biggest creditor. Produces a small set of "who pays whom" transactions —
// Aisha's "one number per person" view.
export function simplify(net) {
  const debtors = [];
  const creditors = [];
  for (const [id, v] of Object.entries(net)) {
    if (v < 0) debtors.push({ id, amt: -v });
    else if (v > 0) creditors.push({ id, amt: v });
  }
  debtors.sort((a, b) => b.amt - a.amt);
  creditors.sort((a, b) => b.amt - a.amt);

  const transactions = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    transactions.push({ from: debtors[i].id, to: creditors[j].id, amountMinor: pay });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }
  return transactions;
}
