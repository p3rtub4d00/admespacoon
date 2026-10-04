import crypto from 'node:crypto'
import { promisify } from 'node:util'
import jwt from 'jsonwebtoken'
import rateLimit from 'express-rate-limit'
import { validateCatalog, validatePhotos, publicCatalog } from './catalog.js'
const scrypt = promisify(crypto.scrypt)
const hashToken = value => crypto.createHash('sha256').update(value).digest('hex')
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }) }
export function ownerPhone(value) {
  if (typeof value !== 'string' || value.length > 30) fail('Informe o WhatsApp com DDD.')
  const phone = value.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  if (!/^[1-9]\d{9,10}$/.test(phone)) fail('Informe o WhatsApp com DDD.')
  return phone
}
async function passwordHash(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) fail('Use uma senha de 8 a 128 caracteres.')
  const salt = crypto.randomBytes(16).toString('hex')
  return salt + ':' + (await scrypt(value, salt, 64)).toString('hex')
}
async function passwordMatches(value, stored) {
  if (typeof value !== 'string' || value.length > 128) return false
  const [salt, digest] = stored.split(':')
  const candidate = await scrypt(value, salt, 64)
  const expected = Buffer.from(digest, 'hex')
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)
}
export function installCatalogOwner({ app, mongoose, Entry, requireMaster, writeLimiter, logAction, sessionSecret }) {
  const Account = mongoose.model('CatalogOwner', new mongoose.Schema({ id: { type: String, unique: true }, phone: { type: String, unique: true }, passwordHash: { type: String, select: false }, version: { type: Number, default: 0 }, inviteHash: { type: String, select: false }, inviteExpiresAt: Date }, { timestamps: true }))
  const Request = mongoose.model('CatalogAccessRequest', new mongoose.Schema({ id: { type: String, unique: true }, phone: { type: String, unique: true }, status: { type: String, enum: ['pending', 'issued', 'dismissed'], default: 'pending' }, requestedAt: Date, handledAt: Date }, { timestamps: true }).index({ status: 1, requestedAt: -1 }))
  const route = fn => async (req, res, next) => { try { await fn(req, res, next) } catch (error) { next(error) } }
  const limit = rateLimit({ windowMs: 15 * 60000, limit: 2000, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' } })
  // Additional per-phone throttle protects a single account across changing client IPs.
  const attempts = new Map()
  const throttle = phone => {
    const now = Date.now(), previous = attempts.get(phone)
    if (previous && previous.until > now && previous.count >= 10) fail('Muitas tentativas. Tente novamente em 15 minutos.', 429)
    if (attempts.size > 10000) for (const [key, item] of attempts) if (item.until <= now) attempts.delete(key)
    if (attempts.size > 10000 && !previous) fail('Tente novamente mais tarde.', 429)
    attempts.set(phone, previous && previous.until > now ? { ...previous, count: previous.count + 1 } : { count: 1, until: now + 15 * 60000 })
  }
  const dummyHash = crypto.randomBytes(16).toString('hex') + ':' + crypto.randomBytes(64).toString('hex')
  const sign = account => jwt.sign({ role: 'catalog-owner', sub: account.id, version: account.version }, sessionSecret, { expiresIn: '12h', audience: 'catalog-owner', issuer: 'clubeon-master' })
  const authenticate = route(async (req, _res, next) => {
    let payload
    try { payload = jwt.verify(req.get('x-catalog-owner-session') || '', sessionSecret, { audience: 'catalog-owner', issuer: 'clubeon-master', algorithms: ['HS256'] }) } catch { fail('Entre novamente para gerenciar seus anúncios.', 401) }
    if (payload.role !== 'catalog-owner' || typeof payload.sub !== 'string') fail('Acesso inválido.', 401)
    const account = await Account.findOne({ id: payload.sub, version: payload.version }).lean()
    if (!account) fail('Entre novamente para gerenciar seus anúncios.', 401)
    req.catalogOwner = account; next()
  })
  app.use('/api/catalog/owner', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  app.post('/api/catalog/owner/access-request', limit, route(async (req, res) => {
    const phone = ownerPhone(req.body.phone); throttle(phone)
    if (req.body.company) fail('Pedido inválido.')
    const exists = await Entry.exists({ phone })
    if (exists) {
      const now = new Date()
      await Request.updateOne({ phone, status: { $ne: 'pending' }, requestedAt: { $lt: new Date(Date.now() - 10 * 60000) } }, { $set: { status: 'pending', requestedAt: now, handledAt: null } })
      try { await Request.updateOne({ phone }, { $setOnInsert: { id: crypto.randomUUID(), phone, status: 'pending', requestedAt: now } }, { upsert: true }) } catch (error) { if (error.code !== 11000) throw error }
    }
    res.json({ ok: true, message: 'Se houver anúncios com esse WhatsApp, nossa equipe receberá o pedido e enviará um link para o número cadastrado. Aguarde o atendimento.' })
  }))
  app.post('/api/catalog/owner/activate', limit, route(async (req, res) => {
    const token = req.body.token
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) fail('Link inválido ou expirado. Solicite outro acesso.')
    const digest = await passwordHash(req.body.password)
    const account = await Account.findOneAndUpdate({ inviteHash: hashToken(token), inviteExpiresAt: { $gt: new Date() } }, { $set: { passwordHash: digest }, $unset: { inviteHash: 1, inviteExpiresAt: 1 }, $inc: { version: 1 } }, { new: true }).lean()
    if (!account) fail('Link inválido, expirado ou já utilizado. Solicite outro acesso.')
    res.json({ ok: true, sessionToken: sign(account) })
  }))
  app.post('/api/catalog/owner/login', limit, route(async (req, res) => {
    const phone = ownerPhone(req.body.phone); throttle(phone)
    const account = await Account.findOne({ phone }).select('+passwordHash').lean()
    const valid = await passwordMatches(req.body.password, account?.passwordHash || dummyHash)
    if (!account?.passwordHash || !valid) fail('WhatsApp ou senha inválidos.', 401)
    res.json({ ok: true, sessionToken: sign(account) })
  }))
  app.get('/api/catalog/owner/session', authenticate, (req, res) => res.json({ authenticated: true, phone: req.catalogOwner.phone }))
  app.get('/api/catalog/owner/entries', authenticate, route(async (req, res) => {
    const page = Number(req.query.page || 1)
    if (!Number.isInteger(page) || page < 1 || page > 1000) fail('Página inválida.')
    const rows = await Entry.find({ ownerId: req.catalogOwner.id }).sort({ createdAt: -1, id: 1 }).skip((page - 1) * 30).limit(31).lean()
    res.json({ phone: req.catalogOwner.phone, hasMore: rows.length > 30, entries: rows.slice(0, 30).map(row => ({ ...publicCatalog(row), ownerName: row.ownerName, email: row.email, status: row.status, photos: Array.from({ length: row.photoCount || 0 }, (_, i) => `/api/catalog/owner/photos/${row.id}/${i}`) })) })
  }))
  app.get('/api/catalog/owner/photos/:id/:index', authenticate, route(async (req, res) => {
    const index = Number(req.params.index)
    if (!Number.isInteger(index) || index < 0 || index > 5) return res.sendStatus(404)
    const row = await Entry.findOne({ id: req.params.id, ownerId: req.catalogOwner.id }).select('+photos').lean()
    const item = row?.photos?.[index]; if (!item) return res.sendStatus(404)
    res.type('jpeg').send(Buffer.isBuffer(item.data) ? item.data : Buffer.from(item.data.buffer))
  }))
  app.put('/api/catalog/owner/entries/:id', authenticate, writeLimiter, route(async (req, res) => {
    const current = await Entry.findOne({ id: req.params.id, ownerId: req.catalogOwner.id }).select('+photos').lean()
    if (!current) return res.status(404).json({ error: 'Anúncio não encontrado.' })
    // Changing the WhatsApp requires the team's review; it never changes account ownership.
    const fields = validateCatalog({ ...req.body, phone: current.phone })
    const items = req.body.photos
    if (!Array.isArray(items) || items.length < 1 || items.length > 6) fail('Mantenha de uma a seis fotos.')
    const photos = items.map(item => {
      if (typeof item === 'string') return validatePhotos([item])[0]
      if (item && Number.isInteger(item.existing) && item.existing >= 0 && item.existing < current.photos.length) { const photo = current.photos[item.existing]; return { contentType: 'image/jpeg', data: Buffer.isBuffer(photo.data) ? photo.data : Buffer.from(photo.data.buffer) } }
      fail('Foto inválida. Selecione novamente.')
    })
    if (photos.reduce((sum, photo) => sum + photo.data.length, 0) > 600000) fail('Fotos acima do limite.')
    // A refused/hidden ad stays off the site until the master explicitly publishes it.
    const row = await Entry.findOneAndUpdate({ id: current.id, ownerId: req.catalogOwner.id }, { $set: { ...fields, photos, photoCount: photos.length, reviewStatus: 'new', reviewedAt: null } }, { new: true, runValidators: true }).lean()
    if (!row) return res.status(404).json({ error: 'Anúncio não encontrado.' })
    await logAction('catalog.owner.updated', 'Anunciante atualizou seu anúncio.', null, { catalogId: row.id })
    res.json({ ok: true })
  }))
  app.delete('/api/catalog/owner/entries/:id', authenticate, writeLimiter, route(async (req, res) => {
    if (req.body.confirmation !== req.params.id) fail('Confirme a exclusão do anúncio.')
    const row = await Entry.findOneAndDelete({ id: req.params.id, ownerId: req.catalogOwner.id }).lean()
    if (!row) return res.status(404).json({ error: 'Anúncio não encontrado.' })
    await logAction('catalog.owner.deleted', 'Anunciante excluiu seu anúncio e fotos.', null, { catalogId: row.id })
    res.json({ ok: true })
  }))
  app.get('/api/master/catalog/access-requests', requireMaster, route(async (req, res) => {
    const page = Number(req.query.page || 1)
    if (!Number.isInteger(page) || page < 1 || page > 1000) fail('Página inválida.')
    const requests = await Request.find({ status: 'pending' }).sort({ requestedAt: -1 }).skip((page - 1) * 20).limit(21).lean()
    const rows = await Promise.all(requests.slice(0, 20).map(async item => ({ id: item.id, phone: item.phone, requestedAt: item.requestedAt, entries: await Entry.find({ phone: item.phone }).select('id name ownerName city ownerId status').limit(101).lean() })))
    res.json({ requests: rows, hasMore: requests.length > 20 })
  }))
  app.post('/api/master/catalog/access-requests/:id/issue', requireMaster, writeLimiter, route(async (req, res) => {
    const request = await Request.findOne({ id: req.params.id, status: 'pending' }).lean()
    if (!request) return res.status(404).json({ error: 'Pedido não encontrado ou já atendido.' })
    if (!Array.isArray(req.body.entryIds) || !req.body.entryIds.length || req.body.entryIds.length > 100 || req.body.entryIds.some(id => typeof id !== 'string' || id.length > 64)) fail('Selecione os anúncios que pertencem ao responsável.')
    const token = crypto.randomBytes(32).toString('hex'), expiresAt = new Date(Date.now() + 24 * 3600000)
    const account = await Account.findOneAndUpdate({ phone: request.phone }, { $setOnInsert: { id: crypto.randomUUID(), phone: request.phone, version: 0 } }, { upsert: true, new: true }).lean()
    const filter = { id: { $in: [...new Set(req.body.entryIds)] }, phone: request.phone, $or: [{ ownerId: account.id }, { ownerId: { $exists: false } }, { ownerId: null }] }
    const entries = await Entry.find(filter).select('id name').lean()
    if (entries.length !== new Set(req.body.entryIds).size) fail('Confira os anúncios selecionados. Um deles mudou ou pertence a outra conta.')
    const claimed = await Request.findOneAndUpdate({ id: request.id, status: 'pending' }, { $set: { status: 'issued', handledAt: new Date() } }, { new: true }).lean()
    if (!claimed) fail('Esse pedido já foi atendido.', 409)
    try {
      const assigned = await Entry.updateMany(filter, { $set: { ownerId: account.id } })
      if (assigned.matchedCount !== entries.length) fail('Um anúncio mudou durante a liberação. Confira e tente novamente.', 409)
      await Account.updateOne({ id: account.id }, { $set: { inviteHash: hashToken(token), inviteExpiresAt: expiresAt } })
    } catch (error) { await Request.updateOne({ id: request.id }, { $set: { status: 'pending', handledAt: null } }); throw error }
    const url = `https://clubeon.rubli.com.br/#ativar=${token}`
    await logAction('catalog.access.issued', 'Link de acesso do anunciante gerado.', null, { requestId: request.id, catalogIds: entries.map(row => row.id) })
    res.json({ url, expiresAt, whatsappUrl: `https://wa.me/55${request.phone}?text=${encodeURIComponent('Olá! Aqui é a equipe ClubeOn. Para gerenciar seus anúncios, abra o link e defina sua senha: ' + url + '\nO link vale por 24 horas e só pode ser usado uma vez. Depois, entre com seu WhatsApp e sua senha. Não compartilhe este link.')}` })
  }))
  app.post('/api/master/catalog/access-requests/:id/dismiss', requireMaster, writeLimiter, route(async (req, res) => {
    await Request.updateOne({ id: req.params.id, status: 'pending' }, { $set: { status: 'dismissed', handledAt: new Date() } })
    res.json({ ok: true })
  }))
  return { Request, Account }
}
