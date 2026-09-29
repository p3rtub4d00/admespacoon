import express from 'express'
import mongoose from 'mongoose'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import crypto from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const app = express()
const PORT = process.env.PORT || 10000
const MONGODB_URI = process.env.MONGODB_URI
const MASTER_PASSWORD = process.env.MASTER_PASSWORD
const JWT_SECRET = process.env.JWT_SECRET
const ASAAS_API_KEY = String(process.env.ASAAS_API_KEY || '').trim()
const ASAAS_ENV = String(process.env.ASAAS_ENV || 'production').toLowerCase()
const ASAAS_WEBHOOK_TOKEN = String(process.env.ASAAS_WEBHOOK_TOKEN || '').trim()
const ASAAS_BASE_URL = ASAAS_ENV === 'sandbox'
  ? 'https://api-sandbox.asaas.com/v3'
  : 'https://api.asaas.com/v3'

app.set('trust proxy', 1)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
}))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de acesso. Aguarde alguns minutos.' },
})

const writeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas alterações em pouco tempo. Aguarde alguns instantes.' },
})

const publicLicenseLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas consultas de licença.' },
})

const clubSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  slug: { type: String, required: true, unique: true, index: true },
  establishmentName: { type: String, required: true },
  ownerName: { type: String, required: true },
  cpfCnpj: { type: String, default: '' },
  phone: { type: String, required: true },
  email: String,
  city: String,
  state: String,
  plan: {
    name: { type: String, default: 'EspaçoOn' },
    price: { type: Number, default: 49.9 },
  },
  billing: {
    dueDay: { type: Number, default: 10 },
    nextDueDate: Date,
    status: {
      type: String,
      enum: ['trial', 'active', 'past_due', 'suspended', 'cancelled'],
      default: 'active',
      index: true,
    },
    lastPaidAt: Date,
    graceUntil: Date,
    asaasCustomerId: String,
    asaasSubscriptionId: String,
    currentPaymentId: String,
    currentPaymentDueDate: Date,
  },
  system: {
    status: {
      type: String,
      enum: ['active', 'suspended', 'cancelled'],
      default: 'active',
      index: true,
    },
    lastSeen: Date,
    temporaryUnlockUntil: Date,
  },
  licenseKeyHash: { type: String, required: true },
}, { timestamps: true })

const paymentSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  clubId: { type: String, required: true, index: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['paid', 'pending', 'cancelled'], default: 'paid' },
  provider: { type: String, default: 'manual' },
  paidAt: Date,
  cycleStart: Date,
  cycleEnd: Date,
}, { timestamps: true })

const auditLogSchema = new mongoose.Schema({
  action: { type: String, required: true, index: true },
  description: { type: String, required: true },
  clubId: { type: String, index: true },
  clubName: String,
  metadata: mongoose.Schema.Types.Mixed,
}, { timestamps: true })

const Club = mongoose.model('Club', clubSchema)
const Payment = mongoose.model('MasterPayment', paymentSchema)
const AuditLog = mongoose.model('AuditLog', auditLogSchema)

const webhookEventSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  event: String,
  processedAt: { type: Date, default: Date.now },
}, { timestamps: true })

const WebhookEvent = mongoose.model('MasterWebhookEvent', webhookEventSchema)

function onlyDigits(value = '') {
  return String(value).replace(/\D/g, '')
}

function text(value, max = 160) {
  return String(value ?? '').trim().slice(0, max)
}

function secureEqual(a = '', b = '') {
  const aa = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (aa.length !== bb.length) return false
  return crypto.timingSafeEqual(aa, bb)
}

function randomId(prefix) {
  return prefix + '-' + crypto.randomBytes(5).toString('hex').toUpperCase()
}

