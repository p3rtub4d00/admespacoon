import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { once } from 'node:events'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { validatePartner, isReferralMonthlyPayment } from '../server/referrals.js'
process.env.JWT_SECRET='test-only-secret-with-at-least-32-characters'
process.env.MASTER_PASSWORD='test-only-master-password'
process.env.ASAAS_WEBHOOK_TOKEN='test-referral-webhook'
delete process.env.MONGODB_URI
delete process.env.BACKUP_MONGODB_URI
delete process.env.ASAAS_API_KEY
const {app}=await import('../server/index.js')
const server=app.listen(0,'127.0.0.1')
await once(server,'listening')
const base=`http://127.0.0.1:${server.address().port}`
after(()=>new Promise(resolve=>server.close(resolve)))
const Partner=mongoose.model('ReferralPartner'), Commission=mongoose.model('ReferralCommission'), Club=mongoose.model('Club'), Payment=mongoose.model('MasterPayment'), Invite=mongoose.model('RegistrationInvite'), Log=mongoose.model('AuditLog')
const auth={Cookie:`espacoon_master=${jwt.sign({role:'master'},process.env.JWT_SECRET)}`}
const request=(path,body,headers=auth,method='POST')=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})})
const fixture=()=>({id:'CLB-REFERRAL',establishmentName:'Clube Indicado',demoMode:false,system:{status:'active'},referral:{partnerId:'partner-1',partnerName:'Parceiro Teste',amount:20,inviteId:'invite-1'},billing:{dueDay:10},save:async()=>{}})
function matches(row,filter) {
  return Object.entries(filter).every(([key,value])=>{
    const actual=row?.[key]
    if(value && typeof value==='object' && '$in' in value) return value.$in.includes(actual)
    return value===null ? actual==null : actual===value
  })
}
function store(t,{club=fixture(),payments=[]}={}) {
  let row
  const query=value=>({lean:async()=>value,sort:()=>({lean:async()=>value})})
  t.mock.method(Club,'findOne',()=>Object.assign(Promise.resolve(club),query(club)))
  t.mock.method(Club,'find',()=>({setOptions:options=>{assert.equal(options.includeDeleted,true);return query([club])}}))
  t.mock.method(Commission,'updateOne',async(filter,update,options)=>{
    if(!row && options?.upsert) row={...update.$setOnInsert}
    if(row && matches(row,filter) && update.$set) Object.assign(row,update.$set)
    return {}
  })
  t.mock.method(Commission,'findOne',()=>query(row && {...row}))
  t.mock.method(Commission,'find',()=>query(row?[{...row}]:[]))
  t.mock.method(Commission,'findOneAndUpdate',async(filter,update)=>{
    if(!row || !matches(row,filter)) return null
    Object.assign(row,update.$set);return {...row}
  })
  t.mock.method(Payment,'findOne',filter=>query(payments.find(payment=>filter.id?payment.id===filter.id:payment.clubId===club.id && payment.referralEligible && payment.amount>0 && ['paid','cancelled'].includes(payment.status))))
  t.mock.method(Log,'create',async()=>({}))
  return {club,payments,getRow:()=>row}
}
const refresh=async()=>{const response=await request('/api/master/referral-commissions',null,auth,'GET');assert.equal(response.status,200);return response.json()}

test('partner validation bounds values and defaults to an editable R$20 commission',()=>{
  assert.equal(validatePartner({name:'Parceiro',phone:'(69) 99999-0000'}).commissionAmount,20)
  assert.equal(validatePartner({name:'Parceiro',phone:'69999990000',commissionAmount:12.345}).commissionAmount,12.35)
  for(const commissionAmount of [0,0.001,-1,1001,NaN,'20']) assert.throws(()=>validatePartner({name:'Parceiro',phone:'69999990000',commissionAmount}),{statusCode:400})
  assert.throws(()=>validatePartner({name:'Ab',phone:'123'}),{statusCode:400})
})

test('partner and commission operations require Master and never expose public payout endpoints',async()=>{
  for(const path of ['/api/master/referral-partners','/api/master/referral-commissions']) assert.equal((await request(path,null,{},'GET')).status,401)
  for(const path of ['/api/master/referral-partners','/api/master/referral-commissions/CLB-REFERRAL/paid','/api/master/referral-commissions/CLB-REFERRAL/cancel']) assert.equal((await request(path,{},{})).status,401)
})

