async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
    },
    ...options,
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || 'Não foi possível concluir a operação.')
  }
  return data
}

export const api = {
  session: () => request('/api/master/session'),
  login: (password) =>
    request('/api/master/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () => request('/api/master/logout', { method: 'POST' }),

  dashboard: () => request('/api/master/dashboard'),
  revenue: (month) =>
    request('/api/master/revenue?month=' + encodeURIComponent(month)),
  settings: () => request('/api/master/settings'),
  saveSettings: (payload) =>
    request('/api/master/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  clubs: () => request('/api/master/clubs'),
  clubDetails: (id) =>
    request('/api/master/clubs/' + encodeURIComponent(id) + '/details'),
  createClub: (payload) =>
    request('/api/master/clubs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateClub: (id, payload) =>
    request('/api/master/clubs/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  setDemoMode: (id, enabled) =>
    request('/api/master/clubs/' + encodeURIComponent(id) + '/demo-mode', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  setClubStatus: (id, systemStatus, reason) =>
    request('/api/master/clubs/' + encodeURIComponent(id) + '/status', {
      method: 'POST',
      body: JSON.stringify({ systemStatus, reason }),
    }),
  temporaryUnlock: (id, hours) =>
    request('/api/master/clubs/' + encodeURIComponent(id) + '/temporary-unlock', {
      method: 'POST',
      body: JSON.stringify({ hours }),
    }),
  markPaid: (id, paidAmount) =>
    request('/api/master/clubs/' + encodeURIComponent(id) + '/mark-paid', {
      method: 'POST',
      body: JSON.stringify(paidAmount == null ? {} : { paidAmount }),
    }),
  rotateLicense: (id) =>
    request('/api/master/clubs/' + encodeURIComponent(id) + '/rotate-license', {
      method: 'POST',
    }),
  pushStatus: () => request('/api/master/push/status'),
  subscribePush: (subscription) =>
    request('/api/master/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription }),
    }),
  unsubscribePush: (endpoint) =>
    request('/api/master/push/subscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    }),
  testPush: (endpoint) =>
    request('/api/master/push/test', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    }),
  testPushBackground: (endpoint) =>
    request('/api/master/push/test-background', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    }),
  logs: () => request('/api/master/logs'),
}
