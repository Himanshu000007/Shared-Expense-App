import { useState } from 'react';
import { api } from '../api.js';

const parseRaw = (raw) => (typeof raw === 'string' ? JSON.parse(raw) : raw || {});

export default function ImportPanel({ groupId, onCommitted }) {
  const [file, setFile] = useState(null);
  const [importId, setImportId] = useState(null);
  const [rows, setRows] = useState([]);
  const [report, setReport] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshRows = async (impId) => {
    const r = await api.importRows(impId);
    setRows(r.rows);
  };

  const upload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setError(''); setBusy(true); setSummary(null);
    try {
      const { importId, report } = await api.importCsv(groupId, file);
      setImportId(importId);
      setReport(report);
      await refreshRows(importId);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const review = async (rowId, action) => {
    try {
      await api.reviewRow(importId, rowId, { action });
      setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, status: action === 'approve' ? 'approved' : 'rejected' } : r)));
    } catch (err) { setError(err.message); }
  };

  const commit = async () => {
    setError(''); setBusy(true);
    try {
      const r = await api.commitImport(importId);
      setSummary(r.summary);
      await onCommitted?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Import expenses CSV</h2>
        <p className="muted">Upload the spreadsheet export. The app detects every data problem, holds the ones that need a decision, and only commits what you approve.</p>
        <form className="row" onSubmit={upload}>
          <div style={{ flex: 3 }}>
            <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files[0])} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flex: 'none' }}>
            <button disabled={busy || !file}>{busy ? 'Analyzing…' : 'Upload & analyze'}</button>
          </div>
        </form>
        {error && <div className="error">{error}</div>}
      </div>

      {report && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Import report</h2>
          <div className="row">
            <Stat label="Rows" value={report.totals.rows} />
            <Stat label="Clean" value={report.totals.clean} />
            <Stat label="Auto-resolved" value={report.totals.autoResolved} />
            <Stat label="Need review" value={report.totals.needsReview} />
            <Stat label="Anomalies" value={report.totals.anomalies} />
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            Will become: {report.totals.expenses} expenses · {report.totals.settlements} settlements · {report.totals.dropped} dropped
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card">
          <div className="spread">
            <h2 style={{ margin: 0 }}>Rows</h2>
            <button className="good" disabled={busy} onClick={commit}>Commit approved & auto rows</button>
          </div>
          <table>
            <thead><tr><th>#</th><th>Description</th><th>Will be</th><th>Status</th><th>Anomalies</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const raw = parseRaw(r.raw);
                const needsReview = r.status === 'needs_review';
                return (
                  <tr key={r.id}>
                    <td>{r.line_number}</td>
                    <td>{raw.description || <span className="muted">—</span>}</td>
                    <td><span className="pill">{r.target_kind}</span></td>
                    <td><StatusPill status={r.status} /></td>
                    <td>
                      {(r.anomalies || []).map((a) => (
                        <div key={a.id} style={{ marginBottom: 4 }}>
                          <span className={`pill ${a.severity}`}>{a.type}</span>{' '}
                          <span className="muted" style={{ fontSize: 12 }}>{a.description}</span>
                        </div>
                      ))}
                      {(!r.anomalies || r.anomalies.length === 0) && <span className="muted">—</span>}
                    </td>
                    <td>
                      {needsReview && (
                        <div className="row" style={{ gap: 6 }}>
                          <button className="small good" onClick={() => review(r.id, 'approve')}>Approve</button>
                          <button className="small danger" onClick={() => review(r.id, 'reject')}>Reject</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {summary && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Commit summary</h2>
          <p>Inserted <strong>{summary.expenses}</strong> expenses, <strong>{summary.settlements}</strong> settlements; dropped <strong>{summary.dropped}</strong>.</p>
          {summary.skipped?.length > 0 && (
            <>
              <div className="muted">Held back / skipped:</div>
              <ul>{summary.skipped.map((s, i) => <li key={i} className="muted">row {s.rowNumber}: {s.reason}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div className="card tight stat">
      <div className="stat-num">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function StatusPill({ status }) {
  const cls = status === 'needs_review' ? 'warning' : status === 'rejected' ? 'blocker' : 'info';
  return <span className={`pill ${cls}`}>{status}</span>;
}
