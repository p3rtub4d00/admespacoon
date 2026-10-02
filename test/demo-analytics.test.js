import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { once } from 'node:events'
import crypto from 'node:crypto'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { analyticsDay, demoEventRecord, demoAnalyticsSummary } from '../server/demo-analytics.js'
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters'
process.env.MASTER_PASSWORD = 'test-only-master-password'
delete process.env.MONGODB_URI
delete process.env.BACKUP_MONGODB_URI
const { app } = await import('../server/index.js')
const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`
after(() => new Promise(resolve => server.close(resolve)))
const Club = mongoose.model('Club')
const Event = mongoose.model('DemoEvent')
const auth = { Cookie: `espacoon_master=${jwt.sign({ role: 'master' }, process.env.JWT_SECRET)}` }
const club = () => ({ id: 'CLB-TEST', establishmentName: 'Piloto', demoMode: true, system: { status: 'active' }, licenseKeyHash: crypto.createHash('sha256').update('test-license').digest('hex') })
const licensed = { 'x-club-id': 'CLB-TEST', 'x-license-key': 'test-license' }
const post = (body, headers = {}) => fetch(base + '/api/license/demo-events', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

test('analytics uses Manaus dates, session/day deduplication and reservation deduplication across days without retaining raw IDs', () => {
  assert.equal(analyticsDay(new Date('2026-10-01T03:00:00Z')), '2026-09-30')
  const input = { type: 'visit', eventId: 'session-12345', name: 'must-not-save', cpf: 'must-not-save' }
  const one = demoEventRecord('CLB-TEST', input, 'secret', new Date('2026-10-01T12:00:00Z'))
  const repeat = demoEventRecord('CLB-TEST', input, 'secret', new Date('2026-10-01T18:00:00Z'))
  const nextDay = demoEventRecord('CLB-TEST', input, 'secret', new Date('2026-10-02T18:00:00Z'))
  assert.equal(one.eventKey, repeat.eventKey)
  assert.notEqual(one.eventKey, nextDay.eventKey)
  assert.notEqual(one.eventKey, demoEventRecord('CLB-OTHER', input, 'secret').eventKey)
  assert.equal(Object.hasOwn(one, 'eventId'), false)
  assert.equal(JSON.stringify(one).includes('must-not-save'), false)
  assert.equal(one.expiresAt - one.createdAt, 90 * 86400000)
  const completion = { type: 'reservation_completed', eventId: 'ESP-RES12345' }
  assert.equal(demoEventRecord('CLB-TEST', completion, 'secret', new Date('2026-10-01')).eventKey, demoEventRecord('CLB-TEST', completion, 'secret', new Date('2026-10-02')).eventKey)
  for (const payload of [{type:'anything',eventId:'session-12345'},{type:'visit',eventId:'CPF/123'},null]) assert.throws(() => demoEventRecord('CLB-TEST', payload, 'secret'), { statusCode: 400 })
})

test('period totals cross month boundaries and daily table fills empty days', () => {
  const rows = [{_id:{day:'2026-10-01',type:'visit'},count:3},{_id:{day:'2026-09-25',type:'visit'},count:2},{_id:{day:'2026-09-24',type:'visit'},count:10},{_id:{day:'2026-10-02',type:'visit'},count:50}]
  const data = demoAnalyticsSummary(rows, new Date('2026-10-01T12:00:00Z'))
  assert.equal(data.periods.today.visit, 3)
  assert.equal(data.periods.last7.visit, 5)
  assert.equal(data.periods.month.visit, 3)
  assert.equal(data.daily.length, 7)
  assert.equal(data.daily[1].visit, 0)
})

test('ingestion requires a valid licensed demo and stores repeated events only once', async t => {
  const fixture = club()
  t.mock.method(Club, 'findOne', async () => fixture)
  const stored = new Map()
  t.mock.method(Event, 'updateOne', async (filter, update, options) => {
    assert.equal(options.upsert, true)
    assert.deepEqual(Object.keys(update), ['$setOnInsert'])
    assert.match(filter._id, /^[a-f0-9]{64}$/)
    assert.equal(Event.schema.path('_id').instance, 'String')
    stored.set(filter._id, update.$setOnInsert)
  })
  const payload = {type:'visit',eventId:'session-12345',phone:'private',location:{city:'Porto Velho',region:'Rondônia',country:'Brasil',countryCode:'BR',ip:'private'}}
  assert.equal((await post(payload)).status, 401)
  assert.equal((await post(payload, {...licensed,'x-license-key':'wrong'})).status, 401)
  fixture.demoMode = false
  assert.equal((await post(payload, licensed)).status, 403)
  fixture.demoMode = true
  for (let i=0;i<2;i++) assert.equal((await post(payload, licensed)).status, 200)
  assert.equal(stored.size, 1)
  assert.equal([...stored.values()][0].location.city, 'Porto Velho')
  assert.equal([...stored.values()][0].location.ip, undefined)
  assert.equal(JSON.stringify([...stored.values()]).includes('private'), false)
  fixture.system.status='cancelled'
  assert.equal((await post(payload, licensed)).status, 403)
})

test('reports require Master session and aggregate only current demo clubs, exposing no credentials', async t => {
  let pipeline
  t.mock.method(Club, 'find', filter => { assert.deepEqual(filter,{demoMode:true}); return {lean:async()=>[{...club(),adminAuth:{passwordHash:'secret'}}]} })
  t.mock.method(Event, 'aggregate', async stages => { pipeline=stages; return [{_id:{day:analyticsDay(),type:'visit'},count:2}] })
  assert.equal((await fetch(base+'/api/master/demo-analytics')).status,401)
  const response=await fetch(base+'/api/master/demo-analytics',{headers:auth})
  assert.equal(response.status,200)
  assert.equal(response.headers.get('cache-control'),'no-store')
  const data=await response.json()
  assert.equal(data.periods.today.visit,2)
  assert.deepEqual(pipeline[0].$match.clubId,{$in:['CLB-TEST']})
  assert.ok(pipeline[0].$match.expiresAt.$gt instanceof Date)
  assert.equal(JSON.stringify(data).includes('secret'),false)
  assert.deepEqual(data.demoClubs,[{id:'CLB-TEST',name:'Piloto'}])
})

test('location ingestion retains only coarse fields on visits without changing deduplication', async () => {
  const { sanitizeDemoLocation } = await import('../server/demo-analytics.js')
  const input = { type:'visit',eventId:'geo-session-123',location:{city:'Porto Velho',region:'Rondônia',country:'Brasil',countryCode:'br',ip:'private',latitude:1,longitude:2} }
  const now=new Date('2026-10-02T12:00:00Z')
  const record=demoEventRecord('CLB-TEST',input,'secret',now)
  assert.deepEqual(record.location,{city:'Porto Velho',region:'Rondônia',country:'Brasil',countryCode:'BR'})
  assert.equal(JSON.stringify(record).includes('private'),false)
  assert.equal(record.eventKey,demoEventRecord('CLB-TEST',{...input,location:null},'secret',now).eventKey)
  assert.equal(demoEventRecord('CLB-TEST',{...input,type:'contact_click'},'secret',now).location,undefined)
  assert.equal(sanitizeDemoLocation({city:'Test'}),null)
  assert.equal(sanitizeDemoLocation({...input.location,city:'x'.repeat(200)}).city.length,80)
})

test('location summaries match visits by period, keep old unknown entries and exclude actions', async () => {
  const { demoLocationSummary } = await import('../server/demo-analytics.js')
  const location={city:'Porto Velho',region:'Rondônia',country:'Brasil',countryCode:'BR'}
  const rows=[
    {_id:{day:'2026-10-02',type:'visit',location},count:3},
    {_id:{day:'2026-10-01',type:'visit',location},count:2},
    {_id:{day:'2026-09-27',type:'visit',location},count:4},
    {_id:{day:'2026-10-02',type:'visit'},count:1},
    {_id:{day:'2026-10-02',type:'admin_open',location},count:50},
    {_id:{day:'2026-10-03',type:'visit',location},count:50},
  ]
  const result=demoLocationSummary(rows,new Date('2026-10-02T12:00:00Z'))
  assert.equal(result.today.total,4)
  assert.equal(result.today.unknown,1)
  assert.equal(result.last7.rows[0].count,9)
  assert.equal(result.month.rows[0].count,5)
  for (const period of Object.keys(result)) assert.equal(result[period].total,demoAnalyticsSummary(rows,new Date('2026-10-02T12:00:00Z')).periods[period].visit)
  const many=Array.from({length:25},(_,i)=>({_id:{day:'2026-10-02',type:'visit',location:{...location,city:'City'+i}},count:1}))
  assert.equal(demoLocationSummary(many,new Date('2026-10-02T12:00:00Z')).today.other,5)
})