test('master invite snapshots the active partner and public submission cannot override it',async t=>{
  let saved
  const partner={id:'partner-1',name:'Parceiro Teste',commissionAmount:20,active:true}
  t.mock.method(Partner,'findOne',filter=>{assert.deepEqual(filter,{id:'partner-1',active:true});return {lean:async()=>partner}})
  t.mock.method(Invite,'create',async value=>{saved=value;return value})
  const response=await request('/api/master/registration-invites',{partnerId:'partner-1',amount:1000})
  assert.equal(response.status,201)
  assert.deepEqual(saved.referral,{partnerId:'partner-1',partnerName:'Parceiro Teste',amount:20})
  assert.equal(saved.referral.amount,20)
  const snapshot={...saved.referral};partner.commissionAmount=50
  assert.deepEqual(saved.referral,snapshot)
  let update
  t.mock.method(Invite,'findOneAndUpdate',async (_filter,value)=>{update=value;return {id:saved.id}})
  const submitted=await request('/api/registration/complete',{token:'a'.repeat(43),privacyAcknowledged:true,establishmentName:'Clube Teste',ownerName:'Dono Teste',phone:'69999990000',partnerId:'attacker',referral:{amount:1000}}, {})
  assert.equal(submitted.status,201)
  assert.equal(update.$set.referral,undefined)
  assert.equal(update.$set.registration.partnerId,undefined)
  partner.active=false
  t.mock.method(Partner,'findOne',()=>({lean:async()=>null}))
  assert.equal((await request('/api/master/registration-invites',{partnerId:'partner-1'})).status,400)
})

test('pending and demo indications do not qualify; one paid monthly payment qualifies only once',async t=>{
  const data=store(t)
  assert.equal((await refresh()).rows[0].status,'pending')
  data.payments.push({id:'TEST',clubId:data.club.id,status:'paid',amount:49.9,referralEligible:false})
  assert.equal((await refresh()).totals.available,0)
  data.club.demoMode=true
  data.payments.push({id:'PAY-1',clubId:data.club.id,status:'paid',amount:49.9,referralEligible:true,paidAt:new Date()})
  assert.equal((await refresh()).rows[0].status,'pending')
  data.club.demoMode=false
  let report=await refresh()
  assert.equal(report.rows[0].status,'available')
  assert.equal(report.rows[0].firstPaymentId,'PAY-1')
  data.payments.push({id:'PAY-2',clubId:data.club.id,status:'paid',amount:49.9,referralEligible:true})
  report=await refresh()
  assert.equal(report.rows.length,1)
  assert.equal(report.totals.available,20)
  assert.equal(report.rows[0].firstPaymentId,'PAY-1')
})

test('payout requires explicit manual confirmation and concurrent requests record it only once',async t=>{
  const club=fixture(), payment={id:'PAY-1',clubId:club.id,status:'paid',amount:49.9,referralEligible:true}
  const data=store(t,{club,payments:[payment]})
  await refresh()
  const path='/api/master/referral-commissions/'+club.id+'/paid'
  assert.equal((await request(path,{reference:'PIX-TEST'})).status,400)
  assert.equal((await request(path,{reference:'x',confirmPaid:true})).status,400)
  const responses=await Promise.all([request(path,{reference:'PIX-TEST',confirmPaid:true}),request(path,{reference:'PIX-TEST',confirmPaid:true})])
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409])
  assert.equal(data.getRow().status,'paid')
  assert.equal(data.getRow().payoutReference,'PIX-TEST')
  assert.equal((await refresh()).totals.paid,20)
})

test('refund cancels unpaid commission and flags an already paid payout without deleting history',async t=>{
  const club=fixture(), payment={id:'PAY-1',clubId:club.id,status:'paid',amount:49.9,referralEligible:true}
  const data=store(t,{club,payments:[payment]})
  await refresh(); payment.status='cancelled'
  assert.equal((await refresh()).rows[0].status,'cancelled')
  data.payments.push({id:'PAY-2',clubId:club.id,status:'paid',amount:49.9,referralEligible:true})
  assert.equal((await refresh()).rows[0].status,'cancelled')
  data.getRow().status='paid';data.getRow().paidAt=new Date();data.getRow().payoutReference='PIX-TEST'
  const report=await refresh()
  assert.equal(report.rows[0].status,'paid')
  assert.ok(report.rows[0].paymentReversedAt)
  assert.equal(report.rows[0].payoutReference,'PIX-TEST')
})

test('deleted clubs cancel unpaid indications; cancelled commissions never requalify',async t=>{
  const data=store(t)
  await refresh()
  assert.equal((await request('/api/master/referral-commissions/'+data.club.id+'/cancel',{reason:'Indicação duplicada'})).status,200)
  data.payments.push({id:'PAY-1',clubId:data.club.id,status:'paid',amount:49.9,referralEligible:true})
  assert.equal((await refresh()).rows[0].status,'cancelled')
  data.getRow().status='pending';data.club.deletedAt=new Date()
  const report=await refresh()
  assert.equal(report.rows[0].status,'cancelled')
  assert.equal(report.rows[0].cancelReason,'Clube excluído ou cancelado.')
})

test('manual monthly payment qualifies referral in production without affecting ordinary billing',async t=>{
  const data=store(t)
  t.mock.method(mongoose.model('MasterSettings'),'findOne',async()=>({planPrice:49.9}))
  t.mock.method(Payment,'create',async value=>{data.payments.push(value);return value})
  const response=await request('/api/master/clubs/'+data.club.id+'/mark-paid',{paidAmount:49.9})
  assert.equal(response.status,200)
  assert.equal(data.payments[0].referralEligible,true)
  assert.equal(data.getRow().status,'available')
  assert.equal(data.club.billing.status,'active')
  data.club.demoMode=true
  assert.equal((await request('/api/master/clubs/'+data.club.id+'/mark-paid',{paidAmount:49.9})).status,200)
  assert.equal(data.payments[1].referralEligible,false)
})

