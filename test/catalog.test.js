import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { once } from 'node:events'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { validateCatalog, validatePhotos, publicCatalog, catalogFilter, catalogReviewFilter } from '../server/catalog.js'
process.env.JWT_SECRET = 'catalog-test-secret-with-at-least-32-characters'
process.env.MASTER_PASSWORD = 'catalog-test-password'
delete process.env.MONGODB_URI
const { app } = await import('../server/index.js')
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
after(() => new Promise(resolve => server.close(resolve)))
const base = 'http://127.0.0.1:' + server.address().port
const Access = mongoose.model('CatalogAccessRequest')
const Entry = mongoose.model('CatalogEntry'), Club = mongoose.model('Club'), Payment = mongoose.model('MasterPayment'), Log = mongoose.model('AuditLog')
const auth = { Cookie: 'espacoon_master=' + jwt.sign({ role: 'master' }, process.env.JWT_SECRET) }
const input = { customAmenities: ['Som ambiente'], instagram: '@Clube.Teste_pvh', name: 'Clube de Teste', ownerName: 'Dono do Clube', email: 'dono@example.com', phone: '(69) 99999-0000', category: 'clube', city: 'Porto Velho', state: 'ro', description: 'Espaço com piscina e churrasqueira para festas.', amenities: ['piscina', 'quarto'], website: 'https://demo.rubli.com.br', consent: true }
const bytes = Buffer.alloc(120, 4); bytes[0] = 255; bytes[1] = 216; bytes[118] = 255; bytes[119] = 217
const photo = 'data:image/jpeg;base64,' + bytes.toString('base64')
const req = (path, body, headers = {}, method = 'GET') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
test('validation enforces consent, contacts, structure and HTTPS; ignores forged billing and status', () => {
  const validated = validateCatalog({ ...input, status: 'published', planPrice: 0, system: { license: 'forged' } }, { submission: true })
  assert.equal(validated.type, 'space'); assert.equal(validated.phone, '69999990000'); assert.equal(validated.state, 'RO'); assert.equal(validated.status, undefined); assert.equal(validated.system, undefined)
  for (const patch of [{ consent: false }, { company: 'spam' }, { phone: { $ne: null } }, { category: 'invalid' }, { state: 'ZZ' }, { website: 'javascript:alert(1)' }, { website: 'https://user:pass@example.com' }, { amenities: ['invalid'] }]) assert.throws(() => validateCatalog({ ...input, ...patch }, { submission: true }))
  const supplier = validateCatalog({ ...input, category: 'buffet' }); assert.equal(supplier.type, 'supplier'); assert.deepEqual(supplier.amenities, [])
})
test('photos cannot contain SVG or remote URLs and have bounded count and bytes', () => {
  assert.equal(validatePhotos([photo])[0].data.equals(bytes), true)
  for (const value of [[], Array(7).fill(photo), ['https://example.com/photo'], ['data:image/svg+xml;base64,ABC'], ['data:image/jpeg;base64,ABC'], [photo + 'garbage']]) assert.throws(() => validatePhotos(value))
  const huge = Buffer.alloc(100001); huge[0] = 255; huge[1] = 216; huge[99999] = 255; huge[100000] = 217
  assert.throws(() => validatePhotos(['data:image/jpeg;base64,' + huge.toString('base64')]))
})
test('search always restricts published entries, escapes regex and combines required amenities', () => {
  const filter = catalogFilter({ q: '.*', city: 'Porto', amenities: 'quarto,piscina', type: 'space' }); assert.equal(filter.status, 'published'); assert.equal(filter.$or[0].name.$regex, '\\.\\*'); assert.deepEqual(filter.amenities, { $all: ['quarto', 'piscina'] })
  assert.throws(() => catalogFilter({ city: { $ne: null } })); assert.throws(() => catalogFilter({ amenities: 'invalid' }))
  const visible = publicCatalog({ ...input, id: 'id', photoCount: 2, status: 'published', moderationNote: 'secret', photos: [{ data: bytes }] })
  for (const key of ['ownerName', 'email', 'status', 'moderationNote', 'consentAt']) assert.equal(visible[key], undefined)
  assert.deepEqual(visible.photos, ['/api/catalog/photos/id/0', '/api/catalog/photos/id/1'])
})
test('free signup publishes immediately; master review clears notifications and rejection hides the entry and photos', async t => {
  let stored
  t.mock.method(Access, 'countDocuments', async () => 0)
  t.mock.method(Entry, 'create', async value => { stored = value; return value })
  t.mock.method(Club, 'create', async () => assert.fail('No paid club should be created'))
  t.mock.method(Payment, 'create', async () => assert.fail('No payment should be created'))
  t.mock.method(Log, 'create', async () => ({}))
  const result = await req('/api/catalog/submissions', { ...input, photos: [photo], status: 'rejected', reviewStatus: 'reviewed' }, {}, 'POST')
  assert.equal(result.status, 201); assert.equal(stored.status, 'published'); assert.equal(stored.instagram, '@clube.teste_pvh'); assert.deepEqual(stored.customAmenities, ['Som ambiente']); assert.equal(stored.reviewStatus, 'new'); assert.ok(stored.publishedAt instanceof Date); assert.ok(stored.consentAt instanceof Date); assert.equal(stored.photoCount, 1)
  assert.equal((await result.json()).id, undefined)
  assert.equal((await req('/api/master/catalog')).status, 401)
  assert.equal((await req('/api/master/catalog/' + stored.id, input, {}, 'PUT')).status, 401)
  t.mock.method(Entry, 'findOne', filter => ({ select() { return this }, async lean() { return filter.status && stored.status !== filter.status ? null : stored } }))
  assert.equal((await req('/api/catalog/entries/' + stored.id)).status, 200)
  assert.equal((await req('/api/catalog/photos/' + stored.id + '/0')).status, 200)
  const needsReview = () => stored.status === 'published' && stored.reviewStatus === 'new'
  t.mock.method(Entry, 'countDocuments', async filter => { assert.deepEqual(filter, catalogReviewFilter()); return needsReview() ? 1 : 0 })
  t.mock.method(Entry, 'find', filter => { assert.deepEqual(filter, catalogReviewFilter()); return { sort() { return this }, limit() { return this }, lean: async () => needsReview() ? [stored] : [] } })
  assert.equal((await req('/api/master/catalog/notifications')).status, 401)
  assert.equal((await req('/api/master/catalog/entries/' + stored.id)).status, 401)
  const notification = await req('/api/master/catalog/notifications', null, auth)
  const inbox = await notification.json(); assert.equal(inbox.count, 1); assert.equal(inbox.entries[0].email, undefined); assert.equal(inbox.entries[0].ownerName, undefined)
  const privatePhoto = await req('/api/master/catalog/photos/' + stored.id + '/0', null, auth); assert.equal(privatePhoto.status, 200); assert.equal(Buffer.from(await privatePhoto.arrayBuffer()).equals(bytes), true)
  t.mock.method(Entry, 'findOneAndUpdate', (_filter, update) => ({ lean: async () => { stored = { ...stored, ...update.$set }; return stored } }))
  assert.equal((await req('/api/master/catalog/' + stored.id, { ...input, status: 'published' }, auth, 'PUT')).status, 200)
  assert.equal(stored.onlineBooking, true)
  const publicBooking = await (await req('/api/catalog/entries/' + stored.id)).json()
  assert.deepEqual(publicBooking.customAmenities, ['Som ambiente']); assert.equal(publicBooking.instagram, '@clube.teste_pvh'); assert.equal(publicBooking.onlineBooking, true); assert.equal(publicBooking.phone, undefined)
  const privateBooking = await (await req('/api/master/catalog/entries/' + stored.id, null, auth)).json()
  assert.equal(privateBooking.phone, stored.phone)
  assert.equal(stored.reviewStatus, 'reviewed'); assert.ok(stored.reviewedAt instanceof Date)
  assert.equal((await (await req('/api/master/catalog/notifications', null, auth)).json()).count, 0)
  const detail = await req('/api/catalog/entries/' + stored.id); assert.equal(detail.status, 200); assert.equal((await detail.json()).email, undefined)
  assert.equal((await req('/api/catalog/photos/' + stored.id + '/0')).status, 200)
  assert.equal((await req('/api/master/catalog/' + stored.id, { ...input, status: 'rejected' }, auth, 'PUT')).status, 400)
  assert.equal(stored.status, 'published')
  assert.equal((await req('/api/master/catalog/' + stored.id, { ...input, status: 'rejected', moderationNote: 'Informações inconsistentes.' }, auth, 'PUT')).status, 200)
  assert.equal(stored.status, 'rejected'); assert.equal(stored.moderationNote, 'Informações inconsistentes.')
  assert.equal((await (await req('/api/master/catalog/notifications', null, auth)).json()).count, 0)
  assert.equal((await req('/api/catalog/entries/' + stored.id)).status, 404); assert.equal((await req('/api/catalog/photos/' + stored.id + '/0')).status, 404)
})

