export function normalizeSystemUrl(value) {
  if (value == null || String(value).trim() === '') return ''
  try {
    const url = new URL(String(value).trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error()
    return url.origin
  } catch {
    throw Object.assign(new Error('Informe o endereço HTTPS do clube, sem caminho, senha ou parâmetros. Exemplo: https://meu-clube.onrender.com'), { statusCode: 400 })
  }
}

export function adminPanelUrl(club) {
  const base = normalizeSystemUrl(club?.system?.publicUrl)
  return base ? base + '/admin' : null
}

export function parseSetupReport(encoded) {
  if (!encoded || String(encoded).length > 512) return null
  try {
    const report = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    const fields = ['establishmentConfigured', 'pricesConfigured', 'asaasConfigured']
    if (!fields.every(key => typeof report?.[key] === 'boolean')) return null
    return { ...Object.fromEntries(fields.map(key => [key, report[key]])), privacyConfigured: report.privacyConfigured === true }
  } catch { return null }
}

export function provisioningSummary(club, { mercadoPagoConnected = false, active = false, now = new Date() } = {}) {
  const setup = club.provisioning || {}
  const age = now.getTime() - new Date(setup.reportedAt || 0).getTime()
  const connected = Boolean(setup.reportedAt && age >= 0 && age <= 20 * 60 * 1000)
  const checks = [
    { id: 'url', label: 'Endereço do sistema cadastrado', complete: Boolean(club.system?.publicUrl) },
    { id: 'connection', label: 'Sistema conectado com a licença deste clube', complete: connected },
    { id: 'password', label: club.demoMode ? 'Demonstração sem senha' : 'Senha criada pelo proprietário', complete: club.demoMode === true || Boolean(club.adminAuth?.passwordHash && club.adminAuth?.passwordSalt) },
    { id: 'establishment', label: 'Dados do estabelecimento configurados', complete: setup.establishmentConfigured === true },
    { id: 'prices', label: 'Preços das reservas configurados', complete: setup.pricesConfigured === true },
    { id: 'privacy', label: 'Responsável e canal de privacidade informados', complete: setup.privacyConfigured === true },
    { id: 'payments', label: club.demoMode ? 'Pagamentos simulados' : 'Recebimento das reservas configurado', complete: club.demoMode === true || (club.reservationPaymentProvider === 'mercadopago' ? mercadoPagoConnected : setup.asaasConfigured === true) },
  ]
  const usable = active && (club.demoMode === true || !['past_due', 'suspended', 'cancelled'].includes(club.billing?.status))
  return { ready: usable && checks.every(item => item.complete), active: usable, checks, reportedAt: setup.reportedAt || null, adminUrl: adminPanelUrl(club) }
}
