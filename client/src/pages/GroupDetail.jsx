import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import TopBar from '../components/TopBar.jsx';
import AddExpense from '../components/AddExpense.jsx';
import ImportPanel from '../components/ImportPanel.jsx';

const today = () => new Date().toISOString().slice(0, 10);

export default function GroupDetail() {
  const { id } = useParams();
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [tab, setTab] = useState('expenses');
  const [error, setError] = useState('');

  const loadGroup = useCallback(async () => {
    try {
      const r = await api.getGroup(id);
      setGroup(r.group);
      setMembers(r.members);
    } catch (e) { setError(e.message); }
  }, [id]);

  useEffect(() => { loadGroup(); }, [loadGroup]);

  const nameById = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m.displayName])), [members]);

  if (!group) return (<><TopBar /><div className="container">{error ? <div className="error">{error}</div> : 'Loading…'}</div></>);

  return (
    <>
      <TopBar />
      <div className="container">
        <div className="hero">
          <div className="spread">
            <span className="eyebrow">GROUP</span>
            <span className="pill">{group.base_currency}</span>
          </div>
          <h1>{group.name}</h1>
          <div className="hero-sub">{members.length} member{members.length === 1 ? '' : 's'}</div>
        </div>

        <div className="tabs">
          {['expenses', 'members', 'balances', 'import'].map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {error && <div className="error">{error}</div>}

        {/* Kept mounted (just hidden) so an in-progress expense form isn't lost on tab switch */}
        <div style={{ display: tab === 'expenses' ? 'block' : 'none' }}>
          <Expenses groupId={id} group={group} members={members} nameById={nameById} />
        </div>
        {tab === 'members' && <Members groupId={id} members={members} reload={loadGroup} />}
        {tab === 'balances' && <Balances groupId={id} members={members} base={group.base_currency} />}
        {tab === 'import' && <ImportPanel groupId={id} onCommitted={loadGroup} />}
      </div>
    </>
  );
}

const money = (minor, cur) => `${cur} ${(minor / 100).toFixed(2)}`;