test('notification queue includes old pending entries and new public ads, without notifying about already reviewed or refused entries', () => {
  assert.deepEqual(catalogReviewFilter(), { $or: [{ status: 'pending' }, { status: { $in: ['published', 'hidden', 'rejected'] }, reviewStatus: 'new' }] })
})

test('only master can permanently delete an ad and its photos, with explicit confirmation and audit', async t => {
  let stored = { ...input, id: 'delete-test', status: 'published', reviewStatus: 'new', photos: [{ data: bytes }], photoCount: 1 }
  const audits = []
  t.mock.method(Entry, 'findOneAndDelete', filter => ({ lean: async () => { assert.deepEqual(filter, { id: 'delete-test' }); const row = stored; stored = null; return row } }))
  t.mock.method(Entry, 'findOne', () => ({ select() { return this }, lean: async () => stored }))
  t.mock.method(Log, 'create', async value => { audits.push(value); return value })
  t.mock.method(Club, 'deleteOne', async () => assert.fail('Paid clubs must not be deleted'))
  t.mock.method(Payment, 'deleteOne', async () => assert.fail('Payments must not be deleted'))
  const url = '/api/master/catalog/delete-test'
  assert.equal((await req(url, { confirmation: 'delete-test' }, {}, 'DELETE')).status, 401)
  assert.equal((await req(url, { confirmation: 'wrong' }, auth, 'DELETE')).status, 400)
  assert.ok(stored)
  assert.equal((await req(url, { confirmation: 'delete-test' }, auth, 'DELETE')).status, 200)
  assert.equal(stored, null); assert.equal(audits.length, 1)
  assert.equal((await req('/api/catalog/entries/delete-test')).status, 404)
  assert.equal((await req('/api/catalog/photos/delete-test/0')).status, 404)
  assert.equal((await req('/api/master/catalog/photos/delete-test/0', null, auth)).status, 404)
  assert.equal((await req(url, { confirmation: 'delete-test' }, auth, 'DELETE')).status, 404)
})


