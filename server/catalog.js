import crypto from 'node:crypto'
import rateLimit from 'express-rate-limit'

export const categories = [
  { id: 'clube', label: 'Clubes', type: 'space' }, { id: 'chacara', label: 'Chácaras', type: 'space' }, { id: 'salao', label: 'Salões de festas', type: 'space' },
  { id: 'mesas', label: 'Mesas e cadeiras', type: 'supplier' }, { id: 'brinquedos', label: 'Pula-pula e brinquedos', type: 'supplier' }, { id: 'doces', label: 'Doces e bolos', type: 'supplier' }, { id: 'decoracao', label: 'Decoração', type: 'supplier' }, { id: 'buffet', label: 'Buffet', type: 'supplier' }, { id: 'fotografia', label: 'Fotografia', type: 'supplier' }, { id: 'outros', label: 'Outros serviços', type: 'supplier' },
]
export const amenities = [
  ['piscina', 'Piscina'], ['churrasqueira', 'Churrasqueira'], ['pulapula', 'Pula-pula'], ['quarto', 'Quarto'], ['sinuca', 'Sinuca'], ['campo', 'Campo de futebol'], ['freezer', 'Freezer'], ['cozinha', 'Cozinha'], ['estacionamento', 'Estacionamento'], ['acessibilidade', 'Acessibilidade'],
].map(([id, label]) => ({ id, label }))
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }) }
const field = (value, max, label, min = 0) => {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) fail('Confira o campo ' + label + '.')
  return value.trim()
}
export function validateCatalog(input, { submission = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Cadastro inválido.')
  const category = categories.find(c => c.id === input.category)
  if (!category) fail('Escolha uma categoria.')
  const phone = field(input.phone, 30, 'WhatsApp', 10).replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  if (!/^[1-9]\d{9,10}$/.test(phone)) fail('Informe um WhatsApp com DDD.')
  const state = field(input.state, 2, 'UF', 2).toUpperCase()
  if (!'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(state)) fail('Informe uma UF válida.')
  const features = input.amenities ?? []
  if (!Array.isArray(features) || features.length > amenities.length || features.some(a => !amenities.some(v => v.id === a))) fail('Estrutura inválida.')
  const email = field(input.email || '', 160, 'e-mail')
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Confira o e-mail.')
  let website = field(input.website || '', 300, 'site')
  if (website) {
    let url
    try { url = new URL(website) } catch { fail('Informe um site HTTPS válido.') }
    if (url.protocol !== 'https:' || url.username || url.password || !/^[a-z\d.-]+\.[a-z]{2,}$/i.test(url.hostname) || /(^|\.)(localhost|local|internal)$/i.test(url.hostname)) fail('Informe um site HTTPS público.')
    website = url.href
  }
  const capacity = Number(input.capacity || 0)
  if (!Number.isInteger(capacity) || capacity < 0 || capacity > 100000) fail('Capacidade inválida.')
  if (submission && (input.consent !== true || input.company)) fail('Autorize a publicação dos dados do negócio.')
  return { name: field(input.name, 100, 'nome do negócio', 3), ownerName: field(input.ownerName, 100, 'responsável', 3), email, phone, category: category.id, type: category.type, city: field(input.city, 80, 'cidade', 2), state, neighborhood: field(input.neighborhood || '', 100, 'bairro'), description: field(input.description, 1800, 'descrição', 20), website, capacity: category.type === 'space' ? capacity : 0, amenities: category.type === 'space' ? [...new Set(features)] : [] }
}
export function validatePhotos(photos) {
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > 6) fail('Envie de uma a seis fotos.')
  let total = 0
  return photos.map(photo => {
    if (typeof photo !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)) fail('As fotos devem estar no formato JPEG.')
    const data = Buffer.from(photo.slice(photo.indexOf(',') + 1), 'base64')
    total += data.length
    if (data.length < 100 || data.length > 100000 || total > 600000 || data[0] !== 0xff || data[1] !== 0xd8 || data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) fail('Foto inválida ou acima do limite. Selecione novamente.')
    return { data, contentType: 'image/jpeg' }
  })
}
export function publicCatalog(row) {
  return { id: row.id, name: row.name, type: row.type, category: row.category, city: row.city, state: row.state, neighborhood: row.neighborhood, description: row.description, phone: row.phone, website: row.website, capacity: row.capacity, amenities: row.amenities || [], photos: Array.from({ length: row.photoCount || 0 }, (_, n) => `/api/catalog/photos/${row.id}/${n}`) }
}
const escaped = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function catalogFilter(query) {
  const filter = { status: 'published' }
  for (const key of ['q', 'city', 'type', 'category', 'amenities', 'state']) if (query[key] !== undefined && (typeof query[key] !== 'string' || query[key].length > 100)) fail('Filtro inválido.')
  if (query.type && !['space', 'supplier'].includes(query.type)) fail('Tipo inválido.')
  if (query.type) filter.type = query.type
  if (query.category) {
    if (!categories.some(c => c.id === query.category)) fail('Categoria inválida.')
    filter.category = query.category
  }
  if (query.state) filter.state = query.state.toUpperCase()
  if (query.city) filter.city = { $regex: escaped(query.city), $options: 'i' }
  if (query.q) filter.$or = ['name', 'description', 'neighborhood'].map(key => ({ [key]: { $regex: escaped(query.q), $options: 'i' } }))
  if (query.amenities) {
    const values = query.amenities.split(',')
    if (values.some(v => !amenities.some(a => a.id === v))) fail('Estrutura inválida.')
    filter.amenities = { $all: values }
  }
  return filter
}
export function catalogReviewFilter() {
  return { $or: [{ status: 'pending' }, { status: 'published', reviewStatus: 'new' }] }
}
export function installCatalog({ app, mongoose, requireMaster, writeLimiter, logAction }) {
  const photoSchema = new mongoose.Schema({ data: Buffer, contentType: String }, { _id: false })
  const Entry = mongoose.model('CatalogEntry', new mongoose.Schema({
    id: { type: String, unique: true, required: true }, name: String, ownerName: String, email: String, phone: String, category: String, type: String, city: String, state: String, neighborhood: String, description: String, website: String, capacity: Number, amenities: [String], photoCount: Number,
    photos: { type: [photoSchema], select: false }, status: { type: String, enum: ['pending', 'published', 'hidden', 'rejected'], default: 'published' }, reviewStatus: { type: String, enum: ['new', 'reviewed'], default: 'new' }, reviewedAt: Date, moderationNote: String, consentAt: Date, consentVersion: String, publishedAt: Date,
  }, { timestamps: true }).index({ status: 1, type: 1, createdAt: -1 }).index({ reviewStatus: 1, status: 1, createdAt: -1 }))
  const readLimit = rateLimit({ windowMs: 60000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Muitas consultas. Tente novamente em um minuto.' } })
  const submitLimit = rateLimit({ windowMs: 3600000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Limite de cadastros atingido. Tente mais tarde.' } })
  const route = fn => async (req, res, next) => { try { await fn(req, res) } catch (error) { next(error) } }
  app.use('/api/catalog', readLimit, (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  app.get('/api/catalog/meta', (_req, res) => res.json({ categories, amenities }))
  app.get('/api/catalog', route(async (req, res) => {
    const filter = catalogFilter(req.query)
    const page = Number(req.query.page || 1)
    if (!Number.isInteger(page) || page < 1 || page > 1000) fail('Página inválida.')
    const rows = await Entry.find(filter).sort({ publishedAt: -1, id: 1 }).skip((page - 1) * 24).limit(25).lean()
    res.json({ entries: rows.slice(0, 24).map(publicCatalog), hasMore: rows.length > 24, page })
  }))
  app.get('/api/catalog/entries/:id', route(async (req, res) => {
    const row = await Entry.findOne({ id: req.params.id, status: 'published' }).lean()
    if (!row) return res.status(404).json({ error: 'Negócio não encontrado.' })
    res.json(publicCatalog(row))
  }))
  async function photo(req, res, admin = false) {
    const index = Number(req.params.index)
    if (!Number.isInteger(index) || index < 0 || index > 5) return res.sendStatus(404)
    const row = await Entry.findOne({ id: req.params.id, ...(admin ? {} : { status: 'published' }) }).select('+photos').lean()
    const item = row?.photos?.[index]
    if (!item) return res.sendStatus(404)
    res.type('image/jpeg').send(Buffer.isBuffer(item.data) ? item.data : Buffer.from(item.data.buffer))
  }
  app.get('/api/catalog/photos/:id/:index', route((req, res) => photo(req, res)))
  app.post('/api/catalog/submissions', submitLimit, route(async (req, res) => {
    const fields = validateCatalog(req.body, { submission: true })
    const photos = validatePhotos(req.body.photos)
    await Entry.create({ ...fields, id: crypto.randomUUID(), photos, photoCount: photos.length, status: 'published', reviewStatus: 'new', publishedAt: new Date(), consentAt: new Date(), consentVersion: 'catalog-2026-10-04' })
    res.status(201).json({ ok: true, message: 'Seu anúncio já está publicado no catálogo! Nossa equipe poderá revisá-lo e solicitar ajustes ou retirá-lo se houver inconsistências.' })
  }))
  app.get('/api/master/catalog/notifications', requireMaster, route(async (_req, res) => {
    const filter = catalogReviewFilter()
    const [count, rows] = await Promise.all([Entry.countDocuments(filter), Entry.find(filter).sort({ createdAt: -1, id: 1 }).limit(5).lean()])
    res.json({ count, entries: rows.map(row => ({ id: row.id, name: row.name, type: row.type, city: row.city, state: row.state, status: row.status, createdAt: row.createdAt })) })
  }))
  app.get('/api/master/catalog/meta', requireMaster, (_req, res) => res.json({ categories, amenities }))
  app.get('/api/master/catalog', requireMaster, route(async (req, res) => {
    const status = req.query.status || 'review'
    if (!['review', 'pending', 'published', 'hidden', 'rejected'].includes(status)) fail('Status inválido.')
    const page = Number(req.query.page || 1)
    if (!Number.isInteger(page) || page < 1 || page > 1000) fail('Página inválida.')
    const rows = await Entry.find(status === 'review' ? catalogReviewFilter() : { status }).sort({ createdAt: -1, id: 1 }).skip((page - 1) * 30).limit(31).lean()
    res.json({ entries: rows.slice(0, 30).map(row => ({ ...publicCatalog(row), ownerName: row.ownerName, email: row.email, status: row.status, reviewStatus: row.reviewStatus || (row.status === 'pending' ? 'new' : 'reviewed'), moderationNote: row.moderationNote || '', createdAt: row.createdAt, consentAt: row.consentAt, photos: Array.from({ length: row.photoCount || 0 }, (_, n) => `/api/master/catalog/photos/${row.id}/${n}`) })), hasMore: rows.length > 30 })
  }))
  app.get('/api/master/catalog/entries/:id', requireMaster, route(async (req, res) => {
    const row = await Entry.findOne({ id: req.params.id }).lean()
    if (!row) return res.status(404).json({ error: 'Cadastro não encontrado.' })
    res.json({ ...publicCatalog(row), ownerName: row.ownerName, email: row.email, status: row.status, reviewStatus: row.reviewStatus || (row.status === 'pending' ? 'new' : 'reviewed'), moderationNote: row.moderationNote || '', consentAt: row.consentAt, photos: Array.from({ length: row.photoCount || 0 }, (_, n) => `/api/master/catalog/photos/${row.id}/${n}`) })
  }))
  app.get('/api/master/catalog/photos/:id/:index', requireMaster, route((req, res) => photo(req, res, true)))
  app.put('/api/master/catalog/:id', requireMaster, writeLimiter, route(async (req, res) => {
    const fields = validateCatalog(req.body)
    if (!['pending', 'published', 'hidden', 'rejected'].includes(req.body.status)) fail('Status inválido.')
    const moderationNote = field(req.body.moderationNote || '', 1000, 'observação interna')
    if (req.body.status === 'rejected' && !moderationNote) fail('Informe o motivo da recusa.')
    const row = await Entry.findOneAndUpdate({ id: req.params.id }, { $set: { ...fields, status: req.body.status, reviewStatus: req.body.status === 'pending' ? 'new' : 'reviewed', reviewedAt: req.body.status === 'pending' ? null : new Date(), moderationNote, ...(req.body.status === 'published' ? { publishedAt: new Date() } : {}) } }, { new: true, runValidators: true }).lean()
    if (!row) return res.status(404).json({ error: 'Cadastro não encontrado.' })
    await logAction('catalog.updated', 'Cadastro do catálogo atualizado.', null, { catalogId: row.id, status: row.status })
    res.json({ ok: true })
  }))
  return Entry
}
