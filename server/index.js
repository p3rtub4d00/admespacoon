import { installRegistrationInvites } from './registration-invites.js'
import { demoEventRecord, demoAnalyticsSummary, demoLocationSummary, analyticsDay, daysBefore } from './demo-analytics.js'
import { parseDueDate, nextDueDateFromDay, requireCurrentOrFutureDate } from './billing-dates.js'
import { buildPrivacyPolicy, sanitizePrivacyConfig } from './privacy.js'
import { normalizeSystemUrl, adminPanelUrl, parseSetupReport, provisioningSummary } from './provisioning.js'
import express from 'express'
import mongoose from 'mongoose'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import crypto from 'crypto'
import webpush from 'web-push'
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

const BACKUP_MONGODB_URI = String(process.env.BACKUP_MONGODB_URI || '').trim()
const BACKUP_RETENTION_DAYS = Math.max(3, Math.min(90, Number(process.env.BACKUP_RETENTION_DAYS || 14)))
const BACKUP_INTERVAL_HOURS = Math.max(6, Math.min(168, Number(process.env.BACKUP_INTERVAL_HOURS || 24)))
const BACKUP_SOURCE_ID = String(process.env.BACKUP_SOURCE_ID || 'clubeon-master').trim()
const ASAAS_API_KEY = String(process.env.ASAAS_API_KEY || '').trim()
const ASAAS_ENV = String(process.env.ASAAS_ENV || 'production').toLowerCase()
const ASAAS_WEBHOOK_TOKEN = String(process.env.ASAAS_WEBHOOK_TOKEN || '').trim()
const ASAAS_BASE_URL = ASAAS_ENV === 'sandbox'
  ? 'https://api-sandbox.asaas.com/v3'
  : 'https://api.asaas.com/v3'

const MERCADOPAGO_CLIENT_ID = String(process.env.MERCADOPAGO_CLIENT_ID || '').trim()
const MERCADOPAGO_CLIENT_SECRET = String(process.env.MERCADOPAGO_CLIENT_SECRET || '').trim()
const MERCADOPAGO_REDIRECT_URI = String(process.env.MERCADOPAGO_REDIRECT_URI || '').trim()
const MERCADOPAGO_TOKEN_ENCRYPTION_KEY = String(process.env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY || '').trim()
const MERCADOPAGO_WEBHOOK_SECRET = String(process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim()

const WHATSAPP_VERIFY_TOKEN = String(process.env.WHATSAPP_VERIFY_TOKEN || '').trim()
const WHATSAPP_APP_SECRET = String(process.env.WHATSAPP_APP_SECRET || '').trim()

const MERCADOPAGO_OAUTH_CONFIGURED = Boolean(
  MERCADOPAGO_CLIENT_ID &&
  MERCADOPAGO_CLIENT_SECRET &&
  MERCADOPAGO_REDIRECT_URI &&
  MERCADOPAGO_TOKEN_ENCRYPTION_KEY
)

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
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buffer) => {
    req.rawBody = Buffer.from(buffer)
  },
}))
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
  deletedAt: { type: Date, default: null, index: true },
  demoMode: { type: Boolean, default: false, index: true },
  reservationPaymentProvider: {
    type: String,
    enum: ['asaas', 'mercadopago'],
    default: 'asaas',
    index: true,
  },
  payments: {
    mercadoPago: {
      userId: String,
      publicKey: String,
      accessTokenEncrypted: String,
      refreshTokenEncrypted: String,
      scope: String,
      liveMode: Boolean,
      expiresAt: Date,
      connectedAt: Date,
      updatedAt: Date,
    },
  },
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
    publicUrl: { type: String, default: '' },
    lastSeen: Date,
    temporaryUnlockUntil: Date,
  },
  provisioning: {
    establishmentConfigured: Boolean,
    pricesConfigured: Boolean,
    asaasConfigured: Boolean,
    privacyConfigured: Boolean,
    reportedAt: Date,
  },
  adminAuth: {
    passwordHash: String,
    passwordSalt: String,
    passwordSetAt: Date,
    firstAccessCompleted: { type: Boolean, default: false },
  },
  licenseKeyHash: { type: String, required: true },
}, { timestamps: true })

// Excluded clubs remain only as history; all ordinary lookups (including licensing
// and provider callbacks) must ignore them.
clubSchema.pre(/^find/, function () {
  if (this.getOptions().includeDeleted === true) {
    delete this.options.includeDeleted
    return
  }
  this.where({ deletedAt: null })
})

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

const adminAccessTokenSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true, index: true },
  clubId: { type: String, required: true, index: true },
  purpose: { type: String, enum: ['first-access', 'reset'], required: true },
  expiresAt: { type: Date, required: true, index: true },
  usedAt: Date,
}, { timestamps: true })

const Club = mongoose.model('Club', clubSchema)
const Payment = mongoose.model('MasterPayment', paymentSchema)
const AuditLog = mongoose.model('AuditLog', auditLogSchema)
const AdminAccessToken = mongoose.model('AdminAccessToken', adminAccessTokenSchema)

const webhookEventSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  event: String,
  processedAt: { type: Date, default: Date.now },
}, { timestamps: true })

const WebhookEvent = mongoose.model('MasterWebhookEvent', webhookEventSchema)

const mercadoPagoOrderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true, index: true },
  clubId: { type: String, required: true, index: true },
  externalReference: { type: String, index: true },
  paymentId: String,
  status: String,
  statusDetail: String,
  liveMode: Boolean,
  lastEventId: String,
  lastWebhookAt: Date,
}, { timestamps: true })

const MercadoPagoOrder = mongoose.model('MasterMercadoPagoOrder', mercadoPagoOrderSchema)

const mercadoPagoOAuthAttemptSchema = new mongoose.Schema({
  stateHash: { type: String, required: true, unique: true, index: true },
  clubId: { type: String, required: true, index: true },
  verifierEncrypted: { type: String, required: true },
  returnUrl: String,
  expiresAt: { type: Date, required: true, expires: 0 },
}, { timestamps: true })

const MercadoPagoOAuthAttempt = mongoose.model('MercadoPagoOAuthAttempt', mercadoPagoOAuthAttemptSchema)

const pushConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'main', unique: true },
  publicKey: { type: String, required: true },
  privateKey: { type: String, required: true },
}, { timestamps: true })

const pushSubscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, required: true, unique: true, index: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
  },
  userAgent: String,
  enabled: { type: Boolean, default: true },
  lastSuccessAt: Date,
  lastErrorAt: Date,
}, { timestamps: true })

const PushConfig = mongoose.model('MasterPushConfig', pushConfigSchema)
const PushSubscription = mongoose.model('MasterPushSubscription', pushSubscriptionSchema)


const masterSettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'main' },
  planName: { type: String, default: 'EspaçoOn' },
  planPrice: { type: Number, default: 49.9 },
  privacy: { controllerName: String, contactEmail: String, contactPhone: String },
}, { timestamps: true })

const MasterSettings = mongoose.model('MasterSettings', masterSettingsSchema)

const demoEventSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  clubId: { type: String, required: true },
  type: { type: String, required: true },
  day: { type: String, required: true },
  eventKey: { type: String, required: true },
  location: { city: String, region: String, country: String, countryCode: String },
  createdAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
})
demoEventSchema.index({ clubId: 1, day: 1 })
demoEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
const DemoEvent = mongoose.model('DemoEvent', demoEventSchema)


async function getMasterSettings() {
  let settings = await MasterSettings.findOne({ key: 'main' })
  if (!settings) {
    settings = await MasterSettings.create({
      key: 'main',
      planName: 'EspaçoOn',
      planPrice: 49.9,
    })
  }
  return settings
}

let backupConnection = null
let backupTimer = null
let backupState = {
  configured: Boolean(BACKUP_MONGODB_URI),
  running: false,
  lastStartedAt: null,
  lastCompletedAt: null,
  lastSnapshotId: null,
  lastError: null,
}

async function ensureBackupConnection() {
  if (!BACKUP_MONGODB_URI) return null
  if (BACKUP_MONGODB_URI === String(MONGODB_URI || '').trim()) {
    throw new Error('BACKUP_MONGODB_URI deve apontar para um banco diferente do banco principal.')
  }
  if (backupConnection?.readyState === 1) return backupConnection

  if (backupConnection) {
    await backupConnection.close().catch(() => {})
  }

  backupConnection = mongoose.createConnection(BACKUP_MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    maxPoolSize: 3,
  })
  await backupConnection.asPromise()
  return backupConnection
}

function backupSnapshotId() {
  return [
    BACKUP_SOURCE_ID.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60),
    new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14),
    crypto.randomBytes(3).toString('hex'),
  ].join('-')
}

async function latestBackupSnapshot() {
  const connection = await ensureBackupConnection()
  if (!connection) return null

  return connection.db
    .collection('clubeon_backup_snapshots')
    .find({ sourceId: BACKUP_SOURCE_ID, status: 'completed' })
    .sort({ completedAt: -1 })
    .limit(1)
    .next()
}

