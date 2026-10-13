async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw Object.assign(new Error((await res.json().catch(() => ({}))).error || res.statusText), { status: res.status });
  return res.json();
}

export const api = {
  me: () => call('GET', '/api/me'),
  login: (password) => call('POST', '/api/login', { password }),
  logout: () => call('POST', '/api/logout'),
  state: () => call('GET', '/api/state'),
  put: (key, value) => call('PUT', `/api/state/${key}`, value),
};
