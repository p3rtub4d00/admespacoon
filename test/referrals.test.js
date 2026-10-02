import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { once } from 'node:events'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { validatePartner, isReferralMonthlyPayment, commissionAmount, activeReferralClient } from '../server/referrals.js'
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
const Partner=mongoose.model('ReferralPartner'), Commission=mongoose.model('ReferralMonthlyCommission'), Legacy=mongoose.model('ReferralCommission'), Club=mongoose.model('Club'), Payment=mongoose.model('MasterPayment'), Invite=mongoose.model('RegistrationInvite'), Log=mongoose.model('AuditLog')
const auth={Cookie:`espacoon_master=${jwt.sign({role:'master'},process.env.JWT_SECRET)}`}
const request=(path,body,headers=auth,method='POST')=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})})
const fixture=()=>({id:'CLB-REFERRAL',establishmentName:'Clube Indicado',demoMode:false,system:{status:'active'},referral:{partnerId:'partner-1',partnerName:'Parceiro Teste',percentage:30,inviteId:'invite-1'},billing:{dueDay:10,status:'active'},save:async()=>{}})
function matches(row,filter) {
  return Object.entries(filter).every(([key,value])=>{
    const actual=row?.[key]
    if(value && typeof value==='object' && '$in' in value) return value.$in.includes(actual)
    return value===null ? actual==null : actual===value
  })
}
function store(t,{club=fixture(),payments=[],legacy=null}={}) {
  const rows=[]
  const query=value=>({lean:async()=>value,sort:()=>({lean:async()=>value})})
  t.mock.method(Club,'findOne',()=>Object.assign(Promise.resolve(club),query(club)))
  t.mock.method(Club,'find',()=>({setOptions:options=>{assert.equal(options.includeDeleted,true);return query([club])}}))
  t.mock.method(Legacy,'findOne',()=>query(legacy))
  t.mock.method(Commission,'updateOne',async(filter,update,options)=>{
    let row=rows.find(row=>matches(row,filter))
    if(!row && options?.upsert) { row={...update.$setOnInsert};rows.push(row) }
    if(row && update.$set) Object.assign(row,update.$set)
    return {}
  })
  t.mock.method(Commission,'findOne',filter=>query(rows.find(row=>matches(row,filter))))
  t.mock.method(Commission,'find',filter=>query(rows.filter(row=>matches(row,filter || {})).map(row=>({...row}))))
  t.mock.method(Commission,'findOneAndUpdate',async(filter,update)=>{
    const row=rows.find(row=>matches(row,filter))
    if(!row) return null
    Object.assign(row,update.$set);return {...row}
  })
  t.mock.method(Payment,'find',filter=>query(payments.filter(payment=>payment.clubId===filter.clubId && payment.referralEligible && payment.amount>0 && ['paid','cancelled'].includes(payment.status))))
  t.mock.method(Log,'create',async()=>({}))
  return {club,payments,rows,getRow:()=>rows[0]}
}

const refresh=async()=>{const response=await request('/api/master/referral-commissions',null,auth,'GET');assert.equal(response.status,200);return response.json()}

test('partner validation bounds values and defaults to an editable 30% commission',()=>{
  assert.equal(validatePartner({name:'Parceiro',phone:'(69) 99999-0000'}).commissionPercentage,30)
  assert.equal(validatePartner({name:'Parceiro',phone:'69999990000',commissionPercentage:12.345}).commissionPercentage,12.35)
  for(const commissionPercentage of [0,0.001,-1,101,NaN,'30']) assert.throws(()=>validatePartner({name:'Parceiro',phone:'69999990000',commissionPercentage}),{statusCode:400})
  assert.throws(()=>validatePartner({name:'Ab',phone:'123'}),{statusCode:400})
})

test('partner and commission operations require Master and never expose public payout endpoints',async()=>{
  for(const path of ['/api/master/referral-partners','/api/master/referral-commissions']) assert.equal((await request(path,null,{},'GET')).status,401)
  for(const path of ['/api/master/referral-partners','/api/master/referral-commissions/CLB-REFERRAL/paid','/api/master/referral-commissions/CLB-REFERRAL/cancel']) assert.equal((await request(path,{},{})).status,401)
})

