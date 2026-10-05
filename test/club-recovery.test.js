import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { installClubRecovery, recoveryPhone } from '../server/club-recovery.js'
const rows = new Map(), pushes = []
let club = { id: 'CLB-A', phone: '69999990000', establishmentName: 'Clube A', ownerName: 'Dono A', demoMode: false }
let issued = 0
const Request = {
  async updateOne(filter, update, options) {
    const row = rows.get(filter.clubId)
    if (!row && options?.upsert) rows.set(filter.clubId, { clubId: filter.clubId, ...update.$setOnInsert })
    else if (row && (!filter.status || (typeof filter.status === 'object' ? row.status !== filter.status.$ne && row.requestedAt < filter.requestedAt.$lt : row.status === filter.status))) Object.assign(row, update.$set)
  },
  findOneAndUpdate(filter, update) { return { lean: async () => { const row = rows.get(filter.clubId); if (!row || row.status !== filter.status || row.pushRequestedAt && row.pushRequestedAt > filter.$or[2].pushRequestedAt.$lte) return null; Object.assign(row, update.$set); return {...row} } } },
  findOne(filter) { return { lean: async () => { const row = rows.get(filter.clubId); return row?.status === filter.status ? {...row} : null } } },
  async countDocuments(filter) { return [...rows.values()].filter(x => x.status === filter.status).length },
  find(filter) { return { sort: () => ({ limit: () => ({ lean: async () => [...rows.values()].filter(x => x.status === filter.status) }) }) } }
}
const Club = { findOne: async ({id}) => id === club.id ? {...club} : null, find: () => ({ select: () => ({ lean: async () => [{...club}] }) }) }
const app = express(); app.use(express.json())
const master = (req,res,next) => req.get('x-master') === 'yes' ? next() : res.sendStatus(401)
installClubRecovery({ app, mongoose: { models: { ClubRecoveryRequest: Request } }, Club, requireMaster: master, authenticateClubLicense: (req,res,next) => { if(req.get('x-license') !== 'A') return res.sendStatus(401); req.club = {...club}; next() }, writeLimiter: (_q,_r,n) => n(), notifyMaster: payload => pushes.push(payload), logAction: async () => {}, createAccessLink: async (c) => { issued++; return {url:'https://master.test/?adminAccessToken=synthetic',whatsappUrl:'https://wa.me/55'+c.phone,expiresAt:new Date()} } })
app.use((e,_q,res,_n) => res.status(e.statusCode || 500).json({error:e.message}))
const server=app.listen(0,'127.0.0.1');await once(server,'listening');after(()=>server.close())
const base='http://127.0.0.1:'+server.address().port
const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)})
test('phone normalization accepts Brazilian formats and rejects malformed input',()=>{
  assert.equal(recoveryPhone('+55 (69) 99999-0000'),'69999990000')
  assert.equal(recoveryPhone('(69) 3333-0000'),'6933330000')
  for(const phone of ['abc69999990000','123','1'.repeat(31),null,{}]) assert.equal(recoveryPhone(phone),'')
})
test('recovery is club-scoped, non-enumerating, throttles push and only Master can issue links',async()=>{
  assert.equal((await post('/api/license/admin-auth/recovery',{phone:club.phone})).status,401)
  const unknown=await (await post('/api/license/admin-auth/recovery',{phone:'69988880000'},{'x-license':'A'})).json();assert.equal(rows.size,0)
  const known=await (await post('/api/license/admin-auth/recovery',{phone:'+55 (69) 99999-0000',clubId:'CLB-B'},{'x-license':'A'})).json();assert.deepEqual(known,unknown);assert.equal(rows.size,1);assert.equal(rows.has('CLB-B'),false);assert.equal(issued,0);assert.equal(pushes.length,1)
  await post('/api/license/admin-auth/recovery',{phone:club.phone},{'x-license':'A'});assert.equal(pushes.length,1)
  club.demoMode=true;await post('/api/license/admin-auth/recovery',{phone:club.phone},{'x-license':'A'});assert.equal(pushes.length,1);club.demoMode=false
  rows.get(club.id).pushRequestedAt=new Date(Date.now()-61000)
  await post('/api/license/admin-auth/recovery',{phone:club.phone},{'x-license':'A'});assert.equal(pushes.length,2);assert.equal(pushes[1].url,'/?view=notifications');assert.doesNotMatch(JSON.stringify(pushes),/69999990000|adminAccessToken|password/)
  assert.equal((await fetch(base+'/api/master/club-recovery')).status,401)
  assert.equal((await post('/api/master/club-recovery/CLB-A/issue',{})).status,401)
  const list=await (await fetch(base+'/api/master/club-recovery',{headers:{'x-master':'yes'}})).json();assert.equal(list.count,1);assert.equal(list.requests[0].phone,club.phone)
  club.phone='69977770000';assert.equal((await post('/api/master/club-recovery/CLB-A/issue',{}, {'x-master':'yes'})).status,409);assert.equal(issued,0)
  club.phone='69999990000';const link=await post('/api/master/club-recovery/CLB-A/issue',{phone:'69911110000'},{'x-master':'yes'});assert.equal(link.status,200);assert.equal((await link.json()).whatsappUrl,'https://wa.me/5569999990000');assert.equal(rows.get(club.id).status,'issued');assert.equal(issued,1)
  assert.equal((await post('/api/master/club-recovery/CLB-A/issue',{}, {'x-master':'yes'})).status,404)
})