function Members({ groupId, members, reload }) {
  const [form, setForm] = useState({ displayName: '', joinedAt: today(), isGuest: false });
  const [error, setError] = useState('');
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState({ displayName: '', joinedAt: '', leftAt: '' });
  const [confirmDel, setConfirmDel] = useState(null);

  const add = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.addMember(groupId, form);
      setForm({ displayName: '', joinedAt: today(), isGuest: false });
      await reload();
    } catch (err) { setError(err.message); }
  };

  const startEdit = (m) => {
    setError(''); setConfirmDel(null); setEditId(m.id);
    setEdit({ displayName: m.displayName, joinedAt: m.joinedAt, leftAt: m.leftAt || '' });
  };
  const saveEdit = async (m) => {
    try {
      await api.updateMember(groupId, m.id, { displayName: edit.displayName, joinedAt: edit.joinedAt, leftAt: edit.leftAt || null });
      setEditId(null);
      await reload();
    } catch (err) { setError(err.message); }
  };
  const remove = async (m) => {
    setError('');
    try { await api.deleteMember(groupId, m.id); setConfirmDel(null); await reload(); }
    catch (err) { setError(err.message); setConfirmDel(null); }
  };

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Add member</h2>
        <form className="row" onSubmit={add}>
          <div style={{ flex: 2 }}>
            <label>Name</label>
            <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
          </div>
          <div>
            <label>Joined on</label>
            <input type="date" value={form.joinedAt} onChange={(e) => setForm({ ...form, joinedAt: e.target.value })} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', flex: 'none' }}>
            <label className={`chip ${form.isGuest ? 'on' : ''}`}>
              <input type="checkbox" checked={form.isGuest} onChange={(e) => setForm({ ...form, isGuest: e.target.checked })} />
              <span className="box" /> Guest
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', flex: 'none' }}><button>Add</button></div>
        </form>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Joined</th><th>Left</th><th></th></tr></thead>
          <tbody>
            {members.map((m) => editId === m.id ? (
              <tr key={m.id}>
                <td><input value={edit.displayName} onChange={(e) => setEdit({ ...edit, displayName: e.target.value })} style={{ maxWidth: 160 }} /></td>
                <td><input type="date" value={edit.joinedAt} onChange={(e) => setEdit({ ...edit, joinedAt: e.target.value })} style={{ maxWidth: 160 }} /></td>
                <td><input type="date" value={edit.leftAt} onChange={(e) => setEdit({ ...edit, leftAt: e.target.value })} style={{ maxWidth: 160 }} /></td>
                <td style={{ textAlign: 'right' }}>
                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <button className="small" onClick={() => saveEdit(m)}>Save</button>
                    <button className="small ghost" onClick={() => setEdit({ ...edit, leftAt: '' })}>Clear left</button>
                    <button className="small ghost" onClick={() => setEditId(null)}>Cancel</button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={m.id}>
                <td>{m.displayName} {m.isGuest && <span className="pill">guest</span>}</td>
                <td>{m.joinedAt}</td>
                <td>{m.leftAt || '—'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {confirmDel === m.id ? (
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button className="small danger" onClick={() => remove(m)}>Confirm delete</button>
                      <button className="small ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button className="small ghost" onClick={() => startEdit(m)}>Edit</button>
                      <button className="small danger" onClick={() => { setError(''); setConfirmDel(m.id); }}>Delete</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      </div>
    </>
  );
}

function Expenses({ groupId, group, members, nameById }) {
  const [expenses, setExpenses] = useState([]);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const load = useCallback(() => api.listExpenses(groupId).then((r) => setExpenses(r.expenses)).catch(() => {}), [groupId]);
  useEffect(() => { load(); }, [load]);

  const startEdit = async (id) => {
    try {
      const { expense } = await api.getExpense(id);
      setEditing(expense);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch { /* ignore */ }
  };
  const remove = async (id) => {
    try {
      await api.deleteExpense(id);
      setConfirmDel(null);
      if (editing?.id === id) setEditing(null);
      await load();
    } catch { /* ignore */ }
  };

  return (
    <>
      <AddExpense
        groupId={groupId} group={group} members={members}
        onCreated={load} editing={editing} onDone={() => { setEditing(null); load(); }}
      />
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Expenses</h2>
        <table>
          <thead><tr><th>Date</th><th>Description</th><th>Paid by</th><th>Split</th><th style={{ textAlign: 'right' }}>Amount</th><th></th></tr></thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id}>
                <td>{e.expense_date}</td>
                <td>{e.description} {e.is_refund ? <span className="pill warning">refund</span> : null}</td>
                <td>{nameById[e.paid_by] || '—'}</td>
                <td><span className="pill">{e.split_type}</span></td>
                <td style={{ textAlign: 'right' }}>
                  {money(e.amount_minor, group.base_currency)}
                  {e.original_currency !== group.base_currency && (
                    <div className="muted" style={{ fontSize: 12 }}>{money(e.original_amount_minor, e.original_currency)}</div>
                  )}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {confirmDel === e.id ? (
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button className="small danger" onClick={() => remove(e.id)}>Confirm</button>
                      <button className="small ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button className="small ghost" onClick={() => startEdit(e.id)}>Edit</button>
                      <button className="small danger" onClick={() => setConfirmDel(e.id)}>Delete</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {expenses.length === 0 && <tr><td colSpan={6} className="muted">No expenses yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Balances({ groupId, members, base }) {
  const [net, setNet] = useState([]);
  const [simple, setSimple] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.balances(groupId).then((r) => setNet(r.balances)).catch((e) => setError(e.message));
    api.simplified(groupId).then((r) => setSimple(r.transactions)).catch(() => {});
  }, [groupId]);

  return (
    <>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Net balances</h2>
        <table>
          <thead><tr><th>Member</th><th style={{ textAlign: 'right' }}>Net ({base})</th></tr></thead>
          <tbody>
            {net.map((b) => (
              <tr key={b.memberId}>
                <td>{b.displayName}</td>
                <td style={{ textAlign: 'right' }} className={b.net > 0 ? 'pos' : b.net < 0 ? 'neg' : ''}>
                  {b.net > 0 ? '+' : ''}{b.net.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 13 }}>Positive = the group owes them. Negative = they owe the group.</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Who pays whom (simplified)</h2>
        {simple.length === 0 ? <p className="muted">Everyone is settled up.</p> : (
          <table>
            <thead><tr><th>From</th><th>To</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>
              {simple.map((t, i) => (
                <tr key={i}><td>{t.from}</td><td>{t.to}</td><td style={{ textAlign: 'right' }}>{base} {t.amount.toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