test('master invite snapshots the active partner and public submission cannot override it',async t=>{
  let saved
  const partner={id:'partner-1',name:'Parceiro Teste',commissionPercentage:30,active:true}
  t.mock.method(Partner,'findOne',filter=>{assert.deepEqual(filter,{id:'partner-1',active:true});return {lean:async()=>partner}})
  t.mock.method(Invite,'create',async value=>{saved=value;return value})
  const response=await request('/api/master/registration-invites',{partnerId:'partner-1',amount:1000})
  assert.equal(response.status,201)
  assert.deepEqual(saved.referral,{partnerId:'partner-1',partnerName:'Parceiro Teste',percentage:30})
  assert.equal(saved.referral.percentage,30)
  const snapshot={...saved.referral};partner.commissionPercentage=50
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

test('each paid monthly payment earns 30%; pending, reservations, demo and unpaid months earn nothing',async t=>{
  const data=store(t)
  assert.equal((await refresh()).rows.length,0)
  data.payments.push({id:'TEST',clubId:data.club.id,status:'paid',amount:49.9,referralEligible:false})
  assert.equal((await refresh()).totals.available,0)
  data.club.demoMode=true
  data.payments.push({id:'PAY-1',clubId:data.club.id,status:'paid',amount:49.9,referralEligible:true,paidAt:new Date()})
  assert.equal((await refresh()).rows.length,0)
  data.club.demoMode=false
  let report=await refresh()
  assert.equal(report.rows[0].status,'available')
  assert.equal(report.rows[0].paymentId,'PAY-1')
  assert.equal(report.totals.available,14.97)
  data.payments.push({id:'PAY-2',clubId:data.club.id,status:'paid',amount:49.9,referralEligible:true})
  data.payments.push({id:'UNPAID',clubId:data.club.id,status:'pending',amount:49.9,referralEligible:true})
  report=await refresh()
  assert.equal(report.rows.length,2)
  assert.equal(report.totals.available,29.94)
  assert.equal(report.partnerTotals['partner-1'].available,29.94)
  assert.equal((await refresh()).rows.length,2)
})

test('payout requires explicit manual confirmation and concurrent requests record it only once',async t=>{
  const club=fixture(), payment={id:'PAY-1',clubId:club.id,status:'paid',amount:49.9,referralEligible:true}
  const data=store(t,{club,payments:[payment]})
  await refresh()
  const path='/api/master/referral-commissions/'+data.getRow().id+'/paid'
  assert.equal((await request(path,{reference:'PIX-TEST'})).status,400)
  assert.equal((await request(path,{reference:'x',confirmPaid:true})).status,400)
  const responses=await Promise.all([request(path,{reference:'PIX-TEST',confirmPaid:true}),request(path,{reference:'PIX-TEST',confirmPaid:true})])
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409])
  assert.equal(data.getRow().status,'paid')
  assert.equal(data.getRow().payoutReference,'PIX-TEST')
  assert.equal((await refresh()).totals.paid,14.97)
})

test('refund cancels unpaid commission and flags an already paid payout without deleting history',async t=>{
  const club=fixture(), payment={id:'PAY-1',clubId:club.id,status:'paid',amount:49.9,referralEligible:true}
  const data=store(t,{club,payments:[payment]})
  await refresh(); payment.status='cancelled'
  assert.equal((await refresh()).rows[0].status,'cancelled')
  data.payments.push({id:'PAY-2',clubId:club.id,status:'paid',amount:49.9,referralEligible:true})
  assert.equal((await refresh()).rows.length,2)
  assert.equal(data.rows[1].status,'available')
  data.getRow().status='paid';data.getRow().paidAt=new Date();data.getRow().payoutReference='PIX-TEST'
  const report=await refresh()
  assert.equal(report.rows[0].status,'paid')
  assert.ok(report.rows[0].paymentReversedAt)
  assert.equal(report.rows[0].payoutReference,'PIX-TEST')
})