async function cleanupExpiredBackups() {
  const connection = await ensureBackupConnection()
  if (!connection) return

  const cutoff = new Date(Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const expired = await connection.db
    .collection('clubeon_backup_snapshots')
    .find({
      sourceId: BACKUP_SOURCE_ID,
      completedAt: { $lt: cutoff },
    })
    .project({ snapshotId: 1 })
    .toArray()

  const snapshotIds = expired.map((item) => item.snapshotId).filter(Boolean)
  if (!snapshotIds.length) return

  await Promise.all([
    connection.db.collection('clubeon_backup_documents').deleteMany({
      sourceId: BACKUP_SOURCE_ID,
      snapshotId: { $in: snapshotIds },
    }),
    connection.db.collection('clubeon_backup_snapshots').deleteMany({
      sourceId: BACKUP_SOURCE_ID,
      snapshotId: { $in: snapshotIds },
    }),
  ])
}

async function runDatabaseBackup({ force = false, reason = 'scheduled' } = {}) {
  if (!BACKUP_MONGODB_URI) return { configured: false, skipped: true }
  if (backupState.running) return { configured: true, skipped: true, reason: 'already-running' }

  const connection = await ensureBackupConnection()
  const latest = await latestBackupSnapshot()
  const minAgeMs = BACKUP_INTERVAL_HOURS * 60 * 60 * 1000

  if (
    !force &&
    latest?.completedAt &&
    Date.now() - new Date(latest.completedAt).getTime() < minAgeMs
  ) {
    backupState.lastCompletedAt = latest.completedAt
    backupState.lastSnapshotId = latest.snapshotId || null
    backupState.lastError = null
    return { configured: true, skipped: true, reason: 'recent-backup', snapshotId: latest.snapshotId }
  }

  const snapshotId = backupSnapshotId()
  const startedAt = new Date()
  backupState = {
    ...backupState,
    configured: true,
    running: true,
    lastStartedAt: startedAt,
    lastError: null,
  }

  const snapshotCollection = connection.db.collection('clubeon_backup_snapshots')
  const documentCollection = connection.db.collection('clubeon_backup_documents')

  await snapshotCollection.insertOne({
    snapshotId,
    sourceId: BACKUP_SOURCE_ID,
    reason,
    status: 'running',
    startedAt,
    collections: [],
  })

  try {
    const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()
    const summary = []

    for (const { name } of collections) {
      if (!name || name.startsWith('system.')) continue

      const cursor = mongoose.connection.db.collection(name).find({})
      let count = 0
      let batch = []

      for await (const document of cursor) {
        batch.push({
          sourceId: BACKUP_SOURCE_ID,
          snapshotId,
          collection: name,
          document,
        })
        count += 1

        if (batch.length >= 250) {
          await documentCollection.insertMany(batch, { ordered: false })
          batch = []
        }
      }

      if (batch.length) {
        await documentCollection.insertMany(batch, { ordered: false })
      }

      const indexes = await mongoose.connection.db.collection(name).indexes().catch(() => [])
      summary.push({
        name,
        count,
        indexes: indexes.map(({ v, ns, ...index }) => index),
      })
    }

    const completedAt = new Date()
    await snapshotCollection.updateOne(
      { snapshotId, sourceId: BACKUP_SOURCE_ID },
      {
        $set: {
          status: 'completed',
          completedAt,
          collections: summary,
        },
      },
    )

    backupState = {
      ...backupState,
      running: false,
      lastCompletedAt: completedAt,
      lastSnapshotId: snapshotId,
      lastError: null,
    }

    await cleanupExpiredBackups()
    console.log('Backup MongoDB concluído:', snapshotId)
    return { configured: true, snapshotId, completedAt, collections: summary }
  } catch (error) {
    const failedAt = new Date()
    backupState = {
      ...backupState,
      running: false,
      lastError: String(error?.message || error),
    }

    await snapshotCollection.updateOne(
      { snapshotId, sourceId: BACKUP_SOURCE_ID },
      {
        $set: {
          status: 'failed',
          failedAt,
          error: String(error?.message || error).slice(0, 500),
        },
      },
    ).catch(() => {})

    throw error
  }
}

function startDatabaseBackupScheduler() {
  if (!BACKUP_MONGODB_URI || backupTimer) return

  const run = () => {
    runDatabaseBackup({ reason: 'automatic' }).catch((error) => {
      console.error('Falha no backup automático do MongoDB:', error?.message || error)
    })
  }

  setTimeout(run, 30_000)
  backupTimer = setInterval(run, Math.max(60 * 60 * 1000, BACKUP_INTERVAL_HOURS * 60 * 60 * 1000))
}

async function currentPlanPrice() {
  const settings = await getMasterSettings()
  return Number(settings.planPrice || 49.9)
}


async function ensurePushConfig() {
  let config = await PushConfig.findOne({ key: 'main' }).lean()

  if (!config) {
    const keys = webpush.generateVAPIDKeys()
    const created = await PushConfig.create({
      key: 'main',
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
    })
    config = created.toObject()
  }

  webpush.setVapidDetails(
    'mailto:admin@espacoon.app',
    config.publicKey,
    config.privateKey,
  )

  return config
}

async function sendPushNotification(payload, endpoint = null) {
  await ensurePushConfig()

  const query = endpoint ? { endpoint, enabled: true } : { enabled: true }
  const subscriptions = await PushSubscription.find(query).lean()
  let sent = 0
  let failed = 0

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        },
        JSON.stringify(payload),
      )

      sent += 1
      await PushSubscription.updateOne(
        { endpoint: subscription.endpoint },
        {
          $set: { lastSuccessAt: new Date(), enabled: true },
          $unset: { lastErrorAt: 1 },
        },
      )
    } catch (error) {
      failed += 1
      const statusCode = Number(error?.statusCode)

      if (statusCode === 404 || statusCode === 410) {
        await PushSubscription.deleteOne({ endpoint: subscription.endpoint })
      } else {
        await PushSubscription.updateOne(
          { endpoint: subscription.endpoint },
          { $set: { lastErrorAt: new Date() } },
        )
      }

      console.warn('Falha ao enviar Web Push do Master:', statusCode || error?.message || error)
    }
  }

  return { sent, failed }
}

function notifyMaster(payload) {
  sendPushNotification({
    url: '/',
    ...payload,
  }).catch((error) => {
    console.warn('Falha ao disparar notificação do Master:', error?.message || error)
  })
}

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

function hashAccessToken(tokenValue) {
  return crypto.createHash('sha256').update(String(tokenValue)).digest('hex')
}

function deriveAdminPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), String(salt), 64, (error, derivedKey) => {
      if (error) return reject(error)
      resolve(derivedKey.toString('hex'))
    })
  })
}

async function createAdminPasswordRecord(password) {
  const value = String(password || '')
  if (value.length < 8 || value.length > 200) {
    throw Object.assign(new Error('A senha deve ter entre 8 e 200 caracteres.'), { statusCode: 400 })
  }
  const salt = crypto.randomBytes(16).toString('hex')
  return {
    passwordSalt: salt,
    passwordHash: await deriveAdminPassword(value, salt),
  }
}

async function verifyClubAdminPassword(club, password) {
  if (!club?.adminAuth?.passwordHash || !club?.adminAuth?.passwordSalt) return false
  const candidate = await deriveAdminPassword(password, club.adminAuth.passwordSalt)
  return secureEqual(candidate, club.adminAuth.passwordHash)
}

function generateLicenseKey() {
  return crypto.randomBytes(32).toString('base64url')
}

function encryptionKey() {
  if (!MERCADOPAGO_TOKEN_ENCRYPTION_KEY) {
    throw Object.assign(new Error('Criptografia do Mercado Pago não configurada.'), { statusCode: 503 })
  }
  return crypto.createHash('sha256').update(MERCADOPAGO_TOKEN_ENCRYPTION_KEY).digest()
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, encrypted].map((item) => item.toString('base64url')).join('.')
}

function decryptSecret(payload) {
  const [ivPart, tagPart, dataPart] = String(payload || '').split('.')
  if (!ivPart || !tagPart || !dataPart) throw new Error('Segredo criptografado inválido.')
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivPart, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}

function sha256Base64Url(value) {
  return crypto.createHash('sha256').update(String(value)).digest('base64url')
}

function mercadoPagoConnectionInfo(club) {
  const mp = club?.payments?.mercadoPago || {}
  return {
    platformConfigured: MERCADOPAGO_OAUTH_CONFIGURED,
    connected: Boolean(mp.userId && mp.accessTokenEncrypted),
    userId: mp.userId || null,
    publicKey: mp.publicKey || null,
    scope: mp.scope || null,
    liveMode: mp.liveMode === true,
    expiresAt: mp.expiresAt || null,
    connectedAt: mp.connectedAt || null,
    updatedAt: mp.updatedAt || null,
  }
}

function safeReturnUrl(value = '') {
  try {
    const parsed = new URL(String(value || ''))
    if (parsed.protocol !== 'https:') return ''
    if (parsed.username || parsed.password) return ''
    return parsed.origin + (parsed.pathname || '/') + (parsed.search || '')
  } catch {
    return ''
  }
}

