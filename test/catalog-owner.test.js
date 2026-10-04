import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { once } from 'node:events'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { ownerPhone } from '../server/catalog-owner.js'
process.env.JWT_SECRET = 'catalog-owner-test-secret-with-32-characters'
process.env.MASTER_PASSWORD = 'catalog-owner-test-password'
delete process.env.MONGODB_URI
const { app } = await import('../server/index.js')
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); after(() => new Promise(resolve => server.close(resolve)))
const base = 'http://127.0.0.1:' + server.address().port
const Entry = mongoose.model('CatalogEntry'), Account = mongoose.model('CatalogOwner'), Access = mongoose.model('CatalogAccessRequest'), Log = mongoose.model('AuditLog')
const master = { Cookie: 'espacoon_master=' + jwt.sign({ role: 'master' }, process.env.JWT_SECRET) }
const req = (path, body, headers = {}, method = 'GET') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
const chain = value => ({ select() { return this }, sort() { return this }, skip() { return this }, limit() { return this }, lean: async () => value })
const bytes = Buffer.alloc(120, 4); bytes[0] = 255; bytes[1] = 216; bytes[118] = 255; bytes[119] = 217
const listing = { id: 'owner-ad', name: 'Clube do Dono', ownerName: 'Dono Teste', phone: '69999990001', category: 'clube', type: 'space', city: 'Porto Velho', state: 'RO', description: 'Clube com piscina e churrasqueira para festas.', amenities: ['piscina'], status: 'published', photoCount: 1, photos: [{ data: bytes, contentType: 'image/jpeg' }] }
test('phone normalizes country code and rejects query objects', () => { assert.equal(ownerPhone('+55 (69) 99999-0001'), '69999990001'); assert.throws(() => ownerPhone({ $ne: null })) })
test('request is generic, deduplicated, goes only to registered phone, and master issue stores no raw token', async t => {
  let pending = null, account = null, stored = { ...listing }; const actions = []
  t.mock.method(Entry, 'exists', async filter => filter.phone === listing.phone)
  t.mock.method(Access, 'updateOne', async (filter, update) => { if (update.$setOnInsert && !pending) pending = { ...update.$setOnInsert }; return {} })
  t.mock.method(Access, 'findOne', filter => chain(pending && filter.id === pending.id && pending.status === 'pending' ? pending : null))
  t.mock.method(Access, 'findOneAndUpdate', (_filter, update) => { if (!pending || pending.status !== 'pending') return chain(null); pending = { ...pending, ...update.$set }; return chain(pending) })
  t.mock.method(Account, 'findOneAndUpdate', (_filter, update) => { account ||= { ...update.$setOnInsert }; return chain(account) })
  t.mock.method(Account, 'updateOne', async (_filter, update) => { Object.assign(account, update.$set); return {} })
  t.mock.method(Entry, 'find', filter => chain(filter.phone === listing.phone && filter.id.$in.includes(stored.id) ? [stored] : []))
  t.mock.method(Entry, 'updateMany', async (_filter, update) => { Object.assign(stored, update.$set); return { matchedCount: 1 } })
  t.mock.method(Log, 'create', async value => { actions.push(value); return value })
  const a = await req('/api/catalog/owner/access-request', { phone: listing.phone }, {}, 'POST'); assert.equal(a.status, 200)
  const id = pending.id; await req('/api/catalog/owner/access-request', { phone: listing.phone }, {}, 'POST'); assert.equal(pending.id, id)
  const b = await req('/api/catalog/owner/access-request', { phone: '69999990002' }, {}, 'POST'); assert.deepEqual(await a.json(), await b.json()); assert.equal(pending.phone, listing.phone)
  const url = '/api/master/catalog/access-requests/' + id + '/issue'
  assert.equal((await req(url, { entryIds: [listing.id] }, {}, 'POST')).status, 401)
  assert.equal((await req(url, { entryIds: ['other-ad'] }, master, 'POST')).status, 400); assert.equal(pending.status, 'pending')
  const issued = await req(url, { entryIds: [listing.id] }, master, 'POST'); assert.equal(issued.status, 200)
  const data = await issued.json(); const token = new URL(data.url).hash.slice(8)
  assert.match(token, /^[a-f0-9]{64}$/); assert.notEqual(account.inviteHash, token); assert.equal(account.inviteHash.length, 64); assert.equal(stored.ownerId, account.id)
  assert.ok(data.whatsappUrl.startsWith('https://wa.me/55' + listing.phone + '?')); assert.ok(decodeURIComponent(data.whatsappUrl).includes(data.url)); assert.equal(pending.status, 'issued'); assert.ok(account.inviteExpiresAt > new Date())
  assert.ok(!JSON.stringify(actions).includes(token)); assert.equal((await req(url, { entryIds: [listing.id] }, master, 'POST')).status, 404)
})
test('activation is single-use, hashes password, resets sessions, and login never returns password', async t => {
  const token = 'a'.repeat(64); let account = { id: 'owner-account', phone: listing.phone, version: 0, inviteHash: (await import('node:crypto')).createHash('sha256').update(token).digest('hex'), inviteExpiresAt: new Date(Date.now() + 60000) }
  t.mock.method(Account, 'findOneAndUpdate', (filter, update) => { if (filter.inviteHash !== account.inviteHash || !account.inviteExpiresAt || account.inviteExpiresAt <= new Date()) return chain(null); Object.assign(account, update.$set); delete account.inviteHash; delete account.inviteExpiresAt; account.version++; return chain(account) })
  t.mock.method(Account, 'findOne', filter => chain(filter.phone ? filter.phone === account.phone ? account : null : filter.id === account.id && filter.version === account.version ? account : null))
  assert.equal((await req('/api/catalog/owner/activate', { token, password: 'short' }, {}, 'POST')).status, 400)
  const activated = await req('/api/catalog/owner/activate', { token, password: 'SenhaSegura123' }, {}, 'POST'); assert.equal(activated.status, 200); const data = await activated.json()
  assert.notEqual(account.passwordHash, 'SenhaSegura123'); assert.equal(account.version, 1); assert.equal(data.passwordHash, undefined)
  assert.equal((await req('/api/catalog/owner/activate', { token, password: 'SenhaSegura123' }, {}, 'POST')).status, 400)
  assert.equal((await req('/api/catalog/owner/login', { phone: listing.phone, password: 'incorreta' }, {}, 'POST')).status, 401)
  const login = await req('/api/catalog/owner/login', { phone: listing.phone, password: 'SenhaSegura123' }, {}, 'POST'); assert.equal(login.status, 200)
  const session = { 'x-catalog-owner-session': (await login.json()).sessionToken }
  assert.equal((await req('/api/catalog/owner/session', null, session)).status, 200)
  assert.equal((await req('/api/catalog/owner/session', null, master)).status, 401)
  account.version++
  assert.equal((await req('/api/catalog/owner/session', null, session)).status, 401)
})
test('owner cannot read, edit or delete another owner ad; photo edits preserve moderation and notify master', async t => {
  const account = { id: 'owner-isolation', phone: listing.phone, version: 1 }; let stored = { ...listing, ownerId: account.id, status: 'rejected', reviewStatus: 'reviewed' }
  const session = { 'x-catalog-owner-session': jwt.sign({ role: 'catalog-owner', sub: account.id, version: 1 }, process.env.JWT_SECRET, { audience: 'catalog-owner', issuer: 'clubeon-master', expiresIn: '1h' }) }
  t.mock.method(Account, 'findOne', filter => chain(filter.id === account.id && filter.version === 1 ? account : null))
  t.mock.method(Entry, 'find', filter => { assert.equal(filter.ownerId, account.id); return chain(stored ? [stored] : []) })
  t.mock.method(Entry, 'findOne', filter => chain(stored && filter.id === stored.id && filter.ownerId === account.id ? stored : null))
  t.mock.method(Entry, 'findOneAndUpdate', (filter, update) => { assert.equal(filter.ownerId, account.id); stored = { ...stored, ...update.$set }; return chain(stored) })
  t.mock.method(Entry, 'findOneAndDelete', filter => { assert.equal(filter.ownerId, account.id); const row = stored && filter.id === stored.id ? stored : null; if (row) stored = null; return chain(row) })
  t.mock.method(Log, 'create', async () => ({}))
  const list = await req('/api/catalog/owner/entries', null, session); assert.equal(list.status, 200); const entries = (await list.json()).entries; assert.equal(entries[0].photos[0], '/api/catalog/owner/photos/owner-ad/0')
  for (const [method, path, body] of [['GET', '/api/catalog/owner/photos/other-ad/0'], ['PUT', '/api/catalog/owner/entries/other-ad', listing], ['DELETE', '/api/catalog/owner/entries/other-ad', { confirmation: 'other-ad' }]]) assert.equal((await req(path, body, session, method)).status, 404)
  assert.equal((await req('/api/catalog/owner/entries/' + stored.id, { ...listing, name: 'Clube atualizado', phone: '69999990009', status: 'published', ownerId: 'forged', photos: [{ existing: 0 }] }, session, 'PUT')).status, 200)
  assert.equal(stored.name, 'Clube atualizado'); assert.equal(stored.phone, listing.phone); assert.equal(stored.status, 'rejected'); assert.equal(stored.ownerId, account.id); assert.equal(stored.reviewStatus, 'new'); assert.ok(stored.photos[0].data.equals(bytes))
  const photo = 'data:image/jpeg;base64,' + bytes.toString('base64')
  assert.equal((await req('/api/catalog/owner/entries/' + stored.id, { ...listing, photos: [photo] }, session, 'PUT')).status, 200)
  assert.equal((await req('/api/catalog/owner/entries/' + stored.id, { ...listing, photos: [] }, session, 'PUT')).status, 400)
  assert.equal((await req('/api/catalog/owner/entries/' + stored.id, { confirmation: 'wrong' }, session, 'DELETE')).status, 400)
  assert.equal((await req('/api/catalog/owner/entries/' + stored.id, { confirmation: stored.id }, session, 'DELETE')).status, 200); assert.equal(stored, null)
})

