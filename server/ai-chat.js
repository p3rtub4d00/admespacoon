export function validateAiChat(body = {}) {
  if (typeof body.enabled !== 'boolean' || !Number.isInteger(body.monthlyLimit) || body.monthlyLimit < 1 || body.monthlyLimit > 100000) throw Object.assign(new Error('Informe ativação e limite mensal entre 1 e 100.000.'), { statusCode: 400 })
  return { enabled: body.enabled, monthlyLimit: body.monthlyLimit }
}
export function validateChatUsage(body = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month || '')) throw Object.assign(new Error('Mês inválido.'), { statusCode: 400 })
  const result = {}
  for (const field of ['attempts', 'calls', 'inputTokens', 'outputTokens', 'totalTokens']) {
    if (!Number.isSafeInteger(body[field]) || body[field] < 0 || body[field] > 1e12) throw Object.assign(new Error('Consumo inválido.'), { statusCode: 400 })
    result[field] = body[field]
  }
  return result
}
export function installMasterAiChat({ app, mongoose, Club, requireMaster, writeLimiter, authenticateClubLicense, logAction }) {
  const Usage = mongoose.models.MasterAiChatUsage || mongoose.model('MasterAiChatUsage', new mongoose.Schema({ _id: String, clubId: { type: String, index: true }, month: String, attempts: Number, calls: Number, inputTokens: Number, outputTokens: Number, totalTokens: Number, reportedAt: Date }))
  app.get('/api/master/clubs/:id/ai-chat', requireMaster, async (req, res, next) => {
    try {
      const club = await Club.findOne({ id: req.params.id }).lean()
      if (!club) return res.status(404).json({ error: 'Clube não encontrado.' })
      const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Porto_Velho', year: 'numeric', month: '2-digit' }).format(new Date())
      const usage = await Usage.findById(club.id + ':' + month).lean()
      res.json({ enabled: club.aiChat?.enabled === true, monthlyLimit: club.aiChat?.monthlyLimit || 1000, usage: usage || { month, attempts: 0, calls: 0, totalTokens: 0 } })
    } catch (e) { next(e) }
  })
  app.put('/api/master/clubs/:id/ai-chat', requireMaster, writeLimiter, async (req, res, next) => {
    try {
      const config = validateAiChat(req.body)
      const club = await Club.findOneAndUpdate({ id: req.params.id }, { $set: { aiChat: config } }, { new: true })
      if (!club) return res.status(404).json({ error: 'Clube não encontrado.' })
      await logAction('club.ai_chat_updated', config.enabled ? 'Chat IA ativado.' : 'Chat IA desativado.', club, config)
      res.json(config)
    } catch (e) { next(e) }
  })
  app.post('/api/license/ai-chat/usage', authenticateClubLicense, async (req, res, next) => {
    try {
      const values = validateChatUsage(req.body)
      const month = req.body.month
      await Usage.findOneAndUpdate({ _id: req.club.id + ':' + month }, { $max: values, $set: { clubId: req.club.id, month, reportedAt: new Date() } }, { upsert: true })
      res.json({ ok: true })
    } catch (e) { next(e) }
  })
}
