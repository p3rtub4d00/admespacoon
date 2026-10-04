import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { once } from 'node:events'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { validateCatalog, validatePhotos, publicCatalog, catalogFilter } from '../server/catalog.js'
process.env.JWT_SECRET = 'catalog-test-secret-with-at-least-32-characters'
process.env.MASTER_PASSWORD = 'catalog-test-password'
delete process.env.MONGODB_URI
const { app } = await import('../server/index.js')
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
after(() => new Promise(resolve => server.close(resolve)))
const base = 'http://127.0.0.1:' + server.address().port
const Entry = mongoose.model('CatalogEntry'), Club = mongoose.model('Club'), Payment = mongoose.model('MasterPayment'), Log = mongoose.model('AuditLog')
const auth = { Cookie: 'espacoon_master=' + jwt.sign({ role: 'master' }, process.env.JWT_SECRET) }
const input = { name: 'Clube de Teste', ownerName: 'Dono do Clube', email: 'dono@example.com', phone: '(69) 99999-0000', category: 'clube', city: 'Porto Velho', state: 'ro', description: 'Espaço com piscina e churrasqueira para festas.', amenities: ['piscina', 'quarto'], website: 'https://demo.rubli.com.br', consent: true }
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
test('free signup creates a pending entry only; public reads and photos hide it until master approval', async t => {
  let stored
  t.mock.method(Entry, 'create', async value => { stored = value; return value })
  t.mock.method(Club, 'create', async () => assert.fail('No paid club should be created'))
  t.mock.method(Payment, 'create', async () => assert.fail('No payment should be created'))
  t.mock.method(Log, 'create', async () => ({}))
  const result = await req('/api/catalog/submissions', { ...input, photos: [photo], status: 'published' }, {}, 'POST')
  assert.equal(result.status, 201); assert.equal(stored.status, 'pending'); assert.ok(stored.consentAt instanceof Date); assert.equal(stored.photoCount, 1)
  assert.equal((await result.json()).id, undefined)
  assert.equal((await req('/api/master/catalog')).status, 401)
  assert.equal((await req('/api/master/catalog/' + stored.id, input, {}, 'PUT')).status, 401)
  t.mock.method(Entry, 'findOne', filter => ({ select() { return this }, async lean() { return filter.status && stored.status !== filter.status ? null : stored } }))
  assert.equal((await req('/api/catalog/entries/' + stored.id)).status, 404)
  assert.equal((await req('/api/catalog/photos/' + stored.id + '/0')).status, 404)
  const privatePhoto = await req('/api/master/catalog/photos/' + stored.id + '/0', null, auth); assert.equal(privatePhoto.status, 200); assert.equal(Buffer.from(await privatePhoto.arrayBuffer()).equals(bytes), true)
  t.mock.method(Entry, 'findOneAndUpdate', (_filter, update) => ({ lean: async () => { stored = { ...stored, ...update.$set }; return stored } }))
  assert.equal((await req('/api/master/catalog/' + stored.id, { ...input, status: 'published' }, auth, 'PUT')).status, 200)
  const detail = await req('/api/catalog/entries/' + stored.id); assert.equal(detail.status, 200); assert.equal((await detail.json()).email, undefined)
  assert.equal((await req('/api/catalog/photos/' + stored.id + '/0')).status, 200)
  assert.equal((await req('/api/master/catalog/' + stored.id, { ...input, status: 'hidden' }, auth, 'PUT')).status, 200)
  assert.equal((await req('/api/catalog/entries/' + stored.id)).status, 404); assert.equal((await req('/api/catalog/photos/' + stored.id + '/0')).status, 404)
})
