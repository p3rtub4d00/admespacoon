import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { once } from 'node:events'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { registrationTokenHash } from '../server/registration-invites.js'

process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters'
process.env.MASTER_PASSWORD = 'test-only-master-password'
delete process.env.MONGODB_URI
delete process.env.BACKUP_MONGODB_URI
delete process.env.ASAAS_API_KEY
const { app } = await import('../server/index.js')
const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`
after(() => new Promise(resolve => server.close(resolve)))
const Invite = mongoose.model('RegistrationInvite')
const Club = mongoose.model('Club')
const Settings = mongoose.model('MasterSettings')
const Log = mongoose.model('AuditLog')
const auth = { Cookie: `espacoon_master=${jwt.sign({ role: 'master' }, process.env.JWT_SECRET)}` }
const token = 'a'.repeat(43)
const data = { establishmentName: 'Clube Teste', ownerName: 'Responsável Teste', cpfCnpj: '52998224725', phone: '69999990000', city: 'Porto Velho', state: 'ro', email: 'TESTE@example.com' }
const request = (path, body, headers = {}, method = 'POST') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })

test('only the master can issue or list invitations; links contain no PII and only a hash is stored', async t => {
  let saved
  t.mock.method(Invite, 'create', async value => { saved = value; return value })
  assert.equal((await request('/api/master/registration-invites', {})).status, 401)
  assert.equal((await request('/api/master/registration-invites', {}, {}, 'GET')).status, 401)
  assert.equal((await request('/api/master/registration-invites/test', {}, {}, 'DELETE')).status, 401)
  const before = Date.now()
  const response = await request('/api/master/registration-invites', {}, auth)
  assert.equal(response.status, 201)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const result = await response.json()
  const url = new URL(result.url)
  assert.equal(url.pathname, '/cadastro')
  assert.equal(url.search, '')
  const raw = new URLSearchParams(url.hash.slice(1)).get('convite')
  assert.equal(saved.tokenHash, registrationTokenHash(raw))
  assert.equal(JSON.stringify(saved).includes(raw), false)
  assert.ok(new Date(result.expiresAt).getTime() - before >= 24 * 60 * 60 * 1000)
})

test('inspection returns expiry only and rejects malformed, expired, used and revoked links', async t => {
  let lookups = 0
  t.mock.method(Invite, 'findOne', filter => {
    lookups++
    assert.equal(filter.tokenHash, registrationTokenHash(token))
    assert.equal(filter.submittedAt, null)
    assert.equal(filter.revokedAt, null)
    assert.ok(filter.expiresAt.$gt instanceof Date)
    return { lean: async () => lookups === 1 ? { expiresAt: new Date(), registration: data, clubId: 'private', tokenHash: 'private' } : null }
  })
  assert.equal((await request('/api/registration/info', { token: { $ne: null } })).status, 404)
  assert.equal(lookups, 0)
  const response = await request('/api/registration/info', { token })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(Object.keys(await response.json()).sort(), ['expiresAt', 'valid'])
  assert.equal((await request('/api/registration/info', { token })).status, 404)
})

test('public submission is atomic and single-use; excludes master settings and creates no account, charge or credentials', async t => {
  let used = false, saved
  t.mock.method(Invite, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter.submittedAt, null)
    assert.equal(filter.revokedAt, null)
    assert.ok(filter.expiresAt.$gt instanceof Date)
    if (used) return null
    used = true; saved = update.$set
    return { id: 'test' }
  })
  t.mock.method(Club, 'create', async () => { throw new Error('Public caller must not create a club') })
  const body = { ...data, token, privacyAcknowledged: true, demoMode: true, systemUrl: 'https://attacker.example', nextDueDate: '2099-01-01', plan: { price: 0 }, licenseKey: 'injected' }
  const responses = await Promise.all([request('/api/registration/complete', body), request('/api/registration/complete', body)])
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 404])
  assert.deepEqual(saved.registration, { ...data, email: 'teste@example.com', state: 'RO' })
  assert.ok(saved.submittedAt instanceof Date)
  const response = responses.find(r => r.status === 201)
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(Club.create.mock.callCount(), 0)
})

test('invalid input and missing privacy acknowledgement never consume the link', async t => {
  t.mock.method(Invite, 'findOneAndUpdate', async () => { throw new Error('Must not consume link') })
  for (const body of [{ ...data, token }, { ...data, token, privacyAcknowledged: true, phone: '1' }, { ...data, token, privacyAcknowledged: true, ownerName: { $ne: null } }]) {
    assert.equal((await request('/api/registration/complete', body)).status, 400)
  }
  assert.equal(Invite.findOneAndUpdate.mock.callCount(), 0)
})

test('master listing excludes raw tokens, hashes and internal club identifiers', async t => {
  t.mock.method(Invite, 'find', filter => {
    assert.deepEqual(filter, { approvedAt: null, revokedAt: null })
    return { sort: () => ({ limit: () => ({ lean: async () => [{ id: 'invite', submittedAt: new Date(), registration: data, tokenHash: 'private-hash', clubId: 'private-id' }] }) }) }
  })
  const response = await request('/api/master/registration-invites', {}, auth, 'GET')
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result[0].registration.city, 'Porto Velho')
  assert.equal(JSON.stringify(result).includes('private'), false)
})

test('master approval uses a stable unique club ID and applies the master-selected due date, URL and demonstration', async t => {
  let created, approved = false
  t.mock.method(Invite, 'findOne', async filter => { assert.equal(filter.revokedAt, null); return approved ? null : { id: 'invite', clubId: 'CLB-FIXED' } })
  t.mock.method(Invite, 'updateOne', async (filter, update) => { assert.equal(filter.id, 'invite'); assert.ok(update.$set.approvedAt instanceof Date); approved = true })
  t.mock.method(Settings, 'findOne', async () => ({ planName: 'ClubeOn', planPrice: 49.9 }))
  t.mock.method(Club, 'exists', async () => false)
  t.mock.method(Club, 'create', async value => { created = value; return value })
  t.mock.method(Log, 'create', async () => ({}))
  const payload = { ...data, registrationInviteId: 'invite', nextDueDate: '2099-11-10', systemUrl: 'https://club.example', demoMode: true }
  const response = await request('/api/master/clubs', payload, auth)
  assert.equal(response.status, 201)
  assert.equal(created.id, 'CLB-FIXED')
  assert.equal(created.billing.nextDueDate.toISOString().slice(0, 10), '2099-11-10')
  assert.equal(created.system.publicUrl, 'https://club.example')
  assert.equal(created.demoMode, true)
  assert.ok((await response.json()).licenseKey)
  assert.equal((await request('/api/master/clubs', payload, auth)).status, 409)
})
