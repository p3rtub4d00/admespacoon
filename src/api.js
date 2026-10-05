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
  clubRecoveryRequests: () => request('/api/master/club-recovery'),
  issueClubRecovery: id => request('/api/master/club-recovery/' + encodeURIComponent(id) + '/issue', { method: 'POST', body: '{}' }),
  dismissClubRecovery: id => request('/api/master/club-recovery/' + encodeURIComponent(id) + '/dismiss', { method: 'POST', body: '{}' }),
  aiChat: id => request('/api/master/clubs/' + encodeURIComponent(id) + '/ai-chat'),
  saveAiChat: (id, payload) => request('/api/master/clubs/' + encodeURIComponent(id) + '/ai-chat', { method: 'PUT', body: JSON.stringify(payload) }),
  catalogAccessRequests: (page = 1) => request('/api/master/catalog/access-requests?page=' + page),
  issueCatalogAccess: (id, entryIds) => request('/api/master/catalog/access-requests/' + encodeURIComponent(id) + '/issue', { method: 'POST', body: JSON.stringify({ entryIds }) }),
  dismissCatalogAccess: id => request('/api/master/catalog/access-requests/' + encodeURIComponent(id) + '/dismiss', { method: 'POST', body: '{}' }),
  catalogEntry: id => request('/api/master/catalog/entries/' + encodeURIComponent(id)),
  catalogNotifications: () => request('/api/master/catalog/notifications'),
  catalog: (status, page = 1) => request('/api/master/catalog?status=' + encodeURIComponent(status) + '&page=' + page),
  deleteCatalog: id => request('/api/master/catalog/' + encodeURIComponent(id), { method: 'DELETE', body: JSON.stringify({ confirmation: id }) }),
  catalogMeta: () => request('/api/master/catalog/meta'),
  saveCatalog: (id, payload) => request('/api/master/catalog/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(payload) }),
  privacySettings: () => request('/api/master/privacy'),
  savePrivacySettings: payload => request('/api/master/privacy', { method: 'PUT', body: JSON.stringify(payload) }),
  session: () => request('/api/master/session'),
  login: (password) =>
    request('/api/master/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () => request('/api/master/logout', { method: 'POST' }),

  demoAnalytics: () => request('/api/master/demo-analytics'),
  dashboard: () => request('/api/master/dashboard'),
  revenue: (month) =>
    request('/api/master/revenue?month=' + encodeURIComponent(month)),
  settings: () => request('/api/master/settings'),
  saveSettings: (payload) =>
    request('/api/master/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  referralPartners: () => request('/api/master/referral-partners'),
  createReferralPartner: payload => request('/api/master/referral-partners', { method:'POST', body:JSON.stringify(payload) }),
  updateReferralPartner: (id,payload) => request('/api/master/referral-partners/' + encodeURIComponent(id), { method:'PUT', body:JSON.stringify(payload) }),
  referralCommissions: () => request('/api/master/referral-commissions'),
  payReferralCommission: (id,payload) => request('/api/master/referral-commissions/' + encodeURIComponent(id) + '/paid', { method:'POST', body:JSON.stringify(payload) }),
  cancelReferralCommission: (id,payload) => request('/api/master/referral-commissions/' + encodeURIComponent(id) + '/cancel', { method:'POST', body:JSON.stringify(payload) }),
  registrationInvites: () => request('/api/master/registration-invites'),
  createRegistrationInvite: (payload = {}) => request('/api/master/registration-invites', { method: 'POST', body: JSON.stringify(payload) }),
  revokeRegistrationInvite: id => request('/api/master/registration-invites/' + encodeURIComponent(id), { method: 'DELETE' }),
  registrationInfo: token => request('/api/registration/info', { method: 'POST', credentials: 'omit', body: JSON.stringify({ token }) }),
  completeRegistration: payload => request('/api/registration/complete', { method: 'POST', credentials: 'omit', body: JSON.stringify(payload) }),
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
  deleteClub: (id, confirmation) =>
    request('/api/master/clubs/' + encodeURIComponent(id), {
      method: 'DELETE',
      body: JSON.stringify({ confirmation }),
    }),
  setDemoMode: (id, enabled) =>
    request('/api/master/clubs/' + encodeURIComponent(id) + '/demo-mode', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  setPaymentProvider: (id, provider) =>
    request('/api/master/clubs/' + encodeURIComponent(id) + '/payment-provider', {
      method: 'POST',
      body: JSON.stringify({ provider }),
    }),
  connectMercadoPago: (id) =>
    request('/api/master/clubs/' + encodeURIComponent(id) + '/mercadopago/connect', {
      method: 'POST',
    }),
  disconnectMercadoPago: (id) =>
    request('/api/master/clubs/' + encodeURIComponent(id) + '/mercadopago/disconnect', {
      method: 'POST',
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
  createAdminAccessLink: (id, purpose = 'first-access') =>
    request('/api/master/clubs/' + encodeURIComponent(id) + '/admin-access-link', {
      method: 'POST',
      body: JSON.stringify({ purpose }),
    }),
  adminAccessInfo: (token) =>
    request('/api/admin-access/' + encodeURIComponent(token)),
  completeAdminAccess: (token, password, confirmation) =>
    request('/api/admin-access/' + encodeURIComponent(token) + '/complete', {
      method: 'POST',
      body: JSON.stringify({ password, confirmation }),
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
