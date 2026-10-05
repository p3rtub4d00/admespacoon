import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateAiChat, validateChatUsage } from '../server/ai-chat.js'
test('AI activation requires an explicit boolean and bounded integer limit', () => {
  assert.deepEqual(validateAiChat({ enabled: false, monthlyLimit: 1000 }), { enabled: false, monthlyLimit: 1000 })
  for (const value of [{ enabled: 'true', monthlyLimit: 10 }, { enabled: true, monthlyLimit: 0 }, { enabled: true, monthlyLimit: 100001 }, { enabled: true, monthlyLimit: 1.2 }]) assert.throws(() => validateAiChat(value))
})
test('usage accepts only aggregate counts and a valid month', () => {
  const good = { month: '2026-10', attempts: 1, calls: 2, inputTokens: 500, outputTokens: 100, totalTokens: 600 }
  assert.equal(validateChatUsage(good).totalTokens, 600)
  assert.throws(() => validateChatUsage({ ...good, month: '2026-13' }))
  assert.throws(() => validateChatUsage({ ...good, calls: -1 }))
  assert.throws(() => validateChatUsage({ ...good, totalTokens: '600' }))
})

import express from 'express'
import { once } from 'node:events'
import { after } from 'node:test'
import { installMasterAiChat } from '../server/ai-chat.js'
const club = { id: 'CLB-TEST', aiChat: { enabled: false, monthlyLimit: 1000 } }
let snapshot
const Club = {
  findOne: ({ id }) => ({ lean: async () => id === club.id ? club : null }),
  async findOneAndUpdate({ id }, update) { if (id !== club.id) return null; club.aiChat = update.$set.aiChat; return club }
}
const Usage = {
  findById: () => ({ lean: async () => snapshot }),
  async findOneAndUpdate({ _id }, update) { snapshot ||= { _id }; Object.assign(snapshot, update.$set); for (const [k, v] of Object.entries(update.$max)) snapshot[k] = Math.max(snapshot[k] || 0, v) }
}
const auth = (req, res, next) => req.get('x-test-master') === 'yes' ? next() : res.status(401).json({ error: 'Sessão necessária' })
const app = express(); app.use(express.json())
installMasterAiChat({ app, mongoose: { models: { MasterAiChatUsage: Usage } }, Club, requireMaster: auth, writeLimiter: (_req, _res, next) => next(), authenticateClubLicense: (req, res, next) => { if (req.get('x-test-license') !== 'valid') return res.status(401).json({ error: 'Licença necessária' }); req.club = club; next() }, logAction: async () => {} })
app.use((e, _req, res, _next) => res.status(e.statusCode || 500).json({ error: e.message }))
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); after(() => server.close())
const url = 'http://127.0.0.1:' + server.address().port

test('master config is protected and usage reports cannot roll counters back', async () => {
  const path = '/api/master/clubs/' + club.id + '/ai-chat'
  assert.equal((await fetch(url + path)).status, 401)
  const saved = await fetch(url + path, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-test-master': 'yes' }, body: JSON.stringify({ enabled: true, monthlyLimit: 50 }) })
  assert.equal(saved.status, 200); assert.equal(club.aiChat.monthlyLimit, 50)
  assert.equal((await fetch(url + '/api/license/ai-chat/usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401)
  const report = async attempts => fetch(url + '/api/license/ai-chat/usage', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-license': 'valid' }, body: JSON.stringify({ month: '2026-10', attempts, calls: attempts, inputTokens: 100, outputTokens: 10, totalTokens: 110 }) })
  assert.equal((await report(5)).status, 200); assert.equal((await report(3)).status, 200)
  assert.equal(snapshot.attempts, 5); assert.equal(snapshot.clubId, club.id)
  const data = await (await fetch(url + path, { headers: { 'x-test-master': 'yes' } })).json()
  assert.equal(data.usage.attempts, 5)
})
