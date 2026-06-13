import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { CURRENCIES } from '../currencies.js';
import TopBar from '../components/TopBar.jsx';

export default function Groups() {
  const [groups, setGroups] = useState([]);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.listGroups().then((r) => setGroups(r.groups)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.createGroup({ name, baseCurrency: currency });
      setName('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar />
      <div className="container">
        <h1>Your groups</h1>

        <form className="card" onSubmit={create}>
          <div className="row">
            <div style={{ flex: 3 }}>
              <label>New group name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Flat 4B" required />
            </div>
            <div style={{ flex: 'none', width: 250 }}>
              <label>Base currency</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button disabled={busy} type="submit">Create</button>
            </div>
          </div>
          {error && <div className="error">{error}</div>}
        </form>

        {groups.length === 0 && <p className="muted">No groups yet — create one above.</p>}
        {groups.map((g) => (
          <div className="card tight spread" key={g.id}>
            <div>
              <Link to={`/groups/${g.id}`}><strong>{g.name}</strong></Link>
              <div className="muted">base currency {g.base_currency}</div>
            </div>
            <Link to={`/groups/${g.id}`}><button className="ghost small">Open →</button></Link>
          </div>
        ))}
      </div>
    </>
  );
}
