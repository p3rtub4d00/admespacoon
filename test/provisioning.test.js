import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { once } from 'node:events'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { normalizeSystemUrl, adminPanelUrl, parseSetupReport, provisioningSummary } from '../server/provisioning.js'

process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters'
process.env.MASTER_PASSWORD = 'test-only-master-password'
process.env.ASAAS_API_KEY = 'test-only-asaas-key'
delete process.env.MONGODB_URI
delete process.env.BACKUP_MONGODB_URI
const nativeFetch = globalThis.fetch
const { app } = await import('../server/index.js')
const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`
after(() => new Promise(resolve => server.close(resolve)))
const Club = mongoose.model('Club')
const Token = mongoose.model('AdminAccessToken')
const Log = mongoose.model('AuditLog')
const Settings = mongoose.model('MasterSettings')
const masterHeaders = { Cookie: `espacoon_master=${jwt.sign({ role:'master' }, process.env.JWT_SECRET)}` }
const post = (path,body,headers={}) => nativeFetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)})

function fixture() {
  return { id:'CLB-TEST', establishmentName:'Clube Teste', ownerName:'Responsável Teste', phone:'69999990000', billing:{status:'active',nextDueDate:new Date(Date.now()+86400000)}, system:{status:'active',publicUrl:'https://clube.example'}, save:async()=>{} }
}

test('system URL accepts an HTTPS origin and rejects unsafe redirects', () => {
  assert.equal(normalizeSystemUrl(' https://clube.example/ '),'https://clube.example')
  assert.equal(normalizeSystemUrl(''),'')
  for (const url of ['http://clube.example','javascript:alert(1)','https://user:pass@clube.example','https://clube.example/admin','https://clube.example/?token=secret','https://clube.example/#admin']) assert.throws(()=>normalizeSystemUrl(url),{statusCode:400})
  assert.equal(adminPanelUrl(fixture()),'https://clube.example/admin')
  assert.equal(adminPanelUrl({}),null)
})

test('setup reports accept only bounded, well-formed boolean values', () => {
  const report = {establishmentConfigured:true,pricesConfigured:false,asaasConfigured:true}
  assert.deepEqual(parseSetupReport(Buffer.from(JSON.stringify(report)).toString('base64url')),{...report,privacyConfigured:false})
  for (const report of ['', 'bad-json', 'a'.repeat(513), Buffer.from('{"establishmentConfigured":"true"}').toString('base64url')]) assert.equal(parseSetupReport(report),null)
})

test('readiness requires a recent actual report, owner setup, payment configuration and active access', () => {
  const club = fixture()
  const now = new Date()
  club.adminAuth = {passwordHash:'test-hash',passwordSalt:'test-salt'}
  club.provisioning = {reportedAt:now,establishmentConfigured:true,pricesConfigured:true,asaasConfigured:true,privacyConfigured:true}
  assert.equal(provisioningSummary(club,{active:true,now}).ready,true)
  assert.equal(provisioningSummary(club,{active:false,now}).ready,false)
  assert.equal(provisioningSummary({...club,billing:{status:'past_due'}},{active:true,now}).ready,false)
  assert.equal(provisioningSummary({...club,provisioning:{...club.provisioning,reportedAt:new Date(now-21*60000)}},{active:true,now}).ready,false)
  assert.equal(provisioningSummary({...club,provisioning:undefined},{active:true,now}).ready,false)
  assert.equal(provisioningSummary({...club,reservationPaymentProvider:'mercadopago'},{active:true,now}).ready,false)
  assert.equal(provisioningSummary({...club,reservationPaymentProvider:'mercadopago'},{active:true,now,mercadoPagoConnected:true}).ready,true)
})

test('demo creation persists the mode before any real billing even when Asaas is configured', async t => {
  let created
  t.mock.method(Settings,'findOne',async()=>({planName:'ClubeOn',planPrice:49.9}))
  t.mock.method(Club,'exists',async()=>false)
  t.mock.method(Club,'create',async input => {created=input; return {...input,save:async()=>{}}})
  t.mock.method(Log,'create',async()=>({}))
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('Unexpected external billing request')})
  const response = await post('/api/master/clubs',{establishmentName:'Clube Demo',ownerName:'Cliente Teste',phone:'69999990000',cpfCnpj:'52998224725',dueDay:10,demoMode:true,systemUrl:'https://demo.example'},masterHeaders)
  assert.equal(response.status,201)
  const data = await response.json()
  assert.equal(created.demoMode,true)
  assert.equal(created.system.publicUrl,'https://demo.example')
  assert.equal(data.club.demoMode,true)
  assert.ok(data.licenseKey)
  assert.equal(data.club.licenseKeyHash,undefined)
  assert.equal(globalThis.fetch.mock.callCount(),0)
})

test('licensed reports update only their club and unauthenticated reports cannot write setup state', async t => {
  const club = fixture()
  club.licenseKeyHash = (await import('node:crypto')).createHash('sha256').update('license-test').digest('hex')
  let lookups=0
  t.mock.method(Club,'findOne',async filter=>{lookups++; assert.equal(filter.id,club.id); return club})
  const report = {establishmentConfigured:true,pricesConfigured:true,asaasConfigured:false}
  const setupHeader = Buffer.from(JSON.stringify(report)).toString('base64url')
  const rejected = await nativeFetch(base+'/api/license/status',{headers:{'x-club-setup':setupHeader}})
  assert.equal(rejected.status,401)
  assert.equal(lookups,0)
  assert.equal(club.provisioning,undefined)
  const response = await nativeFetch(base+'/api/license/status',{headers:{'x-club-id':club.id,'x-license-key':'license-test','x-club-setup':setupHeader}})
  assert.equal(response.status,200)
  assert.equal(club.provisioning.pricesConfigured,true)
  assert.ok(club.provisioning.reportedAt instanceof Date)
})

test('first-access password completion is single-use even for concurrent submissions', async t => {
  const club=fixture()
  let consumed=false, saves=0
  club.save=async()=>{saves++}
  const token={_id:'token-test',clubId:club.id,purpose:'first-access'}
  t.mock.method(Token,'findOne',async()=>consumed?null:token)
  t.mock.method(Token,'findOneAndUpdate',async(filter,update)=>{
    assert.equal(filter.usedAt,null)
    assert.ok(filter.expiresAt.$gt instanceof Date)
    assert.ok(update.$set.usedAt instanceof Date)
    if(consumed) return null
    consumed=true
    return token
  })
  t.mock.method(Token,'updateMany',async()=>({}))
  t.mock.method(Club,'findOne',async()=>club)
  t.mock.method(Log,'create',async()=>({}))
  const body={password:'synthetic-password',confirmation:'synthetic-password'}
  const responses=await Promise.all([post('/api/admin-access/test-token/complete',body),post('/api/admin-access/test-token/complete',body)])
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,404])
  assert.equal(saves,1)
  const accepted=responses.find(r=>r.status===200)
  assert.equal((await accepted.json()).adminUrl,'https://clube.example/admin')
  assert.equal(accepted.headers.get('cache-control'),'no-store')
  assert.equal((await post('/api/admin-access/test-token/complete',body)).status,404)
})

test('expired links and mismatched passwords cannot replace the password', async t => {
  t.mock.method(Token,'findOne',async()=>null)
  assert.equal((await post('/api/admin-access/expired/complete',{password:'synthetic-password',confirmation:'synthetic-password'})).status,404)
  t.mock.method(Token,'findOne',async()=>({_id:'test',clubId:'CLB-TEST'}))
  t.mock.method(Club,'findOne',async()=>fixture())
  t.mock.method(Token,'findOneAndUpdate',async()=>{throw new Error('Must not consume token')})
  assert.equal((await post('/api/admin-access/test/complete',{password:'synthetic-password',confirmation:'different'})).status,400)
  assert.equal(Token.findOneAndUpdate.mock.callCount(),0)
})
