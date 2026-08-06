// Thin fetch wrapper. Session cookie is sent with every request (same-origin in
// prod; via Vite proxy in dev).
async function request(method, url, body) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 401) {
    // Session expired — bubble up so the app can redirect to login.
    const err = new Error('unauthorized');
    err.status = 401;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Erreur');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  delete: (url) => request('DELETE', url),
};

// Trigger a file download from an export endpoint (keeps cookies).
export async function downloadExport(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('Export échoué');
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const match = /filename="?([^"]+)"?/.exec(cd);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = match ? match[1] : 'export.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export default api;
