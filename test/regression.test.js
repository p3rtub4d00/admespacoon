import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { once } from 'node:events'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'

process.env.NODE_ENV = 'production'
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters'
process.env.MASTER_PASSWORD = 'test-master-password'
process.env.ASAAS_WEBHOOK_TOKEN = 'test-webhook-token'
process.env.WHATSAPP_APP_SECRET = 'test-whatsapp-secret'
process.env.MERCADOPAGO_WEBHOOK_SECRET = 'test-mercadopago-secret'
delete process.env.MONGODB_URI
delete process.env.BACKUP_MONGODB_URI
const { app, effectiveAccess, validateClubInput, publicClub, createAdminPasswordRecord, verifyClubAdminPassword, validateWhatsAppWebhookSignature, validateMercadoPagoWebhookSignature } = await import('../server/index.js')
const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`
after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
const post = (path, body, headers = {}) => fetch(base + path, { method:'POST', headers:{'Content-Type':'application/json',...headers}, body:JSON.stringify(body) })

test('health is available without a database and security headers are set', async () => {
  const response = await fetch(base + '/api/health')
  assert.equal(response.status, 200)
  assert.equal((await response.json()).database, 'disconnected')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
})

test('master rejects missing, malformed, expired, wrong-role and wrong-key sessions', async () => {
  for (const [token,status] of [['',401],['tampered',401],[jwt.sign({role:'master'},process.env.JWT_SECRET,{expiresIn:-1}),401],[jwt.sign({role:'admin'},process.env.JWT_SECRET),403],[jwt.sign({role:'master'},'wrong-key'),401]]) {
    const response = await fetch(base + '/api/master/session', {headers:{Cookie:`espacoon_master=${token}`}})
    assert.equal(response.status,status)
  }
  for (const path of ['/api/master/clubs','/api/master/settings','/api/master/revenue','/api/master/logs']) assert.equal((await fetch(base+path)).status,401)
})

test('login creates a protected cookie, session validates it and logout clears it', async () => {
  assert.equal((await post('/api/master/login',{password:'wrong'})).status,401)
  const response = await post('/api/master/login',{password:process.env.MASTER_PASSWORD})
  assert.equal(response.status,200)
  const cookie = response.headers.get('set-cookie')
  for (const attribute of [/HttpOnly/,/Secure/,/SameSite=Strict/]) assert.match(cookie,attribute)
  const session = await fetch(base+'/api/master/session',{headers:{Cookie:cookie.split(';')[0]}})
  assert.deepEqual(await session.json(),{authenticated:true})
  const logout = await post('/api/master/logout',{})
  assert.equal(logout.status,200)
  assert.match(logout.headers.get('set-cookie'),/Expires=Thu, 01 Jan 1970/)
})

test('license routes reject requests without club credentials', async () => {
  const response = await post('/api/license/admin-auth/verify',{password:'anything'})
  assert.equal(response.status,401)
})

test('webhooks reject unauthenticated requests before database operations', async () => {
  for (const path of ['/api/webhooks/asaas','/api/webhooks/mercadopago','/api/webhooks/whatsapp']) {
    const response = await post(path,{})
    assert.equal(response.status,401)
  }
})

test('unknown API routes return JSON 404', async () => {
  const response = await fetch(base+'/api/not-a-real-route')
  assert.equal(response.status,404)
  assert.equal((await response.json()).error,'Rota não encontrada.')
})

test('club access honors suspension, cancellation, demonstration and temporary unlock expiration', () => {
  assert.equal(effectiveAccess(null),false)
  assert.equal(effectiveAccess({system:{status:'active'}}),true)
  assert.equal(effectiveAccess({system:{status:'suspended'}}),false)
  assert.equal(effectiveAccess({system:{status:'cancelled'},demoMode:true}),false)
  assert.equal(effectiveAccess({system:{status:'suspended'},demoMode:true}),true)
  assert.equal(effectiveAccess({system:{status:'suspended',temporaryUnlockUntil:new Date(Date.now()+60000)}}),true)
  assert.equal(effectiveAccess({system:{status:'suspended',temporaryUnlockUntil:new Date(Date.now()-60000)}}),false)
})

test('club registration normalizes data and rejects invalid due dates and contacts', () => {
  const input = {establishmentName:' Clube Teste ',ownerName:' Responsável Teste ',phone:'(69) 99999-0000',cpfCnpj:'529.982.247-25',dueDay:15,email:'TESTE@example.com',state:'ro'}
  const result = validateClubInput(input)
  assert.equal(result.phone,'69999990000')
  assert.equal(result.cpfCnpj,'52998224725')
  assert.equal(result.email,'teste@example.com')
  assert.equal(result.state,'RO')
  for (const change of [{dueDay:32},{dueDay:1.5},{phone:'123'},{email:'invalid'},{ownerName:'a'}]) assert.throws(()=>validateClubInput({...input,...change}),{statusCode:400})
  assert.deepEqual(validateClubInput({city:'Porto Velho'},true),{city:'Porto Velho'})
})

test('public club data excludes password hashes, license keys and provider credentials', () => {
  const data = publicClub({id:'CLUB-TEST',adminAuth:{passwordHash:'secret-hash',passwordSalt:'secret-salt'},licenseKeyHash:'secret-license',mercadoPago:{accessToken:'secret-provider'}})
  assert.equal(data.adminPasswordConfigured,true)
  const encoded = JSON.stringify(data)
  for (const secret of ['secret-hash','secret-salt','secret-license','secret-provider']) assert.equal(encoded.includes(secret),false)
})

test('passwords use unique salts, verify correctly and enforce length limits', async () => {
  const first = await createAdminPasswordRecord('synthetic-password')
  const second = await createAdminPasswordRecord('synthetic-password')
  assert.notEqual(first.passwordSalt,second.passwordSalt)
  assert.notEqual(first.passwordHash,second.passwordHash)
  assert.equal(await verifyClubAdminPassword({adminAuth:first},'synthetic-password'),true)
  assert.equal(await verifyClubAdminPassword({adminAuth:first},'wrong-password'),false)
  assert.equal(await verifyClubAdminPassword({},'anything'),false)
  await assert.rejects(createAdminPasswordRecord('short'),{statusCode:400})
  await assert.rejects(createAdminPasswordRecord('a'.repeat(201)),{statusCode:400})
})

test('WhatsApp signature validation detects modified bodies and missing signatures', () => {
  const rawBody = Buffer.from('{"synthetic":true}')
  const signature = 'sha256='+crypto.createHmac('sha256',process.env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex')
  assert.equal(validateWhatsAppWebhookSignature({rawBody,get:()=>signature}),true)
  assert.equal(validateWhatsAppWebhookSignature({rawBody:Buffer.from('{}'),get:()=>signature}),false)
  assert.equal(validateWhatsAppWebhookSignature({rawBody,get:()=>''}),false)
})

test('Mercado Pago signature validation binds payment ID and request ID', () => {
  const hash = crypto.createHmac('sha256',process.env.MERCADOPAGO_WEBHOOK_SECRET).update('id:test123;request-id:request123;ts:123456;').digest('hex')
  const request = {query:{'data.id':'TEST123'},get:name=>name==='x-request-id'?'request123':`ts=123456,v1=${hash}`}
  assert.equal(validateMercadoPagoWebhookSignature(request),true)
  assert.equal(validateMercadoPagoWebhookSignature({...request,query:{'data.id':'changed'}}),false)
  assert.equal(validateMercadoPagoWebhookSignature({get:()=>'',query:{}}),false)
})
