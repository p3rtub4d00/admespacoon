import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { once } from 'node:events'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { buildPrivacyPolicy, sanitizePrivacyConfig } from '../server/privacy.js'

process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters'
process.env.MASTER_PASSWORD = 'test-only-master-password'
delete process.env.MONGODB_URI
delete process.env.BACKUP_MONGODB_URI
const {app}=await import('../server/index.js')
const server=app.listen(0,'127.0.0.1')
await once(server,'listening')
const base=`http://127.0.0.1:${server.address().port}`
after(()=>new Promise(resolve=>server.close(resolve)))
const Settings=mongoose.model('MasterSettings')
const Log=mongoose.model('AuditLog')
const auth={Cookie:`espacoon_master=${jwt.sign({role:'master'},process.env.JWT_SECRET)}`}
const put=(body,headers={})=>fetch(base+'/api/master/privacy',{method:'PUT',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)})

test('policy data never includes internal settings, provider credentials or client records',async t=>{
  t.mock.method(Settings,'findOne',()=>({lean:async()=>({privacy:{controllerName:'Empresa Teste',contactEmail:'dados@example.com',license:'secret'},planPrice:49.9,providerToken:'private-token'})}))
  const response=await fetch(base+'/api/privacy')
  assert.equal(response.status,200)
  assert.equal(response.headers.get('cache-control'),'no-store')
  const data=await response.json()
  assert.equal(data.configured,true)
  for(const secret of ['private-token','secret','planPrice']) assert.equal(JSON.stringify(data).includes(secret),false)
})

test('unconfigured platform does not invent a contact channel or claim readiness',()=>{
  const policy=buildPrivacyPolicy({scope:'platform'})
  assert.equal(policy.configured,false)
  assert.equal(policy.contactEmail,'')
  assert.equal(policy.contactPhone,'')
  for(const input of [null,[],{contactEmail:'javascript:alert(1)'},{contactPhone:'123'}]) assert.throws(()=>sanitizePrivacyConfig(input),{statusCode:400})
})

test('changing privacy contacts requires master session, never synchronizes billing and only saves allowed fields',async t=>{
  let saved
  t.mock.method(Settings,'findOneAndUpdate',async(filter,update)=>{saved=update.$set;return{}})
  t.mock.method(Log,'create',async()=>({}))
  const fetchOriginal=globalThis.fetch
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.ok(String(url).startsWith(base),'No payment-provider request is allowed')
    return fetchOriginal(url,options)
  })
  assert.equal((await put({controllerName:'Empresa Teste',contactEmail:'dados@example.com'})).status,401)
  const response=await put({controllerName:'Empresa Teste',contactEmail:'DADOS@EXAMPLE.COM',planPrice:1,licenseKey:'secret'},auth)
  assert.equal(response.status,200)
  assert.deepEqual(saved,{privacy:{controllerName:'Empresa Teste',contactEmail:'dados@example.com',contactPhone:''}})
  assert.equal(response.headers.get('cache-control'),'no-store')
})

test('privacy settings cannot be saved without identification and an attended contact',async()=>{
  for(const body of [{controllerName:'Empresa Teste'},{contactEmail:'dados@example.com'},{controllerName:'Empresa Teste',contactEmail:'invalid'}]) assert.equal((await put(body,auth)).status,400)
})

test('administrative session responses prohibit caching',async()=>{
  const response=await fetch(base+'/api/master/session',{headers:auth})
  assert.equal(response.status,200)
  assert.equal(response.headers.get('cache-control'),'no-store')
})