function slugify(value) {
  return text(value, 120)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

function hashLicense(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex')
}

function generateLicenseKey() {
  return crypto.randomBytes(32).toString('base64url')
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function nextDueDateFromDay(dueDay, from = new Date()) {
  const year = from.getFullYear()
  const month = from.getMonth()
  let date = new Date(year, month, Math.min(Number(dueDay) || 10, 28), 12)
  if (date <= from) date = new Date(year, month + 1, Math.min(Number(dueDay) || 10, 28), 12)
  return date
}

async function asaasRequest(pathname, options = {}) {
  if (!ASAAS_API_KEY) throw Object.assign(new Error('Asaas não configurado no Master.'), { statusCode: 503 })

  const response = await fetch(ASAAS_BASE_URL + pathname, {
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      access_token: ASAAS_API_KEY,
      'user-agent': 'EspacoOn-Master/1.0',
      ...(options.headers || {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = data?.errors?.[0]?.description || data?.error || 'Erro na API do Asaas.'
    throw Object.assign(new Error(message), { statusCode: response.status >= 500 ? 502 : 400 })
  }
  return data
}

async function ensureAsaasCustomer(club) {
  if (club.billing?.asaasCustomerId) return club.billing.asaasCustomerId
  if (!club.cpfCnpj) {
    throw Object.assign(new Error('Cadastre o CPF/CNPJ do responsável antes de gerar a cobrança.'), { statusCode: 400 })
  }

  const customer = await asaasRequest('/customers', {
    method: 'POST',
    body: {
      name: club.ownerName || club.establishmentName,
      cpfCnpj: club.cpfCnpj,
      mobilePhone: club.phone,
      ...(club.email ? { email: club.email } : {}),
      externalReference: club.id,
      notificationDisabled: false,
    },
  })

  club.billing.asaasCustomerId = customer.id
  await club.save()
  return customer.id
}

async function ensureAsaasSubscription(club) {
  if (club.billing?.asaasSubscriptionId) return club.billing.asaasSubscriptionId

  const customerId = await ensureAsaasCustomer(club)
  const dueDate = club.billing?.nextDueDate ? new Date(club.billing.nextDueDate) : new Date()
  const nextDueDate = dueDate.toISOString().slice(0, 10)

  const subscription = await asaasRequest('/subscriptions', {
    method: 'POST',
    body: {
      customer: customerId,
      billingType: 'PIX',
      nextDueDate,
      value: 49.9,
      cycle: 'MONTHLY',
      description: 'Assinatura mensal EspaçoOn',
      externalReference: club.id,
    },
  })

  club.billing.asaasSubscriptionId = subscription.id
  await club.save()
  await logAction('billing.subscription_created', 'Assinatura mensal criada no Asaas.', club, { subscriptionId: subscription.id })
  return subscription.id
}

async function getCurrentSubscriptionPayment(club) {
  const subscriptionId = await ensureAsaasSubscription(club)
  const list = await asaasRequest('/subscriptions/' + encodeURIComponent(subscriptionId) + '/payments')
  const payments = Array.isArray(list?.data) ? list.data : []

  const open = payments
    .filter((payment) => !['RECEIVED', 'CONFIRMED', 'REFUNDED', 'DELETED'].includes(payment.status))
    .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')))[0]

  const chosen = open || payments.sort((a, b) => String(b.dueDate || '').localeCompare(String(a.dueDate || '')))[0]
  if (!chosen?.id) {
    throw Object.assign(new Error('O Asaas ainda não gerou uma cobrança para esta assinatura.'), { statusCode: 409 })
  }

  club.billing.currentPaymentId = chosen.id
  if (chosen.dueDate) club.billing.currentPaymentDueDate = new Date(chosen.dueDate + 'T12:00:00')
  await club.save()

  return chosen
}

async function getPixForClub(club) {
  const payment = await getCurrentSubscriptionPayment(club)
  const qr = await asaasRequest('/payments/' + encodeURIComponent(payment.id) + '/pixQrCode')

  return {
    amount: Number(payment.value || 49.9),
    dueDate: payment.dueDate || club.billing?.nextDueDate,
    paymentId: payment.id,
    status: payment.status,
    encodedImage: qr.encodedImage,
    payload: qr.payload,
    expirationDate: qr.expirationDate,
  }
}

function authenticateClubLicense(req, res, next) {
  Promise.resolve().then(async () => {
    const clubId = text(req.get('x-club-id'), 60)
    const licenseKey = text(req.get('x-license-key'), 200)
    if (!clubId || !licenseKey) return res.status(401).json({ error: 'Credenciais de licença ausentes.' })

    const club = await Club.findOne({ id: clubId })
    if (!club || !secureEqual(club.licenseKeyHash, hashLicense(licenseKey))) {
      return res.status(401).json({ error: 'Licença inválida.' })
    }

    req.club = club
    next()
  }).catch(next)
}

function signSession() {
  return jwt.sign({ role: 'master' }, JWT_SECRET, { expiresIn: '12h' })
}

function requireMaster(req, res, next) {
  try {
    const token = req.cookies?.espacoon_master
    if (!token) return res.status(401).json({ error: 'Sessão não autenticada.' })
    const payload = jwt.verify(token, JWT_SECRET)
    if (payload?.role !== 'master') return res.status(403).json({ error: 'Acesso negado.' })
    next()
  } catch {
    res.status(401).json({ error: 'Sessão expirada.' })
  }
}

async function logAction(action, description, club = null, metadata = null) {
  await AuditLog.create({
    action,
    description,
    clubId: club?.id,
    clubName: club?.establishmentName,
    metadata,
  })
}

async function refreshClubStatus(club) {
  if (!club || club.billing?.status === 'cancelled' || club.system?.status === 'cancelled') return club

  const now = new Date()
  const dueDate = club.billing?.nextDueDate ? new Date(club.billing.nextDueDate) : null
  const tempUnlock = club.system?.temporaryUnlockUntil ? new Date(club.system.temporaryUnlockUntil) : null

  if (tempUnlock && tempUnlock <= now) {
    club.system.temporaryUnlockUntil = null
  }

  if (dueDate && dueDate < now && club.billing.status === 'active') {
    club.billing.status = 'past_due'
    club.billing.graceUntil = addDays(dueDate, 5)
  }

  if (
    club.billing.status === 'past_due' &&
    club.billing.graceUntil &&
    new Date(club.billing.graceUntil) < now &&
    !club.system.temporaryUnlockUntil
  ) {
    club.billing.status = 'suspended'
    club.system.status = 'suspended'
  }

  await club.save()
  return club
}

function effectiveAccess(club) {
  if (!club) return false
  if (club.system?.status === 'cancelled') return false
  if (club.system?.status === 'active') return true
  const unlock = club.system?.temporaryUnlockUntil
  return Boolean(unlock && new Date(unlock) > new Date())
}

function validateClubInput(body, partial = false) {
  const result = {}

  if (!partial || body.establishmentName !== undefined) {
    result.establishmentName = text(body.establishmentName, 120)
    if (result.establishmentName.length < 2) throw Object.assign(new Error('Informe o nome do clube.'), { statusCode: 400 })
  }

  if (!partial || body.ownerName !== undefined) {
    result.ownerName = text(body.ownerName, 120)
    if (result.ownerName.length < 3) throw Object.assign(new Error('Informe o nome do responsável.'), { statusCode: 400 })
  }

  if (!partial || body.cpfCnpj !== undefined) {
    result.cpfCnpj = onlyDigits(body.cpfCnpj).slice(0, 14)
    if (result.cpfCnpj && ![11, 14].includes(result.cpfCnpj.length)) {
      throw Object.assign(new Error('CPF/CNPJ inválido.'), { statusCode: 400 })
    }
  }

  if (!partial || body.phone !== undefined) {
    result.phone = onlyDigits(body.phone).slice(0, 13)
    if (result.phone.length < 10) throw Object.assign(new Error('Informe um telefone válido.'), { statusCode: 400 })
  }

  if (body.email !== undefined) {
    result.email = text(body.email, 160).toLowerCase()
    if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) {
      throw Object.assign(new Error('E-mail inválido.'), { statusCode: 400 })
    }
  }

  if (body.city !== undefined) result.city = text(body.city, 100)
  if (body.state !== undefined) {
    result.state = text(body.state, 2).toUpperCase()
    if (result.state && !/^[A-Z]{2}$/.test(result.state)) {
      throw Object.assign(new Error('UF inválida.'), { statusCode: 400 })
    }
  }

  if (!partial || body.dueDay !== undefined) {
    const dueDay = Number(body.dueDay || 10)
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
      throw Object.assign(new Error('Dia de vencimento inválido.'), { statusCode: 400 })
    }
    result.dueDay = dueDay
  }

  return result
}

function publicClub(club) {
  return {
    id: club.id,
    slug: club.slug,
    establishmentName: club.establishmentName,
    ownerName: club.ownerName,
    cpfCnpj: club.cpfCnpj,
    phone: club.phone,
    email: club.email,
    city: club.city,
    state: club.state,
    plan: club.plan,
    billing: club.billing,
    system: club.system,
    createdAt: club.createdAt,
    updatedAt: club.updatedAt,
  }
}

app.post('/api/master/login', loginLimiter, (req, res) => {
  if (!secureEqual(req.body?.password, MASTER_PASSWORD)) {
    return res.status(401).json({ error: 'Senha incorreta.' })
  }
  res.cookie('espacoon_master', signSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  })
  res.json({ ok: true })
})

app.get('/api/master/session', requireMaster, (_req, res) => {
  res.json({ authenticated: true })
})

app.post('/api/master/logout', (_req, res) => {
  res.clearCookie('espacoon_master', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  })
  res.json({ ok: true })
})

app.get('/api/master/dashboard', requireMaster, async (_req, res, next) => {
  try {
    const clubs = await Club.find()
    for (const club of clubs) await refreshClubStatus(club)

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const payments = await Payment.find({ status: 'paid', paidAt: { $gte: monthStart } }).lean()

    const active = clubs.filter((c) => effectiveAccess(c) && c.system.status !== 'cancelled')
    const pastDue = clubs.filter((c) => ['past_due', 'suspended'].includes(c.billing.status))

    res.json({
      totalClubs: clubs.length,
      activeClubs: active.length,
      pastDueClubs: pastDue.length,
      suspendedClubs: clubs.filter((c) => c.system.status === 'suspended').length,
      mrr: active.reduce((sum, club) => sum + Number(club.plan?.price || 49.9), 0),
      receivedThisMonth: payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/master/clubs', requireMaster, async (_req, res, next) => {
  try {
    const clubs = await Club.find().sort({ createdAt: -1 })
    for (const club of clubs) await refreshClubStatus(club)
    res.json(clubs.map(publicClub))
  } catch (error) {
    next(error)
  }
})

app.get('/api/master/clubs/:id/details', requireMaster, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.params.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    await refreshClubStatus(club)

    const [payments, logs] = await Promise.all([
      Payment.find({ clubId: club.id }).sort({ paidAt: -1, createdAt: -1 }).limit(100).lean(),
      AuditLog.find({ clubId: club.id }).sort({ createdAt: -1 }).limit(100).lean(),
    ])

    const paidPayments = payments.filter((item) => item.status === 'paid')
    const totalPaid = paidPayments.reduce((sum, item) => sum + Number(item.amount || 0), 0)

    res.json({
      club: publicClub(club),
      financial: {
        paymentsCount: paidPayments.length,
        totalPaid,
        lastPayment: paidPayments[0] || null,
      },
      payments,
      logs,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/master/clubs', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const input = validateClubInput(req.body)
    const licenseKey = generateLicenseKey()
    const id = randomId('CLB')

    let slug = slugify(input.establishmentName) || id.toLowerCase()
    if (await Club.exists({ slug })) slug += '-' + crypto.randomBytes(2).toString('hex')

    const club = await Club.create({
      id,
      slug,
      establishmentName: input.establishmentName,
      ownerName: input.ownerName,
      cpfCnpj: input.cpfCnpj || '',
      phone: input.phone,
      email: input.email || '',
      city: input.city || '',
      state: input.state || '',
      plan: { name: 'EspaçoOn', price: 49.9 },
      billing: {
        dueDay: input.dueDay,
        nextDueDate: nextDueDateFromDay(input.dueDay),
        status: 'active',
      },
      system: { status: 'active' },
      licenseKeyHash: hashLicense(licenseKey),
    })

    await logAction('club.created', 'Novo cliente cadastrado no EspaçoOn Master.', club)
    res.status(201).json({ club: publicClub(club), licenseKey })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/master/clubs/:id', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.params.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    const input = validateClubInput(req.body, true)
    for (const key of ['establishmentName', 'ownerName', 'cpfCnpj', 'phone', 'email', 'city', 'state']) {
      if (input[key] !== undefined) club[key] = input[key]
    }

    if (input.dueDay !== undefined) {
      club.billing.dueDay = input.dueDay
      if (!club.billing.nextDueDate) club.billing.nextDueDate = nextDueDateFromDay(input.dueDay)
    }

    await club.save()
    await logAction('club.updated', 'Cadastro do cliente atualizado.', club)
    res.json(publicClub(club))
  } catch (error) {
    next(error)
  }
})

app.post('/api/master/clubs/:id/status', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.params.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    const status = text(req.body?.systemStatus, 20)
    if (!['active', 'suspended', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido.' })
    }

    club.system.status = status
    if (status === 'active') {
      club.system.temporaryUnlockUntil = null
      if (club.billing.status === 'suspended') club.billing.status = 'past_due'
    }
    if (status === 'cancelled') club.billing.status = 'cancelled'

    await club.save()
    await logAction(
      'club.status_changed',
      status === 'active' ? 'Sistema liberado manualmente.' : status === 'suspended' ? 'Sistema bloqueado manualmente.' : 'Cliente cancelado.',
      club,
      { reason: text(req.body?.reason, 300) },
    )
    res.json(publicClub(club))
  } catch (error) {
    next(error)
  }
})

app.post('/api/master/clubs/:id/temporary-unlock', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.params.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    const hours = Number(req.body?.hours || 24)
    if (![6, 12, 24, 48].includes(hours)) {
      return res.status(400).json({ error: 'Período de liberação inválido.' })
    }

    club.system.temporaryUnlockUntil = new Date(Date.now() + hours * 60 * 60 * 1000)
    await club.save()
    await logAction('club.temporary_unlock', 'Liberação temporária concedida por ' + hours + ' horas.', club)
    res.json(publicClub(club))
  } catch (error) {
    next(error)
  }
})

app.post('/api/master/clubs/:id/mark-paid', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.params.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    const amount = Number(req.body?.paidAmount)
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) {
      return res.status(400).json({ error: 'Valor de pagamento inválido.' })
    }

    const now = new Date()
    const currentDue = club.billing.nextDueDate ? new Date(club.billing.nextDueDate) : now
    const cycleStart = currentDue > now ? currentDue : now
    const cycleEnd = nextDueDateFromDay(club.billing.dueDay, addDays(cycleStart, 1))

    await Payment.create({
      id: randomId('PAY'),
      clubId: club.id,
      amount: Math.round(amount * 100) / 100,
      status: 'paid',
      provider: 'manual',
      paidAt: now,
      cycleStart,
      cycleEnd,
    })

    club.billing.status = 'active'
    club.billing.lastPaidAt = now
    club.billing.nextDueDate = cycleEnd
    club.billing.graceUntil = null
    club.system.status = 'active'
    club.system.temporaryUnlockUntil = null
    await club.save()

    await logAction('billing.payment_registered', 'Mensalidade registrada como paga.', club, { amount })
    res.json(publicClub(club))
  } catch (error) {
    next(error)
  }
})