test('access requests push to enabled Master devices once, reopen with a new alert, and survive delivery failures', async t => {
  const webpush = (await import('web-push')).default
  const keys = webpush.generateVAPIDKeys()
  const PushConfig = mongoose.model('MasterPushConfig'), PushSubscription = mongoose.model('MasterPushSubscription')
  const phone = '69999990003', alerts = [], updates = [], warnings = []
  let pending, failPush = false
  t.mock.method(Entry, 'exists', async filter => filter.phone === phone)
  t.mock.method(Access, 'updateOne', async (filter, update) => {
    if (update.$setOnInsert) {
      if (pending) return { upsertedCount: 0 }
      pending = { ...update.$setOnInsert }; return { upsertedCount: 1 }
    }
    if (pending && pending.status !== 'pending' && pending.requestedAt < filter.requestedAt.$lt) {
      Object.assign(pending, update.$set); return { modifiedCount: 1 }
    }
    return { modifiedCount: 0 }
  })
  t.mock.method(PushConfig, 'findOne', () => chain(keys))
  t.mock.method(PushSubscription, 'find', query => {
    assert.deepEqual(query, { enabled: true })
    return chain([{ endpoint: 'https://push.example.com/device', keys: { p256dh: 'key', auth: 'auth' } }])
  })
  t.mock.method(PushSubscription, 'updateOne', async (_filter, update) => { updates.push(update); return {} })
  t.mock.method(webpush, 'sendNotification', async (subscription, serialized) => {
    assert.equal(subscription.endpoint, 'https://push.example.com/device')
    alerts.push(JSON.parse(serialized))
    if (failPush) throw Object.assign(new Error('Temporary delivery failure'), { statusCode: 503 })
  })
  t.mock.method(console, 'warn', (...args) => warnings.push(args))
  const submit = async value => {
    const response = await req('/api/catalog/owner/access-request', { phone: value }, {}, 'POST')
    assert.equal(response.status, 200)
    await new Promise(resolve => setTimeout(resolve, 10))
    return response.json()
  }
  const generic = await submit(phone)
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].url, '/?view=notifications')
  assert.match(alerts[0].title, /pedido de acesso/)
  assert.ok(!JSON.stringify(alerts).includes(phone))
  assert.equal(updates.length, 1)
  await Promise.all([submit(phone), submit(phone)])
  assert.equal(alerts.length, 1)
  assert.deepEqual(await submit('69999990004'), generic)
  assert.equal(alerts.length, 1)
  pending.status = 'issued'; pending.requestedAt = new Date(Date.now() - 11 * 60000)
  await submit(phone)
  assert.equal(alerts.length, 2); assert.equal(pending.status, 'pending')
  assert.notEqual(alerts[0].tag, alerts[1].tag)
  pending.status = 'dismissed'; pending.requestedAt = new Date()
  await submit(phone)
  assert.equal(alerts.length, 2); assert.equal(pending.status, 'dismissed')
  failPush = true; pending.requestedAt = new Date(Date.now() - 11 * 60000)
  await submit(phone)
  assert.equal(alerts.length, 3); assert.equal(pending.status, 'pending')
  assert.ok(warnings.length > 0); assert.ok(updates.at(-1).$set.lastErrorAt)
})
