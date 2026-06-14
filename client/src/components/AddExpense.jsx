import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { CURRENCIES } from '../currencies.js';

const today = () => new Date().toISOString().slice(0, 10);

const DETAIL_HINT = {
  unequal: 'exact amount each owes',
  percentage: 'percent each owes (must total 100)',
  share: 'relative share weight (e.g. 1, 2)',
};

// `editing` (an expense with .splits) puts the form into edit mode.
export default function AddExpense({ groupId, group, members, onCreated, editing, onDone }) {
  const isEdit = !!editing;
  const blank = {
    description: '', paidBy: '', amount: '', currency: group.base_currency,
    splitType: 'equal', expenseDate: today(), isRefund: false,
  };
  const [form, setForm] = useState(blank);
  const [participants, setParticipants] = useState([]);
  const [details, setDetails] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Load the expense being edited into the form.
  useEffect(() => {
    if (!editing) return;
    setForm({
      description: editing.description,
      paidBy: editing.paid_by,
      amount: String(editing.original_amount_minor / 100),
      currency: editing.original_currency,
      splitType: editing.split_type,
      expenseDate: editing.expense_date,
      isRefund: !!editing.is_refund,
    });
    setParticipants(editing.splits.map((s) => s.member_id));
    const d = {};
    editing.splits.forEach((s) => { if (s.raw_value != null) d[s.member_id] = s.raw_value; });
    setDetails(d);
    setError('');
  }, [editing]);

  const reset = () => { setForm(blank); setParticipants([]); setDetails({}); };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toggle = (mid) => setParticipants((p) => p.includes(mid) ? p.filter((x) => x !== mid) : [...p, mid]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (participants.length === 0) { setError('Pick at least one participant.'); return; }
    setBusy(true);
    try {
      const body = {
        description: form.description,
        paidBy: form.paidBy,
        amount: Number(form.amount),
        currency: form.currency,
        splitType: form.splitType,
        expenseDate: form.expenseDate,
        splitWith: participants,
        isRefund: form.isRefund,
      };
      if (form.splitType !== 'equal') {
        body.details = Object.fromEntries(participants.map((id) => [id, Number(details[id] ?? 0)]));
      }
      if (isEdit) {
        await api.updateExpense(editing.id, body);
        onDone?.();
      } else {
        await api.createExpense(groupId, body);
        reset();
        await onCreated();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelEdit = () => { reset(); onDone?.(); };

  return (
    <div className="card" id="expense-form">
      <h2 style={{ marginTop: 0 }}>{isEdit ? 'Edit expense' : 'Add expense'}</h2>
      <form onSubmit={submit}>
        <div className="row">
          <div style={{ flex: 2 }}>
            <label>Description</label>
            <input value={form.description} onChange={set('description')} required />
          </div>
          <div>
            <label>Amount</label>
            <input type="number" step="0.01" min="0" value={form.amount} onChange={set('amount')} required />
          </div>
          <div style={{ flex: 'none', width: 130 }}>
            <label>Currency</label>
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </div>
        </div>

        <div className="row">
          <div>
            <label>Paid by</label>
            <select value={form.paidBy} onChange={set('paidBy')} required>
              <option value="">Select…</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
            </select>
          </div>
          <div>
            <label>Date</label>
            <input type="date" value={form.expenseDate} onChange={set('expenseDate')} />
          </div>
          <div>
            <label>Split type</label>
            <select value={form.splitType} onChange={set('splitType')}>
              <option value="equal">equal</option>
              <option value="unequal">unequal</option>
              <option value="percentage">percentage</option>
              <option value="share">share</option>
            </select>
          </div>
        </div>

        <label>Split between</label>
        <div className="checks">
          {members.map((m) => (
            <label key={m.id}>
              <input type="checkbox" checked={participants.includes(m.id)} onChange={() => toggle(m.id)} />
              {m.displayName}
            </label>
          ))}
        </div>

        {form.splitType !== 'equal' && participants.length > 0 && (
          <div className="card tight" style={{ marginTop: 12 }}>
            <div className="muted" style={{ marginBottom: 6 }}>{DETAIL_HINT[form.splitType]}</div>
            {participants.map((id) => {
              const m = members.find((x) => x.id === id);
              return (
                <div className="spread" key={id} style={{ marginBottom: 6 }}>
                  <span>{m?.displayName}</span>
                  <input style={{ width: 140 }} type="number" step="0.01"
                    value={details[id] ?? ''} onChange={(e) => setDetails({ ...details, [id]: e.target.value })} />
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <label className={`chip ${form.isRefund ? 'on' : ''}`}>
            <input type="checkbox" checked={form.isRefund} onChange={(e) => setForm({ ...form, isRefund: e.target.checked })} />
            <span className="box" /> This is a refund
          </label>
        </div>

        {error && <div className="error">{error}</div>}
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <div style={{ flex: 'none' }}><button disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add expense'}</button></div>
          {isEdit && <div style={{ flex: 'none' }}><button type="button" className="ghost" onClick={cancelEdit}>Cancel</button></div>}
        </div>
      </form>
    </div>
  );
}