test('approval binds the saved invitation referral, ignores forged commission and creates pending history',async t=>{
  const club=fixture();club.id='CLB-FIXED-REFERRAL'
  const data=store(t,{club})
  const referral={partnerId:'partner-1',partnerName:'Parceiro Teste',amount:20}
  t.mock.method(Invite,'findOne',async()=>({id:'invite-1',clubId:club.id,referral}))
  t.mock.method(Invite,'updateOne',async()=>({}))
  t.mock.method(mongoose.model('MasterSettings'),'findOne',async()=>({planName:'ClubeOn',planPrice:49.9}))
  t.mock.method(Club,'exists',async()=>false)
  let created
  t.mock.method(Club,'create',async value=>{created=value;return value})
  const result=await request('/api/master/clubs',{registrationInviteId:'invite-1',establishmentName:'Clube Indicado',ownerName:'Dono Teste',phone:'69999990000',dueDay:10,referral:{partnerId:'attacker',amount:1000}})
  assert.equal(result.status,201)
  assert.deepEqual(created.referral,{...referral,inviteId:'invite-1'})
  assert.equal(data.getRow().status,'pending')
  assert.equal(data.getRow().amount,20)
})

test('authenticated monthly Asaas callbacks qualify once and refund cancels the matching commission',async t=>{
  const data=store(t)
  data.club.billing.asaasSubscriptionId='sub-test'
  const Events=mongoose.model('MasterWebhookEvent'), events=new Set()
  t.mock.method(Events,'exists',async filter=>events.has(filter.id))
  t.mock.method(Events,'create',async value=>{events.add(value.id);return value})
  t.mock.method(Payment,'updateOne',async(filter,update)=>{
    let payment=data.payments.find(row=>row.id===filter.id)
    if(!payment && update.$setOnInsert) { payment={...update.$setOnInsert};data.payments.push(payment) }
    if(payment && update.$set) Object.assign(payment,update.$set)
    return {}
  })
  const webpush=(await import('web-push')).default
  const keys=webpush.generateVAPIDKeys()
  t.mock.method(mongoose.model('MasterPushConfig'),'findOne',()=>({lean:async()=>keys}))
  t.mock.method(mongoose.model('MasterPushSubscription'),'find',()=>({lean:async()=>[]}))
  const headers={'asaas-access-token':'test-referral-webhook'}
  const body={id:'event-paid-1',event:'PAYMENT_CONFIRMED',payment:{id:'pay-test',subscription:'sub-test',value:49.9,dueDate:'2026-10-10'}}
  assert.equal((await request('/api/webhooks/asaas',body,headers)).status,200)
  assert.equal(data.getRow().status,'available')
  assert.equal(data.getRow().firstPaymentId,'ASAAS-pay-test')
  assert.equal(data.payments[0].referralEligible,true)
  assert.equal((await request('/api/webhooks/asaas',body,headers)).status,200)
  assert.equal(data.payments.length,1)
  assert.equal((await request('/api/webhooks/asaas',{...body,id:'event-paid-2',event:'PAYMENT_RECEIVED'},headers)).status,200)
  assert.equal(data.payments.length,1)
  assert.equal((await request('/api/webhooks/asaas',{...body,id:'event-refund',event:'PAYMENT_REFUNDED'},headers)).status,200)
  assert.equal(data.payments[0].status,'cancelled')
  assert.equal(data.getRow().status,'cancelled')
  assert.equal(data.club.billing.status,'past_due')
})

test('a commission database outage does not prevent registering and unlocking a paid club',async t=>{
  const data=store(t)
  t.mock.method(mongoose.model('MasterSettings'),'findOne',async()=>({planPrice:49.9}))
  t.mock.method(Payment,'create',async value=>{data.payments.push(value);return value})
  t.mock.method(Commission,'updateOne',async()=>{throw new Error('Commission storage unavailable')})
  const response=await request('/api/master/clubs/'+data.club.id+'/mark-paid',{paidAmount:49.9})
  assert.equal(response.status,200)
  assert.equal(data.club.billing.status,'active')
  assert.equal(data.payments.length,1)
})

test('commission qualification accepts only the identified monthly charge, not a reservation or customer match',()=>{
  const club=fixture();club.billing.asaasSubscriptionId='monthly-sub';club.billing.currentPaymentId='monthly-payment'
  assert.equal(isReferralMonthlyPayment(club,{subscription:'monthly-sub'}),true)
  assert.equal(isReferralMonthlyPayment(club,{id:'monthly-payment'}),true)
  assert.equal(isReferralMonthlyPayment(club,{id:'reservation-payment',customer:'same-customer',externalReference:'ESP-TEST'}),false)
  assert.equal(isReferralMonthlyPayment(club,{subscription:'different-sub'}),false)
  club.demoMode=true
  assert.equal(isReferralMonthlyPayment(club,{subscription:'monthly-sub'}),false)
})
