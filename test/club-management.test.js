import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { once } from 'node:events'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { parseDueDate, nextDueDateFromDay } from '../server/billing-dates.js'

process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters'
process.env.MASTER_PASSWORD = 'test-only-master-password'
process.env.ASAAS_API_KEY = 'fake-test-key'
delete process.env.MONGODB_URI
delete process.env.BACKUP_MONGODB_URI
const { app, validateClubInput } = await import('../server/index.js')
const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`
after(() => new Promise(resolve => server.close(resolve)))
const Club = mongoose.model('Club')
const auth = { Cookie: `espacoon_master=${jwt.sign({ role: 'master' }, process.env.JWT_SECRET)}` }
const request = (path, method, body, authorized = true) => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', ...(authorized ? auth : {}) }, body: JSON.stringify(body),
})
const fixture = (overrides = {}) => ({
  id: 'CLB-TEST', establishmentName: 'Clube Teste', ownerName: 'Responsável Teste', phone: '69999999999',
  demoMode: true, plan: { price: 49.9 }, adminAuth: {}, payments: {},
  billing: { dueDay: 10, nextDueDate: new Date('2099-01-10T12:00:00Z'), status: 'active' },
  system: { status: 'active' }, licenseKeyHash: 'old-license', save: async () => {}, ...overrides,
})
function mockWrites(t) {
  t.mock.method(mongoose.model('AuditLog'), 'create', async () => ({}))
  t.mock.method(mongoose.model('AdminAccessToken'), 'deleteMany', async () => ({}))
  t.mock.method(mongoose.model('MercadoPagoOAuthAttempt'), 'deleteMany', async () => ({}))
}

test('full date preserves selected month/year and rejects invalid dates; old day payload remains compatible', () => {
  const body = { establishmentName: 'Clube', ownerName: 'Responsável', phone: '69999999999', nextDueDate: '2099-12-31' }
  const input = validateClubInput(body)
  assert.equal(input.nextDueDate.toISOString(), '2099-12-31T12:00:00.000Z')
  assert.equal(input.dueDay, 31)
  assert.equal(validateClubInput({ ...body, nextDueDate: undefined, dueDay: 10 }).dueDay, 10)
  for (const date of ['2099-02-29', '2099-04-31', '', '31/12/2099', null]) assert.throws(() => parseDueDate(date), { statusCode: 400 })
  assert.equal(nextDueDateFromDay(31, new Date('2028-02-01T12:00:00Z')).toISOString().slice(0, 10), '2028-02-29')
  assert.equal(nextDueDateFromDay(31, new Date('2027-02-28T12:00:01Z')).toISOString().slice(0, 10), '2027-03-31')
})

test('create stores chosen distant month instead of calculating the next day', async t => {
  let created
  mockWrites(t)
  t.mock.method(mongoose.model('MasterSettings'), 'findOne', async () => ({ planName: 'EspaçoOn', planPrice: 49.9 }))
  t.mock.method(Club, 'exists', async () => false)
  t.mock.method(Club, 'create', async data => { created = fixture(data); return created })
  const response = await request('/api/master/clubs', 'POST', { establishmentName: 'Clube', ownerName: 'Responsável', phone: '69999999999', nextDueDate: '2099-12-31', demoMode: true })
  assert.equal(response.status, 201)
  assert.equal(created.billing.nextDueDate.toISOString().slice(0, 10), '2099-12-31')
  assert.equal(created.billing.dueDay, 31)
})

test('editing only month with same day changes due date and rejects a newly selected past date', async t => {
  const club = fixture()
  mockWrites(t)
  t.mock.method(Club, 'findOne', async () => club)
  let response = await request('/api/master/clubs/CLB-TEST', 'PATCH', { nextDueDate: '2099-11-10' })
  assert.equal(response.status, 200)
  assert.equal(club.billing.nextDueDate.toISOString().slice(0, 10), '2099-11-10')
  response = await request('/api/master/clubs/CLB-TEST', 'PATCH', { nextDueDate: '2001-11-10' })
  assert.equal(response.status, 400)
  assert.equal(club.billing.nextDueDate.toISOString().slice(0, 10), '2099-11-10')
})

test('deletion requires authentication, exact confirmation and an inactive or demonstration club', async t => {
  let saves = 0
  const club = fixture({ demoMode: false, save: async () => { saves++ } })
  t.mock.method(Club, 'findOne', async () => club)
  assert.equal((await request('/api/master/clubs/CLB-TEST', 'DELETE', { confirmation: club.id }, false)).status, 401)
  assert.equal((await request('/api/master/clubs/CLB-TEST', 'DELETE', { confirmation: 'wrong' })).status, 400)
  assert.equal((await request('/api/master/clubs/CLB-TEST', 'DELETE', { confirmation: club.id })).status, 409)
  assert.equal(saves, 0)
})

test('deletion revokes keys, temporary unlock, tokens and credentials without erasing financial records', async t => {
  const club = fixture()
  club.system.temporaryUnlockUntil = new Date('2099-01-01')
  club.adminAuth = { passwordHash: 'secret' }
  club.payments = { mercadoPago: { accessTokenEncrypted: 'secret' } }
  mockWrites(t)
  t.mock.method(mongoose.model('MasterPayment'), 'deleteMany', () => { throw new Error('Financial history must not be erased') })
  t.mock.method(Club, 'findOne', async () => club)
  const response = await request('/api/master/clubs/CLB-TEST', 'DELETE', { confirmation: club.id })
  assert.equal(response.status, 200)
  assert.ok(club.deletedAt instanceof Date)
  assert.equal(club.system.status, 'cancelled')
  assert.equal(club.billing.status, 'cancelled')
  assert.equal(club.system.temporaryUnlockUntil, null)
  assert.notEqual(club.licenseKeyHash, 'old-license')
  assert.equal(club.adminAuth.passwordHash, undefined)
  assert.equal(club.payments.mercadoPago.accessTokenEncrypted, undefined)
})

test('provider failure keeps club visible; successful cancellation precedes exclusion', async t => {
  const club = fixture({ demoMode: false, system: { status: 'suspended' } })
  club.billing.asaasSubscriptionId = 'sub_test'
  let saves = 0
  club.save = async () => { saves++ }
  mockWrites(t)
  t.mock.method(Club, 'findOne', async () => club)
  const originalFetch = globalThis.fetch
  let fail = true
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith(base)) return originalFetch(url, options)
    assert.ok(String(url).endsWith('/subscriptions/sub_test'))
    assert.equal(options.method, 'DELETE')
    assert.equal(saves, 0)
    return new Response(JSON.stringify(fail ? { errors: [{ description: 'Provider unavailable' }] } : { deleted: true }), { status: fail ? 500 : 200 })
  })
  assert.equal((await request('/api/master/clubs/CLB-TEST', 'DELETE', { confirmation: club.id })).status, 502)
  assert.equal(saves, 0)
  assert.equal(club.deletedAt, undefined)
  fail = false
  assert.equal((await request('/api/master/clubs/CLB-TEST', 'DELETE', { confirmation: club.id })).status, 200)
  assert.equal(saves, 1)
})

test('query middleware hides excluded clubs for list, credentials, license and webhook lookups; history explicitly opts in', async () => {
  for (const operation of ['find', 'findOne', 'findOneAndUpdate']) {
    const query = Club[operation]({ id: 'CLB-TEST' })
    await new Promise((resolve, reject) => Club.schema.s.hooks.execPre(operation, query, error => error ? reject(error) : resolve()))
    assert.equal(query.getFilter().deletedAt, null)
  }
  const query = Club.find().setOptions({ includeDeleted: true })
  await new Promise((resolve, reject) => Club.schema.s.hooks.execPre('find', query, error => error ? reject(error) : resolve()))
  assert.equal(Object.hasOwn(query.getFilter(), 'deletedAt'), false)
  assert.equal(Object.hasOwn(query.getOptions(), 'includeDeleted'), false)
})

test('real subscription receives the exact month selected when only month changes', async t => {
  const club = fixture({ demoMode: false })
  club.billing.asaasSubscriptionId = 'sub_test'
  mockWrites(t)
  t.mock.method(Club, 'findOne', async () => club)
  const originalFetch = globalThis.fetch
  let changed = false
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith(base)) return originalFetch(url, options)
    if (options.method === 'PUT') {
      assert.ok(String(url).endsWith('/subscriptions/sub_test'))
      assert.equal(JSON.parse(options.body).nextDueDate, '2099-11-10')
      changed = true
      return new Response('{}', { status: 200 })
    }
    assert.ok(String(url).endsWith('/subscriptions/sub_test/payments'))
    return new Response('{"data":[]}', { status: 200 })
  })
  assert.equal((await request('/api/master/clubs/CLB-TEST', 'PATCH', { nextDueDate: '2099-11-10' })).status, 200)
  assert.equal(changed, true)
  assert.equal(club.billing.nextDueDate.toISOString().slice(0, 10), '2099-11-10')
})
