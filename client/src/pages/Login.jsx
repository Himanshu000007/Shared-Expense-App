import { useState } from 'react';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login({ email: form.email, password: form.password });
      else await register(form);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="logo"><span className="dot" /> Splitr</div>
        <div>
          <h2 className="auth-tagline">Shared costs,<br /><span className="grad">settled clean.</span></h2>
          <p>Track group spending across currencies, see exactly who owes whom, and turn a messy spreadsheet into a clean ledger.</p>
          <ul className="auth-points">
            <li>Multi-currency expenses &amp; refunds</li>
            <li>One number per person — who pays whom</li>
            <li>CSV import with anomaly review</li>
          </ul>
        </div>
        <div className="faint" style={{ fontSize: 13 }}>Built for flatmates who hate awkward money talks.</div>
      </aside>

      <div className="auth-form-wrap">
        <form className="card auth-card" onSubmit={submit}>
          <h1>{mode === 'login' ? 'Welcome back' : 'Create account'}</h1>
          <p className="muted" style={{ marginTop: -6 }}>
            {mode === 'login' ? 'Sign in to your account' : 'Start splitting in seconds'}
          </p>

          {mode === 'register' && (
            <>
              <label>Name</label>
              <input value={form.name} onChange={set('name')} placeholder="Aisha" required />
            </>
          )}
          <label>Email</label>
          <input type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" required />
          <label>Password</label>
          <input type="password" value={form.password} onChange={set('password')} placeholder="••••••••" required />

          {error && <div className="error">{error}</div>}

          <div style={{ marginTop: 18 }}>
            <button disabled={busy} type="submit" style={{ width: '100%' }}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Sign up'}
            </button>
          </div>
          <p className="muted" style={{ marginTop: 16 }}>
            {mode === 'login' ? 'No account? ' : 'Have an account? '}
            <a href="#" onClick={(e) => { e.preventDefault(); setError(''); setMode(mode === 'login' ? 'register' : 'login'); }}>
              {mode === 'login' ? 'Sign up' : 'Sign in'}
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
