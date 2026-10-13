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
  signup: (fields) => call('POST', '/api/signup', fields),
  login: (email, password) => call('POST', '/api/login', { email, password }),
  forgot: (email) => call('POST', '/api/forgot', { email }),
  reset: (token, password) => call('POST', '/api/reset', { token, password }),
  logout: () => call('POST', '/api/logout'),
  account: (patch) => call('PUT', '/api/account', patch),
  state: () => call('GET', '/api/state'),
  put: (key, value) => call('PUT', `/api/state/${key}`, value),
};