async function createMercadoPagoAuthorization(club, returnUrl = '') {
  if (!MERCADOPAGO_OAUTH_CONFIGURED) {
    throw Object.assign(new Error('OAuth do Mercado Pago ainda não está configurado no Master.'), { statusCode: 503 })
  }

  const state = crypto.randomBytes(32).toString('base64url')
  const verifier = crypto.randomBytes(48).toString('base64url')
  const challenge = sha256Base64Url(verifier)

  await MercadoPagoOAuthAttempt.deleteMany({ clubId: club.id })
  await MercadoPagoOAuthAttempt.create({
    stateHash: sha256Base64Url(state),
    clubId: club.id,
    verifierEncrypted: encryptSecret(verifier),
    returnUrl: safeReturnUrl(returnUrl),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: MERCADOPAGO_CLIENT_ID,
    platform_id: 'mp',
    redirect_uri: MERCADOPAGO_REDIRECT_URI,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  // Para contas brasileiras, usamos o endpoint regional documentado para Marketplace/OAuth.
  // Isso também evita inconsistências de redirecionamento em navegadores móveis.
  return 'https://auth.mercadopago.com.br/authorization?' + params.toString()
}

async function disconnectMercadoPagoForClub(club) {
  club.payments = club.payments || {}
  club.payments.mercadoPago = {
    userId: '',
    publicKey: '',
    accessTokenEncrypted: '',
    refreshTokenEncrypted: '',
    scope: '',
    liveMode: false,
    expiresAt: null,
    connectedAt: null,
    updatedAt: new Date(),
  }
  await club.save()
  return club
}

async function ensureFreshMercadoPagoAccessToken(club) {
  const mp = club?.payments?.mercadoPago || {}
  if (!mp.accessTokenEncrypted) {
    throw Object.assign(new Error('Conta Mercado Pago ainda não conectada.'), { statusCode: 409 })
  }

  const expiresAt = mp.expiresAt ? new Date(mp.expiresAt) : null
  const shouldRefresh = Boolean(
    expiresAt &&
    Number.isFinite(expiresAt.getTime()) &&
    expiresAt.getTime() - Date.now() < 10 * 60 * 1000
  )

  if (!shouldRefresh) {
    return decryptSecret(mp.accessTokenEncrypted)
  }

  if (!mp.refreshTokenEncrypted) {
    throw Object.assign(new Error('A autorização do Mercado Pago expirou. Reconecte a conta.'), { statusCode: 409 })
  }

  const refreshed = await mercadoPagoTokenRequest({
    client_id: MERCADOPAGO_CLIENT_ID,
    client_secret: MERCADOPAGO_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: decryptSecret(mp.refreshTokenEncrypted),
  })

  if (!refreshed?.access_token) {
    throw Object.assign(new Error('Não foi possível renovar o acesso ao Mercado Pago.'), { statusCode: 502 })
  }

  const now = new Date()
  const expiresIn = Number(refreshed.expires_in || 0)
  club.payments = club.payments || {}
  club.payments.mercadoPago = {
    userId: String(refreshed.user_id || mp.userId || ''),
    publicKey: refreshed.public_key || mp.publicKey || '',
    accessTokenEncrypted: encryptSecret(refreshed.access_token),
    refreshTokenEncrypted: refreshed.refresh_token
      ? encryptSecret(refreshed.refresh_token)
      : mp.refreshTokenEncrypted,
    scope: refreshed.scope || mp.scope || '',
    liveMode: refreshed.live_mode === true || mp.liveMode === true,
    expiresAt: expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000) : mp.expiresAt || null,
    connectedAt: mp.connectedAt || now,
    updatedAt: now,
  }
  await club.save()

  return refreshed.access_token
}

async function mercadoPagoApiRequest(club, pathname, options = {}) {
  const accessToken = await ensureFreshMercadoPagoAccessToken(club)

  const response = await fetch('https://api.mercadopago.com' + pathname, {
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: 'Bearer ' + accessToken,
      ...(options.idempotencyKey ? { 'x-idempotency-key': options.idempotencyKey } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      data?.cause?.[0]?.description ||
      data?.cause?.[0]?.code ||
      'Erro na API do Mercado Pago.'
    throw Object.assign(new Error(String(message)), {
      statusCode: response.status >= 500 ? 502 : response.status,
      mercadoPagoResponse: data,
    })
  }

  return data
}

function stableUuid(value) {
  const hex = crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32)
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    'a' + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-')
}

function validateWhatsAppWebhookSignature(req) {
  if (!WHATSAPP_APP_SECRET || !req.rawBody) return false

  const signature = String(req.get('x-hub-signature-256') || '')
  if (!signature.startsWith('sha256=')) return false

  const receivedHash = signature.slice('sha256='.length)
  const expectedHash = crypto
    .createHmac('sha256', WHATSAPP_APP_SECRET)
    .update(req.rawBody)
    .digest('hex')

  const a = Buffer.from(expectedHash, 'utf8')
  const b = Buffer.from(receivedHash, 'utf8')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function validateMercadoPagoWebhookSignature(req) {
  if (!MERCADOPAGO_WEBHOOK_SECRET) return false

  const xSignature = String(req.get('x-signature') || '')
  const xRequestId = String(req.get('x-request-id') || '')
  const rawDataId = String(req.query?.['data.id'] || req.body?.data?.id || '')
  const dataId = rawDataId.toLowerCase()

  let ts = ''
  let receivedHash = ''
  for (const part of xSignature.split(',')) {
    const [key, ...rest] = part.split('=')
    const value = rest.join('=').trim()
    if (key?.trim() === 'ts') ts = value
    if (key?.trim() === 'v1') receivedHash = value
  }

  if (!ts || !receivedHash || !xRequestId || !dataId) return false

  const manifest = 'id:' + dataId + ';request-id:' + xRequestId + ';ts:' + ts + ';'
  const expectedHash = crypto
    .createHmac('sha256', MERCADOPAGO_WEBHOOK_SECRET)
    .update(manifest)
    .digest('hex')

  const a = Buffer.from(expectedHash, 'utf8')
  const b = Buffer.from(receivedHash, 'utf8')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

async function cacheMercadoPagoOrder(club, order, metadata = {}) {
  const payment = order?.transactions?.payments?.[0] || {}
  const orderId = String(order?.id || metadata.orderId || '')
  if (!orderId) return null

  return MercadoPagoOrder.findOneAndUpdate(
    { orderId },
    {
      $set: {
        clubId: club.id,
        externalReference: order?.external_reference || metadata.externalReference || '',
        paymentId: payment?.id || null,
        status: order?.status || payment?.status || null,
        statusDetail: order?.status_detail || payment?.status_detail || null,
        liveMode: metadata.liveMode === true,
        lastEventId: metadata.eventId || null,
        lastWebhookAt: metadata.fromWebhook ? new Date() : null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean()
}

async function mercadoPagoTokenRequest(body) {
  const response = await fetch('https://api.mercadopago.com/oauth/token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message =
      data?.message ||
      data?.error_description ||
      data?.error ||
      'Não foi possível concluir a autorização do Mercado Pago.'
    throw Object.assign(new Error(message), { statusCode: 502 })
  }
  return data
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
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
    throw Object.assign(new Error(message), { statusCode: response.status >= 500 ? 502 : 400, providerStatus: response.status })
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
  if (club.demoMode) throw Object.assign(new Error('Demonstração não permite assinatura real.'), { statusCode: 409 })
  if (club.billing?.asaasSubscriptionId) return club.billing.asaasSubscriptionId

  const customerId = await ensureAsaasCustomer(club)
  const planPrice = await currentPlanPrice()
  const now = new Date()
  const configuredDueDate = club.billing?.nextDueDate ? new Date(club.billing.nextDueDate) : now
  const dueDate = configuredDueDate < now ? now : configuredDueDate
  const nextDueDate = dueDate.toISOString().slice(0, 10)

  const subscription = await asaasRequest('/subscriptions', {
    method: 'POST',
    body: {
      customer: customerId,
      billingType: 'PIX',
      nextDueDate,
      value: planPrice,
      cycle: 'MONTHLY',
      description: 'Assinatura mensal EspaçoOn',
      externalReference: club.id,
    },
  })

  club.billing.asaasSubscriptionId = subscription.id
  await club.save()
  await logAction('billing.subscription_created', 'Assinatura mensal criada no Asaas.', club, { subscriptionId: subscription.id })
  notifyMaster({
    title: 'Assinatura Asaas criada',
    body: club.establishmentName + ' foi vinculado à cobrança recorrente.',
    tag: 'master-subscription-' + club.id,
  })
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
  const planPrice = await currentPlanPrice()

  return {
    amount: Number(payment.value || planPrice),
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
  if (club.demoMode === true) {
    await club.save()
    return club
  }

  const now = new Date()
  const dueDate = club.billing?.nextDueDate ? new Date(club.billing.nextDueDate) : null
  const tempUnlock = club.system?.temporaryUnlockUntil ? new Date(club.system.temporaryUnlockUntil) : null

  if (tempUnlock && tempUnlock <= now) {
    club.system.temporaryUnlockUntil = null
  }

  if (dueDate && dueDate < now && club.billing.status === 'active') {
    club.billing.status = 'past_due'
    club.billing.graceUntil = addDays(dueDate, 5)
    notifyMaster({
      title: 'Mensalidade vencida',
      body: club.establishmentName + ' está com a mensalidade vencida.',
      tag: 'master-overdue-' + club.id,
    })
  }

  if (
    club.billing.status === 'past_due' &&
    club.billing.graceUntil &&
    new Date(club.billing.graceUntil) < now &&
    !club.system.temporaryUnlockUntil
  ) {
    club.billing.status = 'suspended'
    club.system.status = 'suspended'
    notifyMaster({
      title: 'Cliente suspenso',
      body: club.establishmentName + ' foi suspenso automaticamente por inadimplência.',
      tag: 'master-suspended-' + club.id,
    })
  }

  await club.save()
  return club
}

function effectiveAccess(club) {
  if (!club) return false
  if (club.system?.status === 'cancelled') return false
  if (club.demoMode === true) return true
  if (club.system?.status === 'active') return true
  const unlock = club.system?.temporaryUnlockUntil
  return Boolean(unlock && new Date(unlock) > new Date())
}

function validateClubInput(body, partial = false) {
  const result = {}
  if (!body || typeof body !== 'object') throw Object.assign(new Error('Cadastro inválido.'), { statusCode: 400 })
  if (body.systemUrl !== undefined) result.systemUrl = normalizeSystemUrl(body.systemUrl)
  if (!partial && body.demoMode !== undefined) {
    if (typeof body.demoMode !== 'boolean') throw Object.assign(new Error('Modo demonstração inválido.'), { statusCode: 400 })
    result.demoMode = body.demoMode
  }

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

  if (body.nextDueDate !== undefined) {
    result.nextDueDate = parseDueDate(body.nextDueDate)
    result.dueDay = result.nextDueDate.getUTCDate()
  } else if (!partial || body.dueDay !== undefined) {
    const dueDay = Number(body.dueDay || 10)
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
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
    demoMode: club.demoMode === true,
    reservationPaymentProvider: club.reservationPaymentProvider || 'asaas',
    plan: club.plan,
    billing: club.billing,
    system: club.system,
    provisioning: provisioningSummary(club, { mercadoPagoConnected: mercadoPagoConnectionInfo(club).connected, active: effectiveAccess(club) }),
    adminPasswordConfigured: Boolean(club.adminAuth?.passwordHash && club.adminAuth?.passwordSalt),
    adminPasswordSetAt: club.adminAuth?.passwordSetAt || null,
    createdAt: club.createdAt,
    updatedAt: club.updatedAt,
  }
}

app.use(['/api/master', '/api/admin-access', '/api/license'], (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})

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

app.get('/api/privacy', async (_req, res, next) => {
  try {
    const settings = await MasterSettings.findOne({ key: 'main' }).lean()
    res.setHeader('Cache-Control', 'no-store')
    res.json(buildPrivacyPolicy({ scope: 'platform', config: settings?.privacy }))
  } catch (error) { next(error) }
})

app.get('/api/master/privacy', requireMaster, async (_req, res, next) => {
  try { res.json(sanitizePrivacyConfig((await getMasterSettings()).privacy)) }
  catch (error) { next(error) }
})

app.put('/api/master/privacy', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const privacy = sanitizePrivacyConfig(req.body)
    if (!privacy.controllerName || (!privacy.contactEmail && !privacy.contactPhone)) {
      return res.status(400).json({ error: 'Informe o responsável e ao menos um canal para solicitações sobre dados pessoais.' })
    }
    await MasterSettings.findOneAndUpdate(
      { key: 'main' }, { $set: { privacy }, $setOnInsert: { key: 'main' } }, { upsert: true, new: true },
    )
    await logAction('settings.privacy_updated', 'Responsável e canal de privacidade atualizados.')
    res.json(privacy)
  } catch (error) { next(error) }
})

app.get('/api/master/settings', requireMaster, async (_req, res, next) => {
  try {
    const settings = await getMasterSettings()
    res.json({
      planName: settings.planName || 'EspaçoOn',
      planPrice: Number(settings.planPrice || 49.9),
    })
  } catch (error) {
    next(error)
  }
})

app.put('/api/master/settings', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const planPrice = Number(req.body?.planPrice)
    if (!Number.isFinite(planPrice) || planPrice < 5 || planPrice > 10000) {
      return res.status(400).json({ error: 'O valor do plano deve ser de no mínimo R$ 5,00.' })
    }

    const roundedPrice = Math.round(planPrice * 100) / 100
    const planName = text(req.body?.planName || 'EspaçoOn', 80) || 'EspaçoOn'

    const clubs = await Club.find()
    const syncFailures = []

    for (const club of clubs) {
      if (ASAAS_API_KEY && club.billing?.asaasSubscriptionId && !club.demoMode) {
        try {
          await asaasRequest('/subscriptions/' + encodeURIComponent(club.billing.asaasSubscriptionId), {
            method: 'PUT',
            body: {
              value: roundedPrice,
              updatePendingPayments: true,
            },
          })
        } catch (syncError) {
          syncFailures.push({
            clubId: club.id,
            clubName: club.establishmentName,
            error: syncError?.message || 'Falha ao atualizar assinatura.',
          })
        }
      }
    }

    if (syncFailures.length) {
      return res.status(409).json({
        error: 'Não foi possível atualizar todas as assinaturas no Asaas. Nenhuma alteração local foi aplicada.',
        syncFailures,
      })
    }

    const settings = await MasterSettings.findOneAndUpdate(
      { key: 'main' },
      { $set: { planName, planPrice: roundedPrice }, $setOnInsert: { key: 'main' } },
      { upsert: true, new: true },
    )

    await Club.updateMany(
      {},
      { $set: { 'plan.name': planName, 'plan.price': roundedPrice } },
    )

    await logAction(
      'settings.plan_updated',
      'Valor do plano mensal atualizado para R$ ' + roundedPrice.toFixed(2).replace('.', ',') + '.',
      null,
      { planPrice: roundedPrice, planName },
    )

    res.json({
      planName: settings.planName,
      planPrice: Number(settings.planPrice),
      syncedSubscriptions: clubs.filter((club) => club.billing?.asaasSubscriptionId).length,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/master/dashboard', requireMaster, async (_req, res, next) => {
  try {
    const [clubs, masterSettings] = await Promise.all([
      Club.find(),
      getMasterSettings(),
    ])
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
      mrr: active.reduce((sum, club) => sum + Number(club.plan?.price || masterSettings.planPrice || 49.9), 0),
      receivedThisMonth: payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
      planPrice: Number(masterSettings.planPrice || 49.9),
      planName: masterSettings.planName || 'EspaçoOn',
    })
  } catch (error) {
    next(error)
  }
})

const demoEventLimiter = rateLimit({ windowMs: 60000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Muitos eventos de demonstração.' } })

app.post('/api/license/demo-events', demoEventLimiter, authenticateClubLicense, async (req, res, next) => {
  try {
    if (req.club.demoMode !== true || req.club.system?.status === 'cancelled') return res.status(403).json({ error: 'Métricas disponíveis somente para demonstração.' })
    const record = demoEventRecord(req.club.id, req.body, JWT_SECRET)
    try {
      await DemoEvent.updateOne(
        { _id: record.eventKey },
        { $setOnInsert: record }, { upsert: true },
      )
    } catch (error) { if (error.code !== 11000) throw error }
    res.json({ ok: true })
  } catch (error) { next(error) }
})

app.get('/api/master/demo-analytics', requireMaster, async (_req, res, next) => {
  try {
    const clubs = await Club.find({ demoMode: true }).lean()
    const ids = clubs.filter(club => club.system?.status !== 'cancelled').map(club => club.id)
    const today = analyticsDay()
    const rows = ids.length ? await DemoEvent.aggregate([
      { $match: { clubId: { $in: ids }, day: { $gte: daysBefore(today, 89), $lte: today }, expiresAt: { $gt: new Date() } } },
      { $group: { _id: { day: '$day', type: '$type', location: { city: '$location.city', region: '$location.region', country: '$location.country', countryCode: '$location.countryCode' } }, count: { $sum: 1 } } },
    ]) : []
    res.json({ ...demoAnalyticsSummary(rows), locations: demoLocationSummary(rows), demoClubs: clubs.filter(club => ids.includes(club.id)).map(club => ({ id: club.id, name: club.establishmentName })) })
  } catch (error) { next(error) }
})

app.get('/api/master/revenue', requireMaster, async (req, res, next) => {
  try {
    const month = text(req.query?.month, 7)
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Mês inválido.' })
    }

    const [year, monthNumber] = month.split('-').map(Number)
    const start = new Date(year, monthNumber - 1, 1)
    const end = new Date(year, monthNumber, 1)

    const [payments, clubs, settings] = await Promise.all([
      Payment.find({
        status: 'paid',
        paidAt: { $gte: start, $lt: end },
      }).sort({ paidAt: -1 }).lean(),
      Club.find().setOptions({ includeDeleted: true }).lean(),
      getMasterSettings(),
    ])

    const clubsById = new Map(clubs.map((club) => [club.id, club]))
    const totalReceived = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
    const paidClubIds = new Set(payments.map((payment) => payment.clubId).filter(Boolean))
    const activeClubs = clubs.filter((club) => !club.deletedAt && club.system?.status !== 'cancelled')
    const potentialRevenue = activeClubs.reduce(
      (sum, club) => sum + Number(club.plan?.price || settings.planPrice || 0),
      0,
    )

    res.json({
      month,
      totalReceived,
      paymentCount: payments.length,
      payingClients: paidClubIds.size,
      averageTicket: payments.length ? totalReceived / payments.length : 0,
      potentialRevenue,
      realizationRate: potentialRevenue > 0 ? (totalReceived / potentialRevenue) * 100 : 0,
      payments: payments.map((payment) => {
        const club = clubsById.get(payment.clubId)
        return {
          id: payment.id,
          clubId: payment.clubId,
          clubName: club?.establishmentName || payment.clubId || 'Cliente',
          ownerName: club?.ownerName || '',
          amount: Number(payment.amount || 0),
          provider: payment.provider,
          paidAt: payment.paidAt,
          cycleStart: payment.cycleStart,
          cycleEnd: payment.cycleEnd,
        }
      }),
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

    let asaas = {
      configured: Boolean(ASAAS_API_KEY),
      customerId: club.billing?.asaasCustomerId || null,
      subscriptionId: club.billing?.asaasSubscriptionId || null,
      subscriptionStatus: null,
      currentPayment: null,
      error: null,
    }

    if (ASAAS_API_KEY && club.billing?.asaasSubscriptionId) {
      try {
        const [subscription, subscriptionPayments] = await Promise.all([
          asaasRequest('/subscriptions/' + encodeURIComponent(club.billing.asaasSubscriptionId)),
          asaasRequest('/subscriptions/' + encodeURIComponent(club.billing.asaasSubscriptionId) + '/payments'),
        ])

        const remotePayments = Array.isArray(subscriptionPayments?.data) ? subscriptionPayments.data : []
        const currentPayment = remotePayments
          .slice()
          .sort((a, b) => String(b.dueDate || '').localeCompare(String(a.dueDate || '')))[0] || null

        asaas = {
          ...asaas,
          subscriptionStatus: subscription?.status || null,
          value: Number(subscription?.value || club.plan?.price || 0),
          billingType: subscription?.billingType || 'PIX',
          nextDueDate: subscription?.nextDueDate || club.billing?.nextDueDate || null,
          currentPayment: currentPayment
            ? {
                id: currentPayment.id,
                value: Number(currentPayment.value || 0),
                status: currentPayment.status,
                dueDate: currentPayment.dueDate,
              }
            : null,
        }
      } catch (asaasError) {
        asaas.error = asaasError?.message || 'Não foi possível consultar a assinatura no Asaas.'
      }
    }

    res.json({
      club: publicClub(club),
      financial: {
        paymentsCount: paidPayments.length,
        totalPaid,
        lastPayment: paidPayments[0] || null,
      },
      asaas,
      mercadopago: mercadoPagoConnectionInfo(club),
      payments,
      logs,
    })
  } catch (error) {
    next(error)
  }
})

const RegistrationInvite = installRegistrationInvites({ app, mongoose, requireMaster, writeLimiter, validateClubInput })

app.post('/api/master/clubs', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    let invitation = null
    if (req.body?.registrationInviteId) {
      if (typeof req.body.registrationInviteId !== 'string' || req.body.registrationInviteId.length > 80) return res.status(400).json({ error: 'Convite inválido.' })
      invitation = await RegistrationInvite.findOne({ id: req.body.registrationInviteId, submittedAt: { $ne: null }, revokedAt: null, approvedAt: null })
      if (!invitation) return res.status(409).json({ error: 'Cadastro já concluído ou convite indisponível.' })
    }
    const input = validateClubInput(req.body)
    if (input.nextDueDate) requireCurrentOrFutureDate(input.nextDueDate)
    const masterSettings = await getMasterSettings()
    const licenseKey = generateLicenseKey()
    const id = invitation?.clubId || randomId('CLB')

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
      plan: {
        name: masterSettings.planName || 'EspaçoOn',
        price: Number(masterSettings.planPrice || 49.9),
      },
      billing: {
        dueDay: input.dueDay,
        nextDueDate: input.nextDueDate || nextDueDateFromDay(input.dueDay),
        status: 'active',
      },
      demoMode: input.demoMode === true,
      system: { status: 'active', publicUrl: input.systemUrl || '' },
      licenseKeyHash: hashLicense(licenseKey),
    })

    if (invitation) await RegistrationInvite.updateOne({ id: invitation.id }, { $set: { approvedAt: new Date() } })

    await logAction('club.created', 'Novo cliente cadastrado no EspaçoOn Master.', club)

    if (ASAAS_API_KEY && club.cpfCnpj && !club.demoMode) {
      try {
        await ensureAsaasSubscription(club)
      } catch (billingError) {
        console.warn('Cliente criado, mas a assinatura Asaas não pôde ser criada:', billingError?.message || billingError)
        await logAction('billing.subscription_setup_failed', 'Cadastro criado, mas a assinatura Asaas precisa ser revisada.', club)
        notifyMaster({
          title: 'Falha na assinatura Asaas',
          body: 'Revise a cobrança de ' + club.establishmentName + '.',
          tag: 'master-billing-failure-' + club.id,
        })
      }
    }

    res.setHeader('Cache-Control', 'no-store')
    res.status(201).json({ club: publicClub(club), licenseKey })
  } catch (error) {
    if (req.body?.registrationInviteId && error?.code === 11000) return res.status(409).json({ error: 'Este cadastro já foi concluído. Atualize a lista de clubes.' })
    next(error)
  }
})

app.post('/api/master/clubs/:id/admin-access-link', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.params.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })
    if (club.demoMode) return res.status(409).json({ error: 'O modo demonstração não usa senha.' })

    const configured = Boolean(club.adminAuth?.passwordHash && club.adminAuth?.passwordSalt)
    const requestedPurpose = req.body?.purpose === 'reset' ? 'reset' : 'first-access'
    const purpose = configured ? 'reset' : requestedPurpose
    const rawToken = crypto.randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000)

    await AdminAccessToken.deleteMany({ clubId: club.id, usedAt: null })
    await AdminAccessToken.create({
      tokenHash: hashAccessToken(rawToken),
      clubId: club.id,
      purpose,
      expiresAt,
    })

    const baseUrl = process.env.PUBLIC_BASE_URL || (req.protocol + '://' + req.get('host'))
    const url = baseUrl.replace(/\/$/, '') + '/?adminAccessToken=' + encodeURIComponent(rawToken)

    await logAction(
      'club.admin_access_link_created',
      purpose === 'reset' ? 'Link de redefinição de senha gerado.' : 'Link de primeiro acesso gerado.',
      club,
    )

    res.setHeader('Cache-Control', 'no-store')
    res.json({ url, expiresAt, purpose, club: publicClub(club) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/admin-access/:token', loginLimiter, async (req, res, next) => {
  try {
    const token = await AdminAccessToken.findOne({
      tokenHash: hashAccessToken(req.params.token),
      usedAt: null,
      expiresAt: { $gt: new Date() },
    }).lean()

    if (!token) return res.status(404).json({ error: 'Link inválido ou expirado.' })
    const club = await Club.findOne({ id: token.clubId }).lean()
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    res.setHeader('Cache-Control', 'no-store')
    res.json({
      valid: true,
      adminUrl: adminPanelUrl(club),
      purpose: token.purpose,
      expiresAt: token.expiresAt,
      clubName: club.establishmentName,
      ownerName: club.ownerName,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/admin-access/:token/complete', loginLimiter, async (req, res, next) => {
  try {
    const token = await AdminAccessToken.findOne({
      tokenHash: hashAccessToken(req.params.token),
      usedAt: null,
      expiresAt: { $gt: new Date() },
    })
    if (!token) return res.status(404).json({ error: 'Link inválido ou expirado.' })

    const club = await Club.findOne({ id: token.clubId })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })
    if (club.demoMode) return res.status(409).json({ error: 'O modo demonstração não usa senha.' })

    const password = String(req.body?.password || '')
    const confirmation = String(req.body?.confirmation || '')
    if (password !== confirmation) {
      return res.status(400).json({ error: 'As senhas não conferem.' })
    }

    const record = await createAdminPasswordRecord(password)
    const claimed = await AdminAccessToken.findOneAndUpdate(
      { _id: token._id, usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { new: true },
    )
    if (!claimed) return res.status(404).json({ error: 'Link inválido, expirado ou já utilizado.' })
    club.adminAuth = {
      passwordHash: record.passwordHash,
      passwordSalt: record.passwordSalt,
      passwordSetAt: new Date(),
      firstAccessCompleted: true,
    }
    await club.save()

    await AdminAccessToken.updateMany(
      { clubId: club.id, _id: { $ne: token._id }, usedAt: null },
      { $set: { usedAt: new Date() } },
    )

    await logAction(
      token.purpose === 'reset' ? 'club.admin_password_reset' : 'club.admin_first_access_completed',
      token.purpose === 'reset' ? 'Senha do painel redefinida pelo proprietário.' : 'Primeiro acesso do painel concluído.',
      club,
    )

    res.setHeader('Cache-Control', 'no-store')
    res.json({ ok: true, clubName: club.establishmentName, adminUrl: adminPanelUrl(club) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/license/admin-auth/verify', authenticateClubLicense, loginLimiter, async (req, res, next) => {
  try {
    if (req.club.demoMode) {
      return res.json({ valid: true, demoMode: true, configured: false })
    }

    const configured = Boolean(req.club.adminAuth?.passwordHash && req.club.adminAuth?.passwordSalt)
    const valid = configured ? await verifyClubAdminPassword(req.club, req.body?.password) : false
    res.json({
      valid,
      configured,
      demoMode: false,
      passwordSetAt: req.club.adminAuth?.passwordSetAt || null,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/license/admin-auth/change', authenticateClubLicense, writeLimiter, async (req, res, next) => {
  try {
    if (req.club.demoMode) {
      return res.status(409).json({ error: 'O modo demonstração não usa senha.' })
    }

    const configured = Boolean(req.club.adminAuth?.passwordHash && req.club.adminAuth?.passwordSalt)
    if (!configured) return res.status(409).json({ error: 'A senha ainda não foi criada pelo primeiro acesso.' })

    const currentPassword = String(req.body?.currentPassword || '')
    if (!await verifyClubAdminPassword(req.club, currentPassword)) {
      return res.status(401).json({ error: 'Senha atual incorreta.' })
    }

    const nextPassword = String(req.body?.newPassword || '')
    const confirmation = String(req.body?.confirmation || '')
    if (nextPassword !== confirmation) return res.status(400).json({ error: 'As senhas não conferem.' })

    const record = await createAdminPasswordRecord(nextPassword)
    req.club.adminAuth.passwordHash = record.passwordHash
    req.club.adminAuth.passwordSalt = record.passwordSalt
    req.club.adminAuth.passwordSetAt = new Date()
    req.club.adminAuth.firstAccessCompleted = true
    await req.club.save()

    await logAction('club.admin_password_changed', 'Senha do painel alterada pelo proprietário.', req.club)
    res.json({ ok: true, passwordSetAt: req.club.adminAuth.passwordSetAt })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/master/clubs/:id', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.params.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    const input = validateClubInput(req.body, true)
    if (input.systemUrl !== undefined) club.system.publicUrl = input.systemUrl
    for (const key of ['establishmentName', 'ownerName', 'cpfCnpj', 'phone', 'email', 'city', 'state']) {
      if (input[key] !== undefined) club[key] = input[key]
    }

    if (input.dueDay !== undefined) {
      const previousDueDay = Number(club.billing?.dueDay || 10)
      const dueDayChanged = previousDueDay !== input.dueDay
      const dueDateChanged = input.nextDueDate && input.nextDueDate.toISOString().slice(0, 10) !== new Date(club.billing?.nextDueDate || 0).toISOString().slice(0, 10)
      if (dueDateChanged) requireCurrentOrFutureDate(input.nextDueDate)

      club.billing.dueDay = input.dueDay

      if (dueDayChanged || dueDateChanged || !club.billing.nextDueDate) {
        const newDueDate = input.nextDueDate || nextDueDateFromDay(input.dueDay)
        const newDueDateISO = newDueDate.toISOString().slice(0, 10)

        if (ASAAS_API_KEY && club.billing?.asaasSubscriptionId && !club.demoMode) {
          // Atualiza a recorrência futura no Asaas.
          await asaasRequest(
            '/subscriptions/' + encodeURIComponent(club.billing.asaasSubscriptionId),
            {
              method: 'PUT',
              body: {
                nextDueDate: newDueDateISO,
                updatePendingPayments: true,
              },
            },
          )

          // A alteração da assinatura não muda uma cobrança que já foi gerada.
          // Se houver uma cobrança aberta/vencida, ajustamos o vencimento dela também.
          try {
            const list = await asaasRequest(
              '/subscriptions/' + encodeURIComponent(club.billing.asaasSubscriptionId) + '/payments',
            )
            const payments = Array.isArray(list?.data) ? list.data : []
            const editablePayment = payments
              .filter((payment) => ['PENDING', 'OVERDUE'].includes(payment.status))
              .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')))[0]

            if (editablePayment?.id) {
              const remotePayment = await asaasRequest(
                '/payments/' + encodeURIComponent(editablePayment.id),
              )

              await asaasRequest(
                '/payments/' + encodeURIComponent(editablePayment.id),
                {
                  method: 'PUT',
                  body: {
                    billingType: remotePayment.billingType || 'PIX',
                    value: Number(remotePayment.value || club.plan?.price || 49.9),
                    dueDate: newDueDateISO,
                    description: remotePayment.description || 'Assinatura mensal EspaçoOn',
                  },
                },
              )

              club.billing.currentPaymentId = editablePayment.id
              club.billing.currentPaymentDueDate = newDueDate
            }
          } catch (paymentSyncError) {
            console.warn(
              'Vencimento da assinatura atualizado, mas a cobrança atual não pôde ser ajustada:',
              paymentSyncError?.message || paymentSyncError,
            )
          }
        }

        club.billing.nextDueDate = newDueDate
        club.billing.graceUntil = null

        // Se o novo vencimento está no futuro, o clube deixa de aparecer como vencido.
        if (!club.demoMode && ['past_due', 'suspended'].includes(club.billing.status)) {
          club.billing.status = 'active'
          if (club.system?.status === 'suspended') club.system.status = 'active'
        }
      }
    }

    await club.save()
    await logAction('club.updated', 'Cadastro do cliente atualizado.', club)

    if (ASAAS_API_KEY && club.cpfCnpj && !club.billing?.asaasSubscriptionId && !club.demoMode) {
      try {
        await ensureAsaasSubscription(club)
      } catch (billingError) {
        console.warn('Cadastro atualizado, mas a assinatura Asaas não pôde ser criada:', billingError?.message || billingError)
        await logAction('billing.subscription_setup_failed', 'Cadastro atualizado, mas a assinatura Asaas precisa ser revisada.', club)
        notifyMaster({
          title: 'Falha na assinatura Asaas',
          body: 'Revise a cobrança de ' + club.establishmentName + '.',
          tag: 'master-billing-failure-' + club.id,
        })
      }
    }

    res.json(publicClub(club))
  } catch (error) {
    next(error)
  }
})

app.delete('/api/master/clubs/:id', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.params.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })
    if (req.body?.confirmation !== club.id) return res.status(400).json({ error: 'Confirme o código do clube para excluir.' })
    if (!club.demoMode && !['suspended', 'cancelled'].includes(club.system?.status)) {
      return res.status(409).json({ error: 'Bloqueie ou cancele o clube antes de excluir.' })
    }
    if (club.billing?.asaasSubscriptionId) {
      // Fail closed when Asaas is unavailable: never hide a recurring subscription
      // that may still generate charges. A retry after a previous cancellation is safe.
      try {
        await asaasRequest('/subscriptions/' + encodeURIComponent(club.billing.asaasSubscriptionId), { method: 'DELETE' })
      } catch (error) {
        if (error.providerStatus !== 404) throw error
      }
    }
    club.deletedAt = new Date()
    club.system.status = 'cancelled'
    club.system.temporaryUnlockUntil = null
    club.billing.status = 'cancelled'
    club.billing.asaasSubscriptionId = null
    club.licenseKeyHash = hashLicense(generateLicenseKey())
    club.adminAuth = { firstAccessCompleted: false }
    club.payments = { mercadoPago: {} }
    await club.save()
    await AdminAccessToken.deleteMany({ clubId: club.id })
    await MercadoPagoOAuthAttempt.deleteMany({ clubId: club.id })
    await logAction('club.deleted', 'Clube excluído da operação; histórico financeiro preservado.', club)
    res.json({ deleted: true, id: club.id })
  } catch (error) {
    next(error)
  }
})

app.post('/api/master/clubs/:id/demo-mode', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.params.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    const enabled = req.body?.enabled === true
    if (club.demoMode === enabled) return res.json(publicClub(club))

    if (enabled) {
      if (ASAAS_API_KEY && club.billing?.asaasSubscriptionId) {
        await asaasRequest('/subscriptions/' + encodeURIComponent(club.billing.asaasSubscriptionId), {
          method: 'DELETE',
        })
      }

      club.demoMode = true
      club.billing.asaasSubscriptionId = null
      club.billing.currentPaymentId = null
      club.billing.currentPaymentDueDate = null
      await club.save()

      await logAction(
        'club.demo_enabled',
        'Modo demonstração ativado. Cobranças reais e senha do painel foram desativadas.',
        club,
      )

      notifyMaster({
        title: 'Demonstração ativada',
        body: club.establishmentName + ' entrou em modo de demonstração.',
        tag: 'master-demo-' + club.id,
      })
    } else {
      club.demoMode = false
      await club.save()

      if (ASAAS_API_KEY && club.cpfCnpj) {
        await ensureAsaasSubscription(club)
      }

      await logAction(
        'club.demo_disabled',
        'Modo demonstração desativado. Operação real restaurada.',
        club,
      )

      notifyMaster({
        title: 'Demonstração encerrada',
        body: club.establishmentName + ' voltou ao modo de produção.',
        tag: 'master-demo-' + club.id,
      })
    }

    res.json(publicClub(club))
  } catch (error) {
    next(error)
  }
})

app.post('/api/master/clubs/:id/mercadopago/connect', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.params.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    res.json({
      authorizationUrl: await createMercadoPagoAuthorization(club, req.body?.returnUrl),
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/license/mercadopago/connect', authenticateClubLicense, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.club.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    if ((club.reservationPaymentProvider || 'asaas') !== 'mercadopago') {
      return res.status(409).json({
        error: 'O Mercado Pago ainda não foi selecionado como provedor deste clube no painel Master.',
      })
    }

    res.json({
      authorizationUrl: await createMercadoPagoAuthorization(club, req.body?.returnUrl),
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/license/mercadopago/disconnect', authenticateClubLicense, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.club.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    await disconnectMercadoPagoForClub(club)
    await logAction(
      'club.mercadopago_disconnected',
      'Conta Mercado Pago desconectada pelo proprietário do clube.',
      club,
    )

    res.json({
      ok: true,
      mercadopago: mercadoPagoConnectionInfo(club),
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/license/mercadopago/config', authenticateClubLicense, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.club.id }).lean()
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    const mp = club.payments?.mercadoPago || {}
    res.json({
      paymentProvider: club.reservationPaymentProvider || 'asaas',
      connected: Boolean(mp.accessTokenEncrypted),
      publicKey: mp.publicKey || '',
    })
  } catch (error) {
    next(error)
  }
})


app.post('/api/license/mercadopago/checkout/preferences', authenticateClubLicense, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.club.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    if ((club.reservationPaymentProvider || 'asaas') !== 'mercadopago') {
      return res.status(409).json({ error: 'Mercado Pago não está selecionado para este clube.' })
    }

    const amount = Number(req.body?.amount)
    const externalReference = text(req.body?.externalReference, 64)
    const payerEmail = text(req.body?.payerEmail, 160).toLowerCase()
    const description = text(req.body?.description, 160)
    const successUrl = safeReturnUrl(req.body?.successUrl)
    const pendingUrl = safeReturnUrl(req.body?.pendingUrl)
    const failureUrl = safeReturnUrl(req.body?.failureUrl)

    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
      return res.status(400).json({ error: 'Valor da cobrança inválido.' })
    }
    if (!externalReference) {
      return res.status(400).json({ error: 'Referência da cobrança não informada.' })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) {
      return res.status(400).json({ error: 'E-mail do pagador inválido.' })
    }
    if (!successUrl || !pendingUrl || !failureUrl) {
      return res.status(400).json({ error: 'URLs de retorno do checkout inválidas.' })
    }

    const preference = await mercadoPagoApiRequest(club, '/checkout/preferences', {
      method: 'POST',
      body: {
        items: [
          {
            id: externalReference,
            title: description || ('Reserva EspaçoOn ' + externalReference),
            quantity: 1,
            currency_id: 'BRL',
            unit_price: Number(amount.toFixed(2)),
          },
        ],
        payer: {
          email: payerEmail,
        },
        external_reference: externalReference,
        back_urls: {
          success: successUrl,
          pending: pendingUrl,
          failure: failureUrl,
        },
        auto_return: 'approved',
        payment_methods: {
          excluded_payment_types: [
            { id: 'ticket' },
            { id: 'bank_transfer' },
            { id: 'debit_card' },
          ],
          installments: 12,
        },
        statement_descriptor: 'ESPACOON',
      },
    })

    if (!preference?.id || !preference?.init_point) {
      throw Object.assign(new Error('O Mercado Pago não retornou o link do checkout.'), { statusCode: 502 })
    }

    await logAction(
      'club.mercadopago_checkout_preference_created',
      'Checkout Pro criado para uma reserva.',
      club,
      {
        externalReference,
        preferenceId: preference.id,
        amount,
      },
    )

    res.status(201).json({
      preferenceId: preference.id,
      checkoutUrl: preference.init_point,
      sandboxCheckoutUrl: preference.sandbox_init_point || null,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/license/mercadopago/checkout/preferences/:preferenceId/expire', authenticateClubLicense, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.club.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    const preferenceId = text(req.params.preferenceId, 120)
    if (!preferenceId) return res.status(400).json({ error: 'Preferência inválida.' })

    const now = new Date()
    const until = new Date(now.getTime() + 1000)

    const preference = await mercadoPagoApiRequest(
      club,
      '/checkout/preferences/' + encodeURIComponent(preferenceId),
      {
        method: 'PUT',
        body: {
          expires: true,
          expiration_date_from: now.toISOString(),
          expiration_date_to: until.toISOString(),
        },
      },
    )

    res.json({ ok: true, preferenceId: preference?.id || preferenceId })
  } catch (error) {
    next(error)
  }
})

app.get('/api/license/mercadopago/payments/by-reference/:externalReference', authenticateClubLicense, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.club.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    const externalReference = text(req.params.externalReference, 64)
    if (!externalReference) {
      return res.status(400).json({ error: 'Referência da cobrança não informada.' })
    }

    const search = await mercadoPagoApiRequest(
      club,
      '/v1/payments/search?external_reference=' + encodeURIComponent(externalReference) +
        '&sort=date_created&criteria=desc&limit=20',
    )

    const results = Array.isArray(search?.results) ? search.results : []
    const matches = results.filter(
      (payment) => String(payment?.external_reference || '') === externalReference,
    )

    const payment =
      matches.find((item) => item.status === 'approved') ||
      matches.find((item) => item.status === 'in_process') ||
      matches.find((item) => item.status === 'pending') ||
      matches[0] ||
      null

    if (!payment?.id) {
      return res.json({ found: false })
    }

    res.json({
      found: true,
      paymentId: String(payment.id),
      status: payment.status || null,
      statusDetail: payment.status_detail || null,
      externalReference: payment.external_reference || null,
      amount: Number(payment.transaction_amount || 0),
      paymentMethodId: payment.payment_method_id || null,
      paymentTypeId: payment.payment_type_id || null,
      dateApproved: payment.date_approved || null,
    })
  } catch (error) {
    next(error)
  }
})


app.post('/api/license/mercadopago/orders/card', authenticateClubLicense, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.club.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    if ((club.reservationPaymentProvider || 'asaas') !== 'mercadopago') {
      return res.status(409).json({ error: 'Mercado Pago não está selecionado para este clube.' })
    }

    const amount = Number(req.body?.amount)
    const externalReference = text(req.body?.externalReference, 64)
    const description = text(req.body?.description, 160)
    const token = text(req.body?.token, 500)
    const paymentMethodId = text(req.body?.paymentMethodId, 40)
    const paymentTypeId = text(req.body?.paymentTypeId, 40)
    const installments = Number(req.body?.installments || 1)
    const payerEmail = text(req.body?.payerEmail, 160).toLowerCase()
    const identificationType = text(req.body?.identificationType || 'CPF', 12).toUpperCase()
    const identificationNumber = text(req.body?.identificationNumber, 30).replace(/\D/g, '')

    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
      return res.status(400).json({ error: 'Valor da cobrança inválido.' })
    }
    if (!externalReference || !token || !paymentMethodId) {
      return res.status(400).json({ error: 'Dados do cartão incompletos.' })
    }
    if (paymentTypeId !== 'credit_card') {
      return res.status(400).json({ error: 'Neste momento, o EspaçoOn aceita apenas cartão de crédito.' })
    }
    if (!Number.isInteger(installments) || installments < 1 || installments > 12) {
      return res.status(400).json({ error: 'Quantidade de parcelas inválida.' })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) {
      return res.status(400).json({ error: 'E-mail do pagador inválido.' })
    }

    const totalAmount = amount.toFixed(2)
    const order = await mercadoPagoApiRequest(club, '/v1/orders', {
      method: 'POST',
      idempotencyKey: stableUuid(club.id + ':card:' + externalReference + ':' + token),
      body: {
        type: 'online',
        total_amount: totalAmount,
        external_reference: externalReference,
        processing_mode: 'automatic',
        capture_mode: 'automatic',
        description: description || ('Reserva EspaçoOn ' + externalReference),
        config: {
          online: {
            transaction_security: {
              validation: 'on_fraud_risk',
              liability_shift: 'required',
            },
          },
        },
        payer: {
          email: payerEmail,
          ...(identificationNumber ? {
            identification: {
              type: identificationType || 'CPF',
              number: identificationNumber,
            },
          } : {}),
        },
        transactions: {
          payments: [
            {
              amount: totalAmount,
              payment_method: {
                id: paymentMethodId,
                type: 'credit_card',
                token,
                installments,
              },
            },
          ],
        },
      },
    })

    const payment = order?.transactions?.payments?.[0] || {}
    const method = payment?.payment_method || {}
    const transactionSecurity = method?.transaction_security || {}

    await cacheMercadoPagoOrder(club, order, {
      externalReference,
      liveMode: order?.live_mode === true,
    })

    await logAction(
      'club.mercadopago_card_order_created',
      'Cobrança de cartão Mercado Pago criada para uma reserva.',
      club,
      {
        externalReference,
        orderId: order?.id || null,
        paymentId: payment?.id || null,
        amount,
        installments,
      },
    )

    res.status(201).json({
      orderId: order?.id || null,
      paymentId: payment?.id || null,
      status: order?.status || payment?.status || null,
      statusDetail: order?.status_detail || payment?.status_detail || null,
      challengeUrl: transactionSecurity?.url || null,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/license/mercadopago/orders', authenticateClubLicense, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.club.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    if ((club.reservationPaymentProvider || 'asaas') !== 'mercadopago') {
      return res.status(409).json({ error: 'Mercado Pago não está selecionado para este clube.' })
    }

    const amount = Number(req.body?.amount)
    const externalReference = text(req.body?.externalReference, 64)
    const payerEmail = text(req.body?.payerEmail, 160).toLowerCase()
    const description = text(req.body?.description, 160)

    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
      return res.status(400).json({ error: 'Valor da cobrança inválido.' })
    }
    if (!externalReference) {
      return res.status(400).json({ error: 'Referência da cobrança não informada.' })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) {
      return res.status(400).json({ error: 'E-mail do pagador inválido.' })
    }

    const totalAmount = amount.toFixed(2)
    const order = await mercadoPagoApiRequest(club, '/v1/orders', {
      method: 'POST',
      idempotencyKey: stableUuid(club.id + ':' + externalReference),
      body: {
        type: 'online',
        total_amount: totalAmount,
        external_reference: externalReference,
        processing_mode: 'automatic',
        description: description || ('Reserva EspaçoOn ' + externalReference),
        payer: {
          email: payerEmail,
        },
        transactions: {
          payments: [
            {
              amount: totalAmount,
              payment_method: {
                id: 'pix',
                type: 'bank_transfer',
              },
              expiration_time: 'PT30M',
            },
          ],
        },
      },
    })

    const payment = order?.transactions?.payments?.[0] || {}
    const method = payment?.payment_method || {}

    await cacheMercadoPagoOrder(club, order, {
      externalReference,
      liveMode: order?.live_mode === true,
    })

    await logAction(
      'club.mercadopago_order_created',
      'Cobrança Pix Mercado Pago criada para uma reserva.',
      club,
      {
        externalReference,
        orderId: order?.id || null,
        paymentId: payment?.id || null,
        amount,
      },
    )

    res.status(201).json({
      orderId: order?.id || null,
      paymentId: payment?.id || null,
      status: order?.status || payment?.status || null,
      statusDetail: order?.status_detail || payment?.status_detail || null,
      qrCode: method?.qr_code || null,
      qrCodeBase64: method?.qr_code_base64 || null,
      ticketUrl: method?.ticket_url || null,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/license/mercadopago/orders/:orderId', authenticateClubLicense, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.club.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    const orderId = text(req.params.orderId, 120)
    if (!orderId) return res.status(400).json({ error: 'Order inválida.' })

    const cached = await MercadoPagoOrder.findOne({ orderId, clubId: club.id }).lean()
    if (cached?.status === 'processed' && cached?.statusDetail === 'accredited') {
      return res.json({
        orderId,
        paymentId: cached.paymentId || null,
        status: cached.status,
        statusDetail: cached.statusDetail,
        fromWebhook: Boolean(cached.lastWebhookAt),
      })
    }

    const order = await mercadoPagoApiRequest(
      club,
      '/v1/orders/' + encodeURIComponent(orderId),
    )

    const payment = order?.transactions?.payments?.[0] || {}
    const method = payment?.payment_method || {}
    const transactionSecurity = method?.transaction_security || {}
    await cacheMercadoPagoOrder(club, order)

    res.json({
      orderId: order?.id || orderId,
      paymentId: payment?.id || null,
      status: order?.status || payment?.status || null,
      statusDetail: order?.status_detail || payment?.status_detail || null,
      qrCode: method?.qr_code || null,
      qrCodeBase64: method?.qr_code_base64 || null,
      ticketUrl: method?.ticket_url || null,
      challengeUrl: transactionSecurity?.url || null,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/oauth/mercadopago/callback', async (req, res, next) => {
  try {
    if (!MERCADOPAGO_OAUTH_CONFIGURED) {
      return res.status(503).send('Mercado Pago não configurado no EspaçoOn Master.')
    }

    const code = text(req.query?.code, 500)
    const state = text(req.query?.state, 500)
    if (!code || !state) {
      return res.status(400).send('Autorização do Mercado Pago incompleta.')
    }

    const stateHash = sha256Base64Url(state)
    const attempt = await MercadoPagoOAuthAttempt.findOne({ stateHash })
    if (!attempt || new Date(attempt.expiresAt) <= new Date()) {
      if (attempt) await MercadoPagoOAuthAttempt.deleteOne({ _id: attempt._id })
      return res.status(400).send('Esta autorização expirou. Volte ao Master e tente novamente.')
    }

    const club = await Club.findOne({ id: attempt.clubId })
    if (!club) {
      await MercadoPagoOAuthAttempt.deleteOne({ _id: attempt._id })
      return res.status(404).send('Cliente não encontrado.')
    }

    const codeVerifier = decryptSecret(attempt.verifierEncrypted)
    const token = await mercadoPagoTokenRequest({
      client_id: MERCADOPAGO_CLIENT_ID,
      client_secret: MERCADOPAGO_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: MERCADOPAGO_REDIRECT_URI,
      code_verifier: codeVerifier,
    })

    if (!token?.access_token || !token?.user_id) {
      throw Object.assign(new Error('Mercado Pago não retornou as credenciais esperadas.'), { statusCode: 502 })
    }

    const now = new Date()
    const expiresIn = Number(token.expires_in || 0)
    club.payments = club.payments || {}
    club.payments.mercadoPago = {
      userId: String(token.user_id),
      publicKey: token.public_key || '',
      accessTokenEncrypted: encryptSecret(token.access_token),
      refreshTokenEncrypted: token.refresh_token ? encryptSecret(token.refresh_token) : '',
      scope: token.scope || '',
      liveMode: token.live_mode === true,
      expiresAt: expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000) : null,
      connectedAt: club.payments?.mercadoPago?.connectedAt || now,
      updatedAt: now,
    }
    await club.save()
    await MercadoPagoOAuthAttempt.deleteOne({ _id: attempt._id })

    await logAction(
      'club.mercadopago_connected',
      'Conta Mercado Pago conectada ao clube.',
      club,
      { mercadoPagoUserId: String(token.user_id), liveMode: token.live_mode === true },
    )

    const returnUrl = safeReturnUrl(attempt.returnUrl)
    res.redirect(returnUrl || '/?mercadopago=connected&club=' + encodeURIComponent(club.id))
  } catch (error) {
    next(error)
  }
})

app.post('/api/master/clubs/:id/mercadopago/disconnect', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.params.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    await disconnectMercadoPagoForClub(club)
    await logAction(
      'club.mercadopago_disconnected',
      'Conta Mercado Pago desconectada pelo Master.',
      club,
    )

    res.json({
      club: publicClub(club),
      mercadopago: mercadoPagoConnectionInfo(club),
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/master/clubs/:id/payment-provider', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const club = await Club.findOne({ id: req.params.id })
    if (!club) return res.status(404).json({ error: 'Cliente não encontrado.' })

    const provider = text(req.body?.provider, 30).toLowerCase()
    if (!['asaas', 'mercadopago'].includes(provider)) {
      return res.status(400).json({ error: 'Provedor de pagamento inválido.' })
    }

    if (provider === 'mercadopago' && !MERCADOPAGO_OAUTH_CONFIGURED) {
      return res.status(409).json({ error: 'Configure primeiro o OAuth do Mercado Pago no Master.' })
    }

    const previousProvider = club.reservationPaymentProvider || 'asaas'
    club.reservationPaymentProvider = provider
    await club.save()

    await logAction(
      'club.payment_provider_changed',
      'Provedor de recebimento das reservas alterado.',
      club,
      { previousProvider, provider },
    )

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

    const fallbackPlanPrice = await currentPlanPrice()
    const amount = req.body?.paidAmount == null ? fallbackPlanPrice : Number(req.body.paidAmount)
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
    if (club.demoMode) {
      return res.json({
        demoMode: true,
        amount: 0,
        billingStatus: 'demo',
        nextDueDate: null,
        canGeneratePix: false,
        cpfCnpjConfigured: Boolean(club.cpfCnpj),
      })
    }
    const planPrice = await currentPlanPrice()
    res.json({
      amount: planPrice,
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
    if (club.demoMode) {
      return res.status(409).json({ error: 'Cobrança desativada no modo demonstração.', demoMode: true })
    }
    const pix = await getPixForClub(club)
    await logAction('billing.pix_requested', 'QR Code da mensalidade solicitado pelo sistema do clube.', club, {
      paymentId: pix.paymentId,
    })
    res.json(pix)
  } catch (error) {
    next(error)
  }
})

app.get('/api/webhooks/whatsapp', (req, res) => {
  if (!WHATSAPP_VERIFY_TOKEN) {
    return res.status(503).send('Webhook WhatsApp não configurado.')
  }

  const mode = String(req.query?.['hub.mode'] || '')
  const verifyToken = String(req.query?.['hub.verify_token'] || '')
  const challenge = String(req.query?.['hub.challenge'] || '')

  if (
    mode === 'subscribe' &&
    challenge &&
    secureEqual(verifyToken, WHATSAPP_VERIFY_TOKEN)
  ) {
    return res.status(200).send(challenge)
  }

  return res.status(403).send('Verificação recusada.')
})

app.post('/api/webhooks/whatsapp', async (req, res) => {
  if (!WHATSAPP_APP_SECRET) {
    return res.status(503).json({ error: 'Webhook WhatsApp não configurado.' })
  }

  if (!validateWhatsAppWebhookSignature(req)) {
    return res.status(401).json({ error: 'Webhook WhatsApp não autorizado.' })
  }

  if (req.body?.object !== 'whatsapp_business_account') {
    return res.status(200).json({ received: true, ignored: true })
  }

  res.status(200).json({ received: true })

  try {
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : []

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : []

      for (const change of changes) {
        if (change?.field !== 'messages') continue

        const value = change?.value || {}
        const phoneNumberId = text(value?.metadata?.phone_number_id, 80)
        const messages = Array.isArray(value?.messages) ? value.messages : []
        const statuses = Array.isArray(value?.statuses) ? value.statuses : []

        for (const message of messages) {
          const messageId = text(message?.id, 180)
          if (!messageId) continue

          const eventId = 'WA-MSG-' + messageId
          if (await WebhookEvent.exists({ id: eventId })) continue

          await WebhookEvent.create({
            id: eventId,
            event: 'whatsapp.message.received',
          }).catch(() => {})

          console.log('WhatsApp webhook: mensagem recebida', {
            phoneNumberId,
            type: text(message?.type, 40),
          })
        }

        for (const status of statuses) {
          const messageId = text(status?.id, 180)
          if (!messageId) continue

          const eventId = [
            'WA-STATUS',
            messageId,
            text(status?.status, 40),
            text(status?.timestamp, 30),
          ].join('-')

          if (await WebhookEvent.exists({ id: eventId })) continue

          await WebhookEvent.create({
            id: eventId,
            event: 'whatsapp.message.' + text(status?.status || 'status', 40),
          }).catch(() => {})
        }
      }
    }
  } catch (error) {
    console.error('Falha ao processar webhook WhatsApp:', error?.message || error)
  }
})

app.post('/api/webhooks/mercadopago', async (req, res) => {
  if (!MERCADOPAGO_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Webhook Mercado Pago não configurado.' })
  }

  if (!validateMercadoPagoWebhookSignature(req)) {
    return res.status(401).json({ error: 'Webhook Mercado Pago não autorizado.' })
  }

  const eventId = 'MP-' + text(req.body?.id || req.get('x-request-id'), 160)
  const orderId = text(req.query?.['data.id'] || req.body?.data?.id, 160)
  const type = text(req.body?.type || req.query?.type, 40)
  const userId = text(req.body?.user_id, 80)

  if (!orderId || type !== 'order') {
    return res.status(200).json({ received: true, ignored: true })
  }

  if (eventId && await WebhookEvent.exists({ id: eventId })) {
    return res.status(200).json({ received: true, duplicate: true })
  }

  if (eventId) {
    await WebhookEvent.create({
      id: eventId,
      event: text(req.body?.action || 'mercadopago.order', 80),
    }).catch(() => {})
  }

  // Responde rápido ao Mercado Pago. A confirmação completa é consultada na API oficial.
  res.status(200).json({ received: true })

  try {
    const club = userId
      ? await Club.findOne({ 'payments.mercadoPago.userId': userId })
      : null

    if (!club) {
      console.warn('Webhook Mercado Pago sem clube correspondente.', { orderId, userId })
      return
    }

    const order = await mercadoPagoApiRequest(
      club,
      '/v1/orders/' + encodeURIComponent(orderId),
    )

    await cacheMercadoPagoOrder(club, order, {
      orderId,
      eventId,
      liveMode: req.body?.live_mode === true,
      fromWebhook: true,
    })

    await logAction(
      'club.mercadopago_order_webhook',
      'Atualização de cobrança Mercado Pago recebida por webhook.',
      club,
      {
        orderId,
        status: order?.status || null,
        statusDetail: order?.status_detail || null,
      },
    )
  } catch (error) {
    console.error('Falha ao processar webhook Mercado Pago:', error?.message || error)
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

    const clubFilters = [
      ...(payment.subscription ? [{ 'billing.asaasSubscriptionId': payment.subscription }] : []),
      ...(payment.customer ? [{ 'billing.asaasCustomerId': payment.customer }] : []),
      ...(payment.externalReference ? [{ id: payment.externalReference }] : []),
    ]
    const club = clubFilters.length ? await Club.findOne({ $or: clubFilters }) : null

    if (club) {
      if (['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].includes(event)) {
        const amount = Number(payment.value || await currentPlanPrice())
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
              cycleEnd: payment.dueDate
                ? nextDueDateFromDay(club.billing.dueDay, addDays(new Date(payment.dueDate + 'T12:00:00'), 1))
                : nextDueDateFromDay(club.billing.dueDay, addDays(paidAt, 1)),
            },
          },
          { upsert: true },
        )

        const paidCycleDate = payment.dueDate
          ? new Date(payment.dueDate + 'T12:00:00')
          : paidAt
        const renewedDueDate = nextDueDateFromDay(club.billing.dueDay, addDays(paidCycleDate, 1))

        club.billing.status = 'active'
        club.billing.lastPaidAt = paidAt
        club.billing.nextDueDate = renewedDueDate
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
        notifyMaster({
          title: 'Mensalidade recebida',
          body: club.establishmentName + ' pagou R$ ' + amount.toFixed(2).replace('.', ',') + '. Sistema liberado.',
          tag: 'master-payment-' + String(payment.id || eventId),
        })
      }

      if (event === 'PAYMENT_OVERDUE') {
        club.billing.status = 'past_due'
        if (payment.dueDate) club.billing.nextDueDate = new Date(payment.dueDate + 'T12:00:00')
        await club.save()
        await logAction('billing.payment_overdue', 'Mensalidade marcada como vencida pelo Asaas.', club, {
          paymentId: payment.id,
        })
        notifyMaster({
          title: 'Pagamento vencido',
          body: club.establishmentName + ' possui uma cobrança vencida no Asaas.',
          tag: 'master-asaas-overdue-' + String(payment.id || club.id),
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

app.get('/api/master/push/status', requireMaster, async (_req, res, next) => {
  try {
    const config = await ensurePushConfig()
    const subscriptions = await PushSubscription.countDocuments({ enabled: true })
    res.json({ supported: true, publicKey: config.publicKey, subscriptions })
  } catch (error) {
    next(error)
  }
})

app.post('/api/master/push/subscribe', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const subscription = req.body?.subscription || {}
    const endpoint = text(subscription.endpoint, 2000)
    const p256dh = text(subscription.keys?.p256dh, 500)
    const auth = text(subscription.keys?.auth, 500)

    if (!endpoint.startsWith('https://') || !p256dh || !auth) {
      return res.status(400).json({ error: 'Assinatura de notificação inválida.' })
    }

    await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        $set: {
          endpoint,
          keys: { p256dh, auth },
          userAgent: text(req.get('user-agent'), 500),
          enabled: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )

    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/master/push/subscribe', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const endpoint = text(req.body?.endpoint, 2000)
    if (!endpoint) return res.status(400).json({ error: 'Dispositivo não informado.' })
    await PushSubscription.deleteOne({ endpoint })
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.post('/api/master/push/test', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const endpoint = text(req.body?.endpoint, 2000) || null
    const result = await sendPushNotification({
      title: 'EspaçoOn Master',
      body: 'As notificações do Painel Master estão funcionando.',
      url: '/',
      tag: 'espacoon-master-test',
    }, endpoint)

    if (!result.sent) {
      return res.status(404).json({ error: 'Nenhum dispositivo ativo recebeu a notificação.' })
    }

    res.json({ ok: true, ...result })
  } catch (error) {
    next(error)
  }
})

app.post('/api/master/push/test-background', requireMaster, writeLimiter, async (req, res, next) => {
  try {
    const endpoint = text(req.body?.endpoint, 2000)
    if (!endpoint) return res.status(400).json({ error: 'Dispositivo não informado.' })

    const exists = await PushSubscription.findOne({ endpoint, enabled: true }).lean()
    if (!exists) return res.status(404).json({ error: 'Dispositivo não cadastrado.' })

    res.json({ ok: true, message: 'Teste agendado para 15 segundos.' })

    setTimeout(() => {
      sendPushNotification({
        title: 'EspaçoOn Master',
        body: 'O Master conseguiu notificar você mesmo em segundo plano.',
        url: '/',
        tag: 'espacoon-master-background-' + Date.now(),
      }, endpoint).catch(() => {})
    }, 15000)
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
    const report = parseSetupReport(req.get('x-club-setup'))
    if (report) club.provisioning = { ...report, reportedAt: new Date() }
    await club.save()

    res.json({
      ok: true,
      active: effectiveAccess(club),
      demoMode: club.demoMode === true,
      status: club.demoMode ? 'demo' : club.system.status,
      billingStatus: club.demoMode ? 'demo' : club.billing.status,
      paymentProvider: club.reservationPaymentProvider || 'asaas',
      mercadoPagoConnected: mercadoPagoConnectionInfo(club).connected,
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
    whatsappWebhookConfigured: Boolean(WHATSAPP_VERIFY_TOKEN && WHATSAPP_APP_SECRET),
    backup: {
      configured: backupState.configured,
      running: backupState.running,
      lastCompletedAt: backupState.lastCompletedAt,
      lastSnapshotId: backupState.lastSnapshotId,
      healthy: !backupState.lastError,
    },
  })
})

app.use((error, _req, res, _next) => {
  if (_req.path.startsWith('/api/registration')) {
    if (!error.statusCode || error.statusCode >= 500) console.error('Falha no cadastro por convite.')
  } else console.error(error)
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
      startDatabaseBackupScheduler()
    })
  } catch (error) {
    console.error('Falha ao iniciar EspaçoOn Master:', error?.message || error)
    process.exit(1)
  }
}

async function shutdown(signal) {
  console.log(signal + ' recebido. Encerrando...')
  try {
    if (backupTimer) clearInterval(backupTimer)
    if (backupConnection) await backupConnection.close().catch(() => {})
    await mongoose.connection.close()
  } finally {
    process.exit(0)
  }
}

// Importing the app for tests must not connect to MongoDB or start schedulers.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  process.once('SIGTERM', () => shutdown('SIGTERM'))
  process.once('SIGINT', () => shutdown('SIGINT'))
  start()
}

export { app, effectiveAccess, validateClubInput, publicClub, createAdminPasswordRecord, verifyClubAdminPassword, validateWhatsAppWebhookSignature, validateMercadoPagoWebhookSignature }
