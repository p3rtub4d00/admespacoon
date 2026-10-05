import crypto from 'node:crypto'
import { rateLimit } from 'express-rate-limit'
export const recoveryMessage = 'Se o celular corresponder ao cadastro deste clube, nossa equipe receberá o pedido e enviará um link pelo WhatsApp cadastrado. Aguarde o atendimento.'
export function recoveryPhone(value) {
  if (typeof value !== 'string' || value.length > 30 || !/^[+\d\s()-]+$/.test(value)) return ''
  let digits = value.replace(/\D/g, '')
  if ([12, 13].includes(digits.length) && digits.startsWith('55')) digits = digits.slice(2)
  return /^\d{10,11}$/.test(digits) ? digits : ''
}
const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next)
export function installClubRecovery({ app, mongoose, Club, requireMaster, authenticateClubLicense, writeLimiter, notifyMaster, createAccessLink, logAction }) {
  const Request = mongoose.models.ClubRecoveryRequest || mongoose.model('ClubRecoveryRequest', new mongoose.Schema({
    clubId: { type: String, unique: true }, phone: String,
    status: { type: String, enum: ['pending', 'issued', 'dismissed'], default: 'pending' },
    requestedAt: Date, handledAt: Date, pushRequestedAt: Date,
  }, { timestamps: true }).index({ status: 1, requestedAt: -1 }))
  const limiter = rateLimit({ windowMs: 15 * 60000, limit: 5, keyGenerator: req => req.club.id, standardHeaders: true, legacyHeaders: false, message: { error: 'Aguarde alguns minutos antes de solicitar novamente.' } })
  app.post('/api/license/admin-auth/recovery', authenticateClubLicense, limiter, route(async (req, res) => {
    const club = req.club
    const phone = recoveryPhone(req.body?.phone)
    if (phone && phone === recoveryPhone(club.phone) && !club.demoMode && !req.body?.company) {
      const now = new Date(), cooldown = new Date(now.getTime() - 10 * 60000)
      await Request.updateOne({ clubId: club.id, status: { $ne: 'pending' }, requestedAt: { $lt: cooldown } }, { $set: { phone, status: 'pending', requestedAt: now, handledAt: null } })
      try { await Request.updateOne({ clubId: club.id }, { $setOnInsert: { phone, status: 'pending', requestedAt: now } }, { upsert: true }) } catch (e) { if (e.code !== 11000) throw e }
      const alert = await Request.findOneAndUpdate({ clubId: club.id, status: 'pending', $or: [{ pushRequestedAt: { $exists: false } }, { pushRequestedAt: null }, { pushRequestedAt: { $lte: new Date(now.getTime() - 60000) } }] }, { $set: { pushRequestedAt: now, phone } }, { new: true }).lean()
      if (alert) notifyMaster({ title: 'Recuperação de senha do clube', body: 'Um proprietário solicitou acesso ao painel. Abra o Master para conferir e enviar o link.', url: '/?view=notifications', tag: 'club-recovery-' + crypto.randomUUID() })
    }
    res.set('Cache-Control', 'no-store').json({ ok: true, message: recoveryMessage })
  }))
  app.get('/api/master/club-recovery', requireMaster, route(async (_req, res) => {
    const filter = { status: 'pending' }
    const [count, requests] = await Promise.all([Request.countDocuments(filter), Request.find(filter).sort({ requestedAt: -1 }).limit(50).lean()])
    const clubs = await Club.find({ id: { $in: requests.map(x => x.clubId) } }).select('id establishmentName ownerName phone demoMode').lean()
    const byId = new Map(clubs.map(x => [x.id, x]))
    res.json({ count, requests: requests.map(row => ({ clubId: row.clubId, requestedAt: row.requestedAt, name: byId.get(row.clubId)?.establishmentName || 'Clube removido', ownerName: byId.get(row.clubId)?.ownerName || '', phone: byId.get(row.clubId)?.phone || '', available: Boolean(byId.get(row.clubId) && !byId.get(row.clubId).demoMode) })) })
  }))
  app.post('/api/master/club-recovery/:id/issue', requireMaster, writeLimiter, route(async (req, res) => {
    const request = await Request.findOne({ clubId: req.params.id, status: 'pending' }).lean()
    const club = request && await Club.findOne({ id: request.clubId })
    if (!club) return res.status(404).json({ error: 'Pedido ou clube não encontrado.' })
    if (recoveryPhone(club.phone) !== request.phone) return res.status(409).json({ error: 'O celular do cadastro mudou. Confira o responsável e solicite um novo pedido.' })
    const data = await createAccessLink(club, req, 'reset')
    await Request.updateOne({ clubId: club.id, status: 'pending' }, { $set: { status: 'issued', handledAt: new Date() } })
    res.json(data)
  }))
  app.post('/api/master/club-recovery/:id/dismiss', requireMaster, writeLimiter, route(async (req, res) => {
    await Request.updateOne({ clubId: req.params.id, status: 'pending' }, { $set: { status: 'dismissed', handledAt: new Date() } })
    await logAction('club.recovery_dismissed', 'Pedido de recuperação de senha arquivado.', { id: req.params.id })
    res.json({ ok: true })
  }))
  return Request
}
