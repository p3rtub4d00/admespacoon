import crypto from 'node:crypto'

const bad = message => Object.assign(new Error(message), { statusCode: 400 })
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
export function validatePartner(input) {
  if (typeof input?.name !== 'string' || input.name.trim().length < 3 || input.name.length > 120) throw bad('Informe o nome do parceiro (3 a 120 caracteres).')
  if (typeof input.phone !== 'string' || input.phone.length > 30) throw bad('Informe o telefone do parceiro.')
  const phone = input.phone.replace(/\D/g, '')
  if (!/^\d{10,13}$/.test(phone)) throw bad('Informe um telefone válido.')
  const percentage = input.commissionPercentage === undefined ? 30 : input.commissionPercentage
  if (typeof percentage !== 'number' || !Number.isFinite(percentage) || Math.round(percentage * 100) < 1 || percentage > 100) throw bad('A comissão deve ser maior que zero e até 100%.')
  if (input.active !== undefined && typeof input.active !== 'boolean') throw bad('Status do parceiro inválido.')
  return { name: input.name.trim(), phone, commissionPercentage: Math.round(percentage * 100) / 100, active: input.active !== false }
}

export function isReferralMonthlyPayment(club, payment) {
  if (club?.demoMode === true || !club?.referral?.partnerId) return false
  return Boolean(
    (payment?.subscription && club.billing?.asaasSubscriptionId && payment.subscription === club.billing.asaasSubscriptionId) ||
    (payment?.id && club.billing?.currentPaymentId && payment.id === club.billing.currentPaymentId)
  )
}

export const referralPercentage = referral => Number.isFinite(referral?.percentage) && referral.percentage > 0 && referral.percentage <= 100 ? referral.percentage : 30
export const commissionAmount = (amount, percentage) => Math.round(Math.round(amount * 100) * percentage / 100) / 100
export function activeReferralClient(club, now = new Date()) {
  return !club.deletedAt && club.demoMode !== true && club.system?.status === 'active' && ['active','trial'].includes(club.billing?.status) && (!club.billing.nextDueDate || new Date(club.billing.nextDueDate) >= now)
}

