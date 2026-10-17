// Sent with every request so this tab can tell its own saves apart in the live change events (/api/events).
export const TAB_ID = crypto.randomUUID();

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'X-Tab-Id': TAB_ID, ...(body && { 'Content-Type': 'application/json' }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
  }
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
  feedback: () => call('GET', '/api/feedback'),
  sendFeedback: (item) => call('POST', '/api/feedback', item),
  adminDms: () => call('GET', '/api/admin/dms'),
  generateMonsters: (prompt) => call('POST', '/api/bestiary/generate', { prompt }),
  generateTable: (fields) => call('POST', '/api/encounters/generate', fields),
  importMonsters: (json) => call('POST', '/api/bestiary/import', { json }),
  agentInstructions: () => call('GET', '/api/bestiary/agent-instructions'),
  markFeedback: (id, patch) => call('PUT', `/api/admin/feedback/${id}`, patch),
  oauthRequest: (id) => call('GET', `/api/oauth/request/${encodeURIComponent(id ?? '')}`),
  answerOauth: (id, allow) => call('POST', `/api/oauth/request/${encodeURIComponent(id ?? '')}`, { allow }),
  aiApps: () => call('GET', '/api/oauth/grants'),
  disconnectAiApp: (id) => call('DELETE', `/api/oauth/grants/${id}`),
};