app.post('/api/master/clubs/:id/rotate-license', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.params.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    const licenseKey = generateLicenseKey()
    club.licenseKeyHash = hashLicense(licenseKey)
    await club.save()
    await logAction('club.license_rotated', 'Chave de licença regenerada.', club)
    res.json({ club: publicClub(club), licenseKey })
  } catch (error) {
    next(error)
  }
})

app.get('/api/license/billing', authenticateClubLicense, async (req, res, next) => {
  try {
    const club = await refreshClubStatus(req.club)
    res.json({
      amount: 49.9,
      billingStatus: club.billing.status,
      nextDueDate: club.billing.nextDueDate,
      canGeneratePix: Boolean(club.cpfCnpj),
      cpfCnpjConfigured: Boolean(club.cpfCnpj),
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/license/billing/pix', authenticateClubLicense, writeLimiter, async (req, res, next) => {
  try {
    const club = await refreshClubStatus(req.club)
    const pix = await getPixForClub(club)
    await logAction('billing.pix_requested', 'QR Code da mensalidade solicitado pelo sistema do clube.', club, {
      paymentId: pix.paymentId,
    })
    res.json(pix)
  } catch (error) {
    next(error)
  }
})

app.post('/api/webhooks/asaas', async (req, res, next) => {
  try {
    if (!ASAAS_WEBHOOK_TOKEN || !secureEqual(req.get('asaas-access-token') || '', ASAAS_WEBHOOK_TOKEN)) {
      return res.status(401).json({ error: 'Webhook não autorizado.' })
    }

    const eventId = text(req.body?.id, 120)
    const event = text(req.body?.event, 80)
    const payment = req.body?.payment || {}

    if (!eventId || !event) return res.status(400).json({ error: 'Evento inválido.' })
    if (await WebhookEvent.exists({ id: eventId })) return res.json({ received: true, duplicate: true })

    await WebhookEvent.create({ id: eventId, event })

    const club = await Club.findOne({
      $or: [
        ...(payment.subscription ? [{ 'billing.asaasSubscriptionId': payment.subscription }] : []),
        ...(payment.customer ? [{ 'billing.asaasCustomerId': payment.customer }] : []),
        ...(payment.externalReference ? [{ id: payment.externalReference }] : []),
      ],
    })

    if (club) {
      if (['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].includes(event)) {
        const amount = Number(payment.value || 49.9)
        const paidAt = new Date()
        const paymentRecordId = 'ASAAS-' + String(payment.id || eventId)

        await Payment.updateOne(
          { id: paymentRecordId },
          {
            $setOnInsert: {
              id: paymentRecordId,
              clubId: club.id,
              amount,
              status: 'paid',
              provider: 'asaas',
              paidAt,
              cycleStart: payment.dueDate ? new Date(payment.dueDate + 'T12:00:00') : paidAt,
              cycleEnd: nextDueDateFromDay(club.billing.dueDay, addDays(paidAt, 1)),
            },
          },
          { upsert: true },
        )

        club.billing.status = 'active'
        club.billing.lastPaidAt = paidAt
        club.billing.nextDueDate = nextDueDateFromDay(club.billing.dueDay, addDays(paidAt, 1))
        club.billing.graceUntil = null
        club.system.status = 'active'
        club.system.temporaryUnlockUntil = null
        club.billing.currentPaymentId = payment.id || club.billing.currentPaymentId
        await club.save()

        await logAction('billing.payment_confirmed', 'Pagamento Asaas confirmado e sistema liberado automaticamente.', club, {
          paymentId: payment.id,
          event,
          amount,
        })
      }

      if (event === 'PAYMENT_OVERDUE') {
        club.billing.status = 'past_due'
        if (payment.dueDate) club.billing.nextDueDate = new Date(payment.dueDate + 'T12:00:00')
        await club.save()
        await logAction('billing.payment_overdue', 'Mensalidade marcada como vencida pelo Asaas.', club, {
          paymentId: payment.id,
        })
      }

      if (['PAYMENT_REFUNDED', 'PAYMENT_DELETED'].includes(event)) {
        club.billing.status = 'past_due'
        await club.save()
        await logAction('billing.payment_reversed', 'Pagamento Asaas revertido ou removido.', club, {
          paymentId: payment.id,
          event,
        })
      }
    }

    res.json({ received: true })
  } catch (error) {
    next(error)
  }
})

app.get('/api/master/logs', requireMaster, async (_req, res, next) => {
  try {
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(200).lean()
    res.json(logs)
  } catch (error) {
    next(error)
  }
})

app.get('/api/license/status', publicLicenseLimiter, async (req, res, next) => {
  try {
    const clubId = text(req.get('x-club-id'), 60)
    const licenseKey = text(req.get('x-license-key'), 200)

    if (!clubId || !licenseKey) {
      return res.status(401).json({ ok: false, active: false, error: 'Credenciais ausentes.' })
    }

    const club = await Club.findOne({ id: clubId })
    if (!club || !secureEqual(club.licenseKeyHash, hashLicense(licenseKey))) {
      return res.status(401).json({ ok: false, active: false, error: 'Licença inválida.' })
    }

    await refreshClubStatus(club)
    club.system.lastSeen = new Date()
    await club.save()

    res.json({
      ok: true,
      active: effectiveAccess(club),
      status: club.system.status,
      billingStatus: club.billing.status,
      nextDueDate: club.billing.nextDueDate,
      temporaryUnlockUntil: club.system.temporaryUnlockUntil,
      club: {
        id: club.id,
        slug: club.slug,
        establishmentName: club.establishmentName,
      },
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  })
})

app.use((error, _req, res, _next) => {
  console.error(error)
  const status = Number(error?.statusCode) || 500
  res.status(status).json({
    error: status >= 500 ? 'Erro interno do servidor.' : error.message,
  })
})

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' })
})

app.use(express.static(path.join(rootDir, 'dist')))
app.use((_req, res) => {
  res.sendFile(path.join(rootDir, 'dist', 'index.html'))
})

function validateConfig() {
  const missing = []
  if (!MONGODB_URI) missing.push('MONGODB_URI')
  if (!MASTER_PASSWORD || MASTER_PASSWORD.length < 10) missing.push('MASTER_PASSWORD (mínimo 10 caracteres)')
  if (!JWT_SECRET || JWT_SECRET.length < 32) missing.push('JWT_SECRET (mínimo 32 caracteres)')
  if (missing.length) throw new Error('Configuração obrigatória ausente: ' + missing.join(', '))
}

async function start() {
  try {
    validateConfig()
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10,
    })
    console.log('EspaçoOn Master conectado ao MongoDB.')
    app.listen(PORT, '0.0.0.0', () => {
      console.log('EspaçoOn Master rodando na porta ' + PORT)
    })
  } catch (error) {
    console.error('Falha ao iniciar EspaçoOn Master:', error?.message || error)
    process.exit(1)
  }
}

async function shutdown(signal) {
  console.log(signal + ' recebido. Encerrando...')
  try {
    await mongoose.connection.close()
  } finally {
    process.exit(0)
  }
}

process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))

start()
