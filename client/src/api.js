// Single API module — one function per backend endpoint. Attaches the JWT and
// throws an Error(message) on any non-2xx so callers can show the message.
const BASE = import.meta.env.VITE_API_URL || '/api';

let token = localStorage.getItem('token') || '';
export const setToken = (t) => {
  token = t || '';
  if (t) localStorage.setItem('token', t);
  else localStorage.removeItem('token');
};
export const getToken = () => token;

async function request(method, path, body, isForm = false) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (isForm) {
    payload = body; // FormData; browser sets the multipart boundary
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export const api = {
  // auth
  register: (b) => request('POST', '/auth/register', b),
  login: (b) => request('POST', '/auth/login', b),
  me: () => request('GET', '/auth/me'),

  // groups & members
  listGroups: () => request('GET', '/groups'),
  createGroup: (b) => request('POST', '/groups', b),
  getGroup: (id) => request('GET', `/groups/${id}`),
  addMember: (id, b) => request('POST', `/groups/${id}/members`, b),
  updateMember: (id, mid, b) => request('PATCH', `/groups/${id}/members/${mid}`, b),
  deleteMember: (id, mid) => request('DELETE', `/groups/${id}/members/${mid}`),

  // expenses
  listExpenses: (id) => request('GET', `/groups/${id}/expenses`),
  getExpense: (expenseId) => request('GET', `/expenses/${expenseId}`),
  createExpense: (id, b) => request('POST', `/groups/${id}/expenses`, b),
  updateExpense: (expenseId, b) => request('PATCH', `/expenses/${expenseId}`, b),
  deleteExpense: (expenseId) => request('DELETE', `/expenses/${expenseId}`),

  // settlements
  listSettlements: (id) => request('GET', `/groups/${id}/settlements`),
  createSettlement: (id, b) => request('POST', `/groups/${id}/settlements`, b),

  // balances
  balances: (id) => request('GET', `/groups/${id}/balances`),
  simplified: (id) => request('GET', `/groups/${id}/balances/simplified`),
  memberBalance: (id, mid) => request('GET', `/groups/${id}/members/${mid}/balance`),

  // import
  importCsv: (id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request('POST', `/groups/${id}/import`, fd, true);
  },
  importRows: (importId) => request('GET', `/imports/${importId}`),
  importReport: (importId) => request('GET', `/imports/${importId}/report`),
  reviewRow: (importId, rowId, b) => request('PATCH', `/imports/${importId}/rows/${rowId}`, b),
  commitImport: (importId) => request('POST', `/imports/${importId}/commit`),
};