export function installReferrals({ app, mongoose, Club, Payment, requireMaster, writeLimiter, logAction }) {
  const Partner = mongoose.model('ReferralPartner', new mongoose.Schema({
    id: { type: String, required: true, unique: true }, name: String, phone: String,
    commissionAmount: Number, commissionPercentage: Number, active: { type: Boolean, default: true },
  }, { timestamps: true }))
  const LegacyCommission = mongoose.model('ReferralCommission', new mongoose.Schema({
    clubId: { type: String, required: true, unique: true }, clubName: String,
    inviteId: String, partnerId: { type: String, required: true, index: true }, partnerName: String,
    amount: Number, status: { type: String, enum: ['pending','available','paid','cancelled'], default: 'pending', index: true },
    firstPaymentId: String, qualifiedAt: Date, paidAt: Date, payoutReference: String,
    cancelledAt: Date, cancelReason: String, paymentReversedAt: Date,
  }, { timestamps: true }))

  // Separate collection avoids removing the legacy unique clubId index or losing payout history.
  const Commission = mongoose.model('ReferralMonthlyCommission', new mongoose.Schema({
    id: { type: String, required: true, unique: true }, paymentId: { type: String, required: true },
    clubId: { type: String, required: true, index: true }, clubName: String, inviteId: String,
    partnerId: { type: String, required: true, index: true }, partnerName: String,
    amount: Number, baseAmount: Number, percentage: Number, cycleStart: Date, cycleEnd: Date,
    status: { type: String, enum: ['available','paid','cancelled'], index: true },
    qualifiedAt: Date, paidAt: Date, payoutReference: String,
    cancelledAt: Date, cancelReason: String, paymentReversedAt: Date,
  }, { timestamps: true }))

  async function snapshot(partnerId) {
    if (partnerId === undefined || partnerId === null || partnerId === '') return null
    if (typeof partnerId !== 'string' || partnerId.length > 80) throw bad('Parceiro inválido.')
    const partner = await Partner.findOne({ id: partnerId, active: true }).lean()
    if (!partner) throw bad('Parceiro não encontrado ou inativo.')
    return { partnerId: partner.id, partnerName: partner.name, percentage: referralPercentage({percentage:partner.commissionPercentage}) }
  }
  const commissionId = (clubId, paymentId) => crypto.createHash('sha256').update(JSON.stringify([clubId,paymentId])).digest('hex')
  async function sync(club) {
    if (!club?.referral?.partnerId) return []
    const referral = club.referral
    const legacy = await LegacyCommission.findOne({clubId:club.id}).lean()
    const payments = await Payment.find({ clubId:club.id, referralEligible:true, amount:{$gt:0}, status:{$in:['paid','cancelled']} }).sort({paidAt:1,createdAt:1,id:1}).lean()
    for (const payment of payments) {
      const id = commissionId(club.id,payment.id)
      const old = legacy?.firstPaymentId === payment.id ? legacy : null
      const percentage = referralPercentage({percentage:payment.referralPercentage ?? referral.percentage})
      const seed = { id, paymentId:payment.id, clubId:club.id, clubName:club.establishmentName,
        inviteId:referral.inviteId, partnerId:referral.partnerId, partnerName:referral.partnerName,
        baseAmount:payment.amount, percentage, amount:commissionAmount(payment.amount,percentage),
        cycleStart:payment.cycleStart, cycleEnd:payment.cycleEnd, qualifiedAt:payment.paidAt || payment.createdAt,
        status:'available' }
      // Import only the same payment, preserving historical paid/cancelled decisions.
      if (old?.status === 'paid') Object.assign(seed,{status:'paid',amount:old.amount,percentage:null,paidAt:old.paidAt,payoutReference:old.payoutReference,paymentReversedAt:old.paymentReversedAt})
      if (old?.status === 'cancelled') Object.assign(seed,{status:'cancelled',cancelledAt:old.cancelledAt,cancelReason:old.cancelReason,paymentReversedAt:old.paymentReversedAt})
      const current = await Commission.findOne({id}).lean()
      if (!current && !old && club.demoMode === true) continue
      try { await Commission.updateOne({id},{$setOnInsert:seed},{upsert:true}) }
      catch(error) { if(error.code !== 11000) throw error }
    }
    const rows = await Commission.find({clubId:club.id}).lean()
    for (const row of rows) {
      if (row.status === 'cancelled') continue
      const payment = payments.find(item=>item.id===row.paymentId)
      if (!payment || payment.status !== 'paid') {
        await Commission.updateOne({id:row.id,status:row.status},{$set:{paymentReversedAt:row.paymentReversedAt || new Date(),...(row.status==='paid'?{}:{status:'cancelled',cancelledAt:new Date(),cancelReason:'Mensalidade revertida ou indisponível.'})}})
      } else if (club.deletedAt || club.system?.status === 'cancelled') {
        await Commission.updateOne({id:row.id,status:'available'},{$set:{status:'cancelled',cancelledAt:new Date(),cancelReason:'Clube excluído ou cancelado.'}})
      }
    }
    return Commission.find({clubId:club.id}).lean()
  }

  async function safeSync(club) {
    if (!club?.referral?.partnerId) return
    try { await sync(club) } catch { console.warn('Comissão pendente de atualização; revise Parceiros e indicações.') }
  }
  app.get('/api/master/referral-partners', requireMaster, async (_req,res,next) => {
    try { res.json(await Partner.find().sort({ name: 1 }).lean()) } catch (error) { next(error) }
  })
  app.post('/api/master/referral-partners', requireMaster, writeLimiter, async (req,res,next) => {
    try {
      const partner = await Partner.create({ id: crypto.randomUUID(), ...validatePartner(req.body) })
      await logAction('referral.partner_created','Parceiro de indicação cadastrado.',null,{partnerId:partner.id})
      res.status(201).json(partner)
    } catch (error) { next(error) }
  })
  app.put('/api/master/referral-partners/:id', requireMaster, writeLimiter, async (req,res,next) => {
    try {
      const partner = await Partner.findOneAndUpdate({ id:req.params.id }, { $set: validatePartner(req.body) }, { new:true })
      if (!partner) return res.status(404).json({error:'Parceiro não encontrado.'})
      await logAction('referral.partner_updated','Parceiro de indicação atualizado.',null,{partnerId:partner.id})
      res.json(partner)
    } catch (error) { next(error) }
  })
  app.get('/api/master/referral-commissions', requireMaster, async (_req,res,next) => {
    try {
      const clubs = await Club.find({ 'referral.partnerId': { $exists:true } }).setOptions({ includeDeleted:true }).lean()
      // Reconcile from persisted monthly payments; a failed hook is repaired here.
      for (const club of clubs) await sync(club)
      const rows = await Commission.find().sort({ createdAt:-1 }).lean()
      const totalSeed = () => ({available:0,paid:0,cancelled:0})
      const totals = totalSeed(), partnerTotals = {}
      for (const row of rows) {
        partnerTotals[row.partnerId] ||= totalSeed()
        totals[row.status] = Math.round((totals[row.status] + (row.amount || 0))*100)/100
        partnerTotals[row.partnerId][row.status] = Math.round((partnerTotals[row.partnerId][row.status] + (row.amount || 0))*100)/100
      }
      const clients = clubs.map(club=>({id:club.id,partnerId:club.referral.partnerId,name:club.establishmentName,active:activeReferralClient(club),billingStatus:club.demoMode?'demo':club.billing?.status,nextDueDate:club.billing?.nextDueDate,deleted:Boolean(club.deletedAt)}))
      res.json({rows,totals,partnerTotals,clients})
    } catch (error) { next(error) }
  })
  app.post('/api/master/referral-commissions/:commissionId/paid', requireMaster, writeLimiter, async (req,res,next) => {
    try {
      if (req.body?.confirmPaid !== true) throw bad('Confirme que o Pix ao parceiro já foi realizado.')
      const reference = clean(req.body?.reference,160)
      if (reference.length < 3 || typeof req.body.reference !== 'string' || req.body.reference.length > 160) throw bad('Informe uma referência do pagamento (3 a 160 caracteres).')
      const selected = await Commission.findOne({id:req.params.commissionId}).lean()
      if (!selected) return res.status(404).json({error:'Comissão não encontrada.'})
      const club = await Club.findOne({ id:selected.clubId })
      if (!club || club.demoMode) return res.status(409).json({error:'Clube indisponível para comissão.'})
      await sync(club)
      const row = await Commission.findOneAndUpdate({id:selected.id,status:'available',paymentReversedAt:null},{$set:{status:'paid',paidAt:new Date(),payoutReference:reference}},{new:true})
      if (!row) return res.status(409).json({error:'Comissão já alterada. Atualize o relatório.'})
      await logAction('referral.commission_paid','Pagamento manual da comissão registrado.',club,{partnerId:row.partnerId,amount:row.amount,reference})
      res.json(row)
    } catch (error) { next(error) }
  })
  app.post('/api/master/referral-commissions/:commissionId/cancel', requireMaster, writeLimiter, async (req,res,next) => {
    try {
      const reason = clean(req.body?.reason,300)
      if (reason.length < 3) throw bad('Informe o motivo do cancelamento.')
      const row = await Commission.findOneAndUpdate({id:req.params.commissionId,status:'available'},{$set:{status:'cancelled',cancelledAt:new Date(),cancelReason:reason}},{new:true})
      if (!row) return res.status(409).json({error:'Comissão não encontrada ou já finalizada.'})
      await logAction('referral.commission_cancelled','Comissão cancelada pelo Master.',null,{clubId:row.clubId,reason})
      res.json(row)
    } catch (error) { next(error) }
  })
  return { snapshot, safeSync, sync, Partner, Commission }
}