test('online reservations require a site, hide public phone, and preserve contacts for suppliers and spaces without booking', () => {
  const online = validateCatalog({ ...input, onlineBooking: true })
  assert.equal(online.onlineBooking, true)
  assert.equal(publicCatalog(online).phone, undefined)
  assert.equal(publicCatalog(online).onlineBooking, true)
  assert.equal(online.phone, '69999990000')
  assert.throws(() => validateCatalog({ ...input, onlineBooking: true, website: '' }))
  assert.throws(() => validateCatalog({ ...input, onlineBooking: 'true' }))
  const offline = validateCatalog({ ...input, onlineBooking: false })
  assert.equal(publicCatalog(offline).phone, '69999990000')
  assert.equal(publicCatalog(offline).onlineBooking, false)
  const supplier = validateCatalog({ ...input, category: 'buffet', onlineBooking: true })
  assert.equal(publicCatalog(supplier).onlineBooking, false)
  assert.equal(publicCatalog(supplier).phone, '69999990000')
  const legacy = { ...online }; delete legacy.onlineBooking
  assert.equal(publicCatalog(legacy).onlineBooking, true)
  assert.equal(publicCatalog(legacy).phone, undefined)
  assert.equal(publicCatalog({ ...legacy, website: '' }).phone, '69999990000')
})


test('Instagram is optional, accepts only an @handle and is exposed without accepting arbitrary links', () => {
  assert.equal(validateCatalog({ ...input, instagram: undefined }).instagram, '')
  assert.equal(validateCatalog({ ...input, instagram: '' }).instagram, '')
  assert.equal(validateCatalog({ ...input, instagram: '  @Clube.Teste_PVH  ' }).instagram, '@clube.teste_pvh')
  assert.equal(publicCatalog(validateCatalog(input)).instagram, '@clube.teste_pvh')
  assert.equal(publicCatalog({ id: 'old' }).instagram, '')
  assert.equal(validateCatalog({ ...input, category: 'buffet' }).instagram, '@clube.teste_pvh')
  for (const instagram of ['https://instagram.com/clube', 'instagram.com/clube', 'clube', '@', '@nome/com', '@nome?x=1', '@nome com', '@' + 'a'.repeat(31), { $ne: null }, 123]) {
    assert.throws(() => validateCatalog({ ...input, instagram }))
  }
})

test('custom structures are bounded, deduplicated, public, and recognized options remain filterable', () => {
  const entry = validateCatalog({ ...input, amenities: ['tv'], customAmenities: ['  Som   ambiente  ', 'som ambiente', 'Forno a lenha', 'AR CONDICIONADO', 'Bebedouro', 'TV'] })
  assert.deepEqual(entry.customAmenities, ['Som ambiente', 'Forno a lenha'])
  assert.ok(entry.amenities.includes('tv')); assert.ok(entry.amenities.includes('arcondicionado')); assert.ok(entry.amenities.includes('bebedouro'))
  assert.equal(entry.amenities.filter(item => item === 'tv').length, 1)
  assert.deepEqual(publicCatalog(entry).customAmenities, ['Som ambiente', 'Forno a lenha'])
  assert.deepEqual(publicCatalog({}).customAmenities, [])
  assert.deepEqual(validateCatalog({ ...input, customAmenities: undefined }).customAmenities, [])
  assert.deepEqual(validateCatalog({ ...input, category: 'buffet', customAmenities: ['Som ambiente'] }).customAmenities, [])
  for (const customAmenities of ['Som ambiente', [{ $ne: null }], [''], ['a'.repeat(61)], Array(21).fill('som')]) assert.throws(() => validateCatalog({ ...input, customAmenities }))
  assert.deepEqual(catalogFilter({ amenities: 'tv,bebedouro,arcondicionado' }).amenities, { $all: ['tv', 'bebedouro', 'arcondicionado'] })
})