test('cancelled monthly commission stays cancelled; later renewal earns its own commission',async t=>{
  const data=store(t)
  data.payments.push({id:'PAY-1',clubId:data.club.id,status:'paid',amount:49.9,referralEligible:true})
  await refresh()
  assert.equal((await request('/api/master/referral-commissions/'+data.getRow().id+'/cancel',{reason:'Indicação duplicada'})).status,200)
  data.payments.push({id:'PAY-2',clubId:data.club.id,status:'paid',amount:49.9,referralEligible:true})
  let report=await refresh()
  assert.equal(report.rows[0].status,'cancelled')
  assert.equal(report.rows[1].status,'available')
  data.club.deletedAt=new Date()
  report=await refresh()
  assert.equal(report.rows[1].status,'cancelled')
  assert.equal(report.rows[1].cancelReason,'Clube excluído ou cancelado.')
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

test('approval binds the saved invitation referral, ignores forged commission and preserves server percentage',async t=>{
  const club=fixture();club.id='CLB-FIXED-REFERRAL'
  const data=store(t,{club})
  const referral={partnerId:'partner-1',partnerName:'Parceiro Teste',percentage:30}
  t.mock.method(Invite,'findOne',async()=>({id:'invite-1',clubId:club.id,referral}))
  t.mock.method(Invite,'updateOne',async()=>({}))
  t.mock.method(mongoose.model('MasterSettings'),'findOne',async()=>({planName:'ClubeOn',planPrice:49.9}))
  t.mock.method(Club,'exists',async()=>false)
  let created
  t.mock.method(Club,'create',async value=>{created=value;return value})
  const result=await request('/api/master/clubs',{registrationInviteId:'invite-1',establishmentName:'Clube Indicado',ownerName:'Dono Teste',phone:'69999990000',dueDay:10,referral:{partnerId:'attacker',amount:1000}})
  assert.equal(result.status,201)
  assert.deepEqual(created.referral,{...referral,inviteId:'invite-1'})
  assert.equal(created.referral.percentage,30)
  assert.equal(data.rows.length,0)
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
  assert.equal(data.getRow().paymentId,'ASAAS-pay-test')
  assert.equal(data.payments[0].referralEligible,true)
  assert.equal((await request('/api/webhooks/asaas',body,headers)).status,200)
  assert.equal(data.payments.length,1)
  assert.equal((await request('/api/webhooks/asaas',{...body,id:'event-paid-2',event:'PAYMENT_RECEIVED'},headers)).status,200)
  assert.equal(data.payments.length,1)
  assert.equal((await request('/api/webhooks/asaas',{...body,id:'event-refund',event:'PAYMENT_REFUNDED'},headers)).status,200)
  assert.equal(data.payments[0].status,'cancelled')
  assert.equal(data.getRow().status,'cancelled')
  assert.equal(data.club.billing.status,'past_due')
  const renewal={...body,id:'event-renewal',payment:{...body.payment,id:'pay-renewal',dueDate:'2026-11-10'}}
  assert.equal((await request('/api/webhooks/asaas',renewal,headers)).status,200)
  assert.equal(data.rows.length,2)
  assert.equal(data.rows[1].status,'available')
  assert.equal(data.rows[1].amount,14.97)
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

test('legacy paid commission migrates once without changing amount or repaying the same monthly payment',async t=>{
  const club=fixture(), payment={id:'PAY-1',clubId:club.id,status:'paid',amount:49.9,referralEligible:true}
  const data=store(t,{club,payments:[payment],legacy:{firstPaymentId:'PAY-1',status:'paid',amount:20,paidAt:new Date(),payoutReference:'OLD-PIX'}})
  let report=await refresh()
  assert.equal(report.rows[0].status,'paid')
  assert.equal(report.rows[0].amount,20)
  assert.equal(report.rows[0].payoutReference,'OLD-PIX')
  data.payments.push({...payment,id:'PAY-2'})
  report=await refresh()
  assert.equal(report.rows.length,2)
  assert.equal(report.totals.available,14.97)
  assert.equal(report.totals.paid,20)
  assert.equal((await refresh()).rows.length,2)
})

test('active-client list is Master-only, excludes expired/demo/deleted/suspended clients and exposes no personal data',async t=>{
  const data=store(t)
  let report=await refresh()
  assert.equal(report.clients[0].active,true)
  assert.equal(report.clients[0].partnerId,'partner-1')
  assert.equal(report.clients[0].ownerName,undefined)
  data.club.billing.nextDueDate=new Date('2000-01-01')
  assert.equal((await refresh()).clients[0].active,false)
  for(const patch of [{demoMode:true},{deletedAt:new Date()},{system:{status:'suspended'}},{billing:{status:'past_due'}}]) assert.equal(activeReferralClient({...fixture(),...patch}),false)
})

test('15 then 9 paid monthly payments yield R$224.55 then R$134.73, only on actual paid value',()=>{
  assert.equal(commissionAmount(49.9,30),14.97)
  assert.equal(commissionAmount(49.9,30)*15,224.55)
  assert.equal(Math.round(commissionAmount(49.9,30)*9*100)/100,134.73)
  assert.equal(commissionAmount(39.9,30),11.97)
})

test('percentage saved on payment survives later club percentage edits',async t=>{
  const data=store(t)
  data.payments.push({id:'PAY-1',clubId:data.club.id,status:'paid',amount:49.9,referralEligible:true,referralPercentage:30})
  data.club.referral.percentage=50
  assert.equal((await refresh()).rows[0].amount,14.97)
})

test('report counts 15 initial subscriptions and only 9 renewals, isolating partners and paid commissions',async t=>{
  const data=store(t)
  const clubs=Array.from({length:15},(_,index)=>({...fixture(),id:'CLB-'+index}))
  clubs.push({...fixture(),id:'CLB-OTHER',referral:{partnerId:'partner-2',partnerName:'Outro parceiro',percentage:30}})
  t.mock.method(Club,'find',()=>({setOptions:()=>({lean:async()=>clubs})}))
  for(const club of clubs) data.payments.push({id:club.id+'-OCT',clubId:club.id,status:'paid',amount:49.9,referralEligible:true,cycleStart:new Date('2026-10-10')})
  let report=await refresh()
  assert.equal(report.partnerTotals['partner-1'].available,224.55)
  assert.equal(report.partnerTotals['partner-2'].available,14.97)
  for(const row of data.rows.filter(row=>row.partnerId==='partner-1')) { row.status='paid';row.paidAt=new Date();row.payoutReference='OCT-PIX' }
  for(const club of clubs.slice(0,9)) data.payments.push({id:club.id+'-NOV',clubId:club.id,status:'paid',amount:49.9,referralEligible:true,cycleStart:new Date('2026-11-10')})
  for(const club of clubs.slice(9,15)) data.payments.push({id:club.id+'-NOV',clubId:club.id,status:'pending',amount:49.9,referralEligible:true})
  report=await refresh()
  assert.equal(report.partnerTotals['partner-1'].paid,224.55)
  assert.equal(report.partnerTotals['partner-1'].available,134.73)
  assert.equal(report.rows.filter(row=>row.partnerId==='partner-1').length,24)
  assert.equal((await refresh()).partnerTotals['partner-1'].available,134.73)
})

test('legacy available amount changes to 30%, legacy cancelled payment stays cancelled, next cycle qualifies',async t=>{
  const club=fixture(), payment={id:'PAY-1',clubId:club.id,status:'paid',amount:49.9,referralEligible:true}
  const legacy={firstPaymentId:'PAY-1',status:'available',amount:20}
  const data=store(t,{club,payments:[payment],legacy})
  assert.equal((await refresh()).totals.available,14.97)
  data.rows.length=0;legacy.status='cancelled';legacy.cancelReason='Cancelamento anterior'
  let report=await refresh()
  assert.equal(report.rows[0].status,'cancelled')
  assert.equal(report.rows[0].cancelReason,'Cancelamento anterior')
  data.payments.push({...payment,id:'PAY-2'})
  report=await refresh()
  assert.equal(report.totals.available,14.97)
  assert.equal(report.rows.length,2)
})
