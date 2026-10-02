import crypto from 'node:crypto'

const bad = message => Object.assign(new Error(message), { statusCode: 400 })
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
export function validatePartner(input) {
  if (typeof input?.name !== 'string' || input.name.trim().length < 3 || input.name.length > 120) throw bad('Informe o nome do parceiro (3 a 120 caracteres).')
  if (typeof input.phone !== 'string' || input.phone.length > 30) throw bad('Informe o telefone do parceiro.')
  const phone = input.phone.replace(/\D/g, '')
  if (!/^\d{10,13}$/.test(phone)) throw bad('Informe um telefone válido.')
  const amount = input.commissionAmount === undefined ? 20 : input.commissionAmount
  if (typeof amount !== 'number' || !Number.isFinite(amount) || Math.round(amount * 100) < 1 || amount > 1000) throw bad('A comissão deve ser maior que zero e até R$ 1.000.')
  if (input.active !== undefined && typeof input.active !== 'boolean') throw bad('Status do parceiro inválido.')
  return { name: input.name.trim(), phone, commissionAmount: Math.round(amount * 100) / 100, active: input.active !== false }
}

export function isReferralMonthlyPayment(club, payment) {
  if (club?.demoMode === true || !club?.referral?.partnerId) return false
  return Boolean(
    (payment?.subscription && club.billing?.asaasSubscriptionId && payment.subscription === club.billing.asaasSubscriptionId) ||
    (payment?.id && club.billing?.currentPaymentId && payment.id === club.billing.currentPaymentId)
  )
}

export function installReferrals({ app, mongoose, Club, Payment, requireMaster, writeLimiter, logAction }) {
  const Partner = mongoose.model('ReferralPartner', new mongoose.Schema({
    id: { type: String, required: true, unique: true }, name: String, phone: String,
    commissionAmount: Number, active: { type: Boolean, default: true },
  }, { timestamps: true }))
  const Commission = mongoose.model('ReferralCommission', new mongoose.Schema({
    clubId: { type: String, required: true, unique: true }, clubName: String,
    inviteId: String, partnerId: { type: String, required: true, index: true }, partnerName: String,
    amount: Number, status: { type: String, enum: ['pending','available','paid','cancelled'], default: 'pending', index: true },
    firstPaymentId: String, qualifiedAt: Date, paidAt: Date, payoutReference: String,
    cancelledAt: Date, cancelReason: String, paymentReversedAt: Date,
  }, { timestamps: true }))

  async function snapshot(partnerId) {
    if (partnerId === undefined || partnerId === null || partnerId === '') return null
    if (typeof partnerId !== 'string' || partnerId.length > 80) throw bad('Parceiro inválido.')
    const partner = await Partner.findOne({ id: partnerId, active: true }).lean()
    if (!partner) throw bad('Parceiro não encontrado ou inativo.')
    return { partnerId: partner.id, partnerName: partner.name, amount: partner.commissionAmount }
  }

  async function sync(club) {
    if (!club?.referral?.partnerId) return null
    const referral = club.referral
    const seed = { clubId: club.id, clubName: club.establishmentName, inviteId: referral.inviteId, partnerId: referral.partnerId, partnerName: referral.partnerName, amount: referral.amount, status: 'pending' }
    try { await Commission.updateOne({ clubId: club.id }, { $setOnInsert: seed }, { upsert: true }) }
    catch (error) { if (error.code !== 11000) throw error }
    let row = await Commission.findOne({ clubId: club.id }).lean()
    if (!row || row.status === 'cancelled') return row
    if (club.deletedAt || club.system?.status === 'cancelled') {
      if (['pending','available'].includes(row.status)) await Commission.updateOne({ clubId: club.id, status: { $in: ['pending','available'] } }, { $set: { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Clube excluído ou cancelado.' } })
      return Commission.findOne({ clubId: club.id }).lean()
    }
    if (!row.firstPaymentId && club.demoMode !== true) {
      const first = await Payment.findOne({ clubId: club.id, referralEligible: true, status: { $in: ['paid','cancelled'] }, amount: { $gt: 0 } }).sort({ paidAt: 1, createdAt: 1, id: 1 }).lean()
      if (first) {
        await Commission.updateOne({ clubId: club.id, status: 'pending', firstPaymentId: null }, { $set: { firstPaymentId: first.id, qualifiedAt: first.paidAt || new Date(), status: first.status === 'paid' ? 'available' : 'cancelled', ...(first.status === 'cancelled' ? { cancelledAt: new Date(), cancelReason: 'Primeira mensalidade revertida.', paymentReversedAt: new Date() } : {}) } })
        row = await Commission.findOne({ clubId: club.id }).lean()
      }
    }
    if (row?.firstPaymentId) {
      const first = await Payment.findOne({ id: row.firstPaymentId, clubId: club.id }).lean()
      if (!first || first.status !== 'paid') {
        await Commission.updateOne({ clubId: club.id, status: { $in: ['available','paid'] } }, { $set: { paymentReversedAt: row.paymentReversedAt || new Date(), ...(row.status === 'paid' ? {} : { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Primeira mensalidade revertida ou indisponível.' }) } })
      }
    }
    return Commission.findOne({ clubId: club.id }).lean()
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
      const totals = { pending:0, available:0, paid:0, cancelled:0 }
      for (const row of rows) totals[row.status] += row.amount || 0
      res.json({ rows, totals })
    } catch (error) { next(error) }
  })
  app.post('/api/master/referral-commissions/:clubId/paid', requireMaster, writeLimiter, async (req,res,next) => {
    try {
      if (req.body?.confirmPaid !== true) throw bad('Confirme que o Pix ao parceiro já foi realizado.')
      const reference = clean(req.body?.reference,160)
      if (reference.length < 3 || typeof req.body.reference !== 'string' || req.body.reference.length > 160) throw bad('Informe uma referência do pagamento (3 a 160 caracteres).')
      const club = await Club.findOne({ id:req.params.clubId })
      if (!club || club.demoMode) return res.status(409).json({error:'Clube indisponível para comissão.'})
      const current = await sync(club)
      if (!current || current.status !== 'available' || current.paymentReversedAt) return res.status(409).json({error:'Esta comissão não está disponível para pagamento.'})
      const row = await Commission.findOneAndUpdate({ clubId:club.id, status:'available', firstPaymentId:current.firstPaymentId, paymentReversedAt:null }, { $set:{status:'paid',paidAt:new Date(),payoutReference:reference} }, {new:true})
      if (!row) return res.status(409).json({error:'Comissão já alterada. Atualize o relatório.'})
      await logAction('referral.commission_paid','Pagamento manual da comissão registrado.',club,{partnerId:row.partnerId,amount:row.amount,reference})
      res.json(row)
    } catch (error) { next(error) }
  })
  app.post('/api/master/referral-commissions/:clubId/cancel', requireMaster, writeLimiter, async (req,res,next) => {
    try {
      const reason = clean(req.body?.reason,300)
      if (reason.length < 3) throw bad('Informe o motivo do cancelamento.')
      const row = await Commission.findOneAndUpdate({clubId:req.params.clubId,status:{$in:['pending','available']}},{$set:{status:'cancelled',cancelledAt:new Date(),cancelReason:reason}},{new:true})
      if (!row) return res.status(409).json({error:'Comissão não encontrada ou já finalizada.'})
      await logAction('referral.commission_cancelled','Comissão cancelada pelo Master.',null,{clubId:row.clubId,reason})
      res.json(row)
    } catch (error) { next(error) }
  })
  return { snapshot, safeSync, sync, Partner, Commission }
}
