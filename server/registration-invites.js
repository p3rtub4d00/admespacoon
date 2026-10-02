import crypto from 'node:crypto'

const invalid = () => Object.assign(new Error('Link inválido, expirado, revogado ou já utilizado.'), { statusCode: 404 })
export function registrationTokenHash(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalid()
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function installRegistrationInvites({ app, mongoose, requireMaster, writeLimiter, validateClubInput, referralSnapshot }) {
  const schema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    clubId: { type: String, required: true, unique: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    submittedAt: Date,
    revokedAt: Date,
    approvedAt: Date,
    referral: { partnerId: String, partnerName: String, amount: Number },
    registration: {
      establishmentName: String, ownerName: String, cpfCnpj: String,
      phone: String, email: String, city: String, state: String,
    },
  }, { timestamps: true })
  const Invite = mongoose.model('RegistrationInvite', schema)
  const available = token => ({ tokenHash: registrationTokenHash(token), submittedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } })

  app.use('/api/registration', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  app.post('/api/master/registration-invites', requireMaster, writeLimiter, async (req, res, next) => {
    try {
      const base = new URL(process.env.PUBLIC_BASE_URL || (req.protocol + '://' + req.get('host')))
      if (process.env.NODE_ENV === 'production' && base.protocol !== 'https:') throw Object.assign(new Error('Configure PUBLIC_BASE_URL com o endereço HTTPS do painel master.'), { statusCode: 400 })
      const referral = await referralSnapshot(req.body?.partnerId)
      const rawToken = crypto.randomBytes(32).toString('base64url')
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
      const id = crypto.randomUUID()
      await Invite.create({ id, clubId: 'CLB-' + crypto.randomUUID(), tokenHash: registrationTokenHash(rawToken), expiresAt, ...(referral ? { referral } : {}) })
      res.status(201).json({ id, expiresAt, referral, url: base.origin + '/cadastro#convite=' + rawToken })
    } catch (error) { next(error) }
  })
  app.get('/api/master/registration-invites', requireMaster, async (_req, res, next) => {
    try {
      const rows = await Invite.find({ approvedAt: null, revokedAt: null }).sort({ createdAt: -1 }).limit(100).lean()
      res.json(rows.map(row => ({ id: row.id, expiresAt: row.expiresAt, submittedAt: row.submittedAt || null, createdAt: row.createdAt, registration: row.submittedAt ? row.registration : null, referral: row.referral?.partnerId ? row.referral : null })))
    } catch (error) { next(error) }
  })
  app.delete('/api/master/registration-invites/:id', requireMaster, writeLimiter, async (req, res, next) => {
    try {
      const row = await Invite.findOneAndUpdate({ id: req.params.id, approvedAt: null, revokedAt: null }, { $set: { revokedAt: new Date() } }, { new: true })
      if (!row) return res.status(404).json({ error: 'Convite não encontrado.' })
      res.json({ ok: true })
    } catch (error) { next(error) }
  })
  app.post('/api/registration/info', writeLimiter, async (req, res, next) => {
    try {
      const row = await Invite.findOne(available(req.body?.token)).lean()
      if (!row) throw invalid()
      res.json({ valid: true, expiresAt: row.expiresAt })
    } catch (error) { next(error) }
  })
  app.post('/api/registration/complete', writeLimiter, async (req, res, next) => {
    try {
      const filter = available(req.body?.token)
      if (req.body?.privacyAcknowledged !== true) throw Object.assign(new Error('Leia o aviso de privacidade antes de enviar.'), { statusCode: 400 })
      // Public callers never control billing, credentials, demo mode or system URL.
      const fields = ['establishmentName', 'ownerName', 'cpfCnpj', 'phone', 'email', 'city', 'state']
      for (const key of fields) {
        const value = req.body?.[key]
        if (value !== undefined && (typeof value !== 'string' || value.length > 180)) throw Object.assign(new Error('Dados de cadastro inválidos.'), { statusCode: 400 })
      }
      const safe = Object.fromEntries(fields.map(key => [key, req.body?.[key]]))
      const validated = validateClubInput(safe)
      const registration = Object.fromEntries(fields.map(key => [key, validated[key] || '']))
      const row = await Invite.findOneAndUpdate(filter, { $set: { registration, submittedAt: new Date() } }, { new: true })
      if (!row) throw invalid()
      // Never echo personal data or issue a license/session to a public caller.
      res.status(201).json({ ok: true })
    } catch (error) { next(error) }
  })
  return Invite
}
