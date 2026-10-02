import { useEffect, useState } from 'react'
import { RefreshCcw, Pencil, Users, X } from 'lucide-react'
import { api } from './api'
const money = value => Number(value || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const labels = { available:'Disponível', paid:'Paga', cancelled:'Cancelada' }
const initial = { name:'', phone:'', commissionPercentage:'30', active:true }
export default function ReferralPartners() {
  const [partners,setPartners] = useState([])
  const [report,setReport] = useState({rows:[],totals:{}})
  const [form,setForm] = useState(initial)
  const [editing,setEditing] = useState(null)
  const [filter,setFilter] = useState('')
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [message,setMessage] = useState('')
  const [payout,setPayout] = useState(null)
  const [reference,setReference] = useState('')
  const [confirmed,setConfirmed] = useState(false)
  const [cancel,setCancel] = useState(null)
  const [reason,setReason] = useState('')
  const [clientPartner,setClientPartner] = useState(null)
  const load = async () => {
    const [list,data] = await Promise.all([api.referralPartners(),api.referralCommissions()])
    setPartners(list); setReport(data)
  }
  const run = async action => {
    if (busy) return
    setBusy(true);setError('');setMessage('')
    try { await action() } catch(err) { setError(err.message) } finally { setBusy(false) }
  }
  useEffect(() => { void run(load) },[])
  const save = event => {
    event.preventDefault()
    void run(async () => {
      const payload = {...form,commissionPercentage:Number(form.commissionPercentage)}
      if(editing) await api.updateReferralPartner(editing,payload)
      else await api.createReferralPartner(payload)
      setEditing(null);setForm(initial);await load();setMessage('Parceiro salvo. O percentual vale para os próximos convites. Os vínculos existentes mantêm seu percentual.')
    })
  }
  const rows = report.rows.filter(row => !filter || row.partnerId === filter)
  const totals = filter ? report.partnerTotals?.[filter] || {} : report.totals
  const activeClients = (report.clients || []).filter(client=>client.partnerId===clientPartner?.id && client.active)
  const date = value => value ? new Date(value).toLocaleDateString('pt-BR') : '—'
  return <section className="content-card referral-panel">
    <div className="card-head"><div><span>Indicações comerciais</span><h2>Parceiros e comissões</h2></div><button disabled={busy} onClick={() => void run(load)}><RefreshCcw size={16}/>{busy?'Atualizando...':'Atualizar'}</button></div>
    <p className="referral-help">Cadastre o parceiro e selecione “Indicado por” ao gerar o link de pré-cadastro em Clientes. A comissão é recorrente sobre cada mensalidade efetivamente paga. Pagamentos de reservas e testes não geram comissão.</p>
    {error && <div className="form-error" role="alert">{error}</div>}{message && <p className="referral-success" role="status">{message}</p>}
    <p className="referral-help"><strong>Acumulado: {filter ? partners.find(partner=>partner.id===filter)?.name : 'todos os parceiros'}</strong></p>
    <div className="referral-totals">{Object.entries(labels).map(([status,label])=><article key={status}><span>{label}</span><strong>{money(totals[status])}</strong></article>)}</div>
    <form className="referral-form" onSubmit={save}><h3>{editing?'Editar parceiro':'Novo parceiro'}</h3><label>Nome<input required minLength={3} maxLength={120} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>WhatsApp<input required type="tel" maxLength={30} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label><label>Comissão mensal (%)<input required type="number" min="0.01" max="100" step="0.01" value={form.commissionPercentage} onChange={e=>setForm({...form,commissionPercentage:e.target.value})}/></label><label className="referral-check"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/>Parceiro ativo</label><div className="referral-actions"><button className="primary-wide" disabled={busy}>{editing?'Salvar alterações':'Cadastrar parceiro'}</button>{editing && <button type="button" disabled={busy} onClick={()=>{setEditing(null);setForm(initial)}}>Cancelar edição</button>}</div></form>
    <div className="table-wrap"><table><caption className="demo-table-caption">Parceiros cadastrados</caption><thead><tr><th>Parceiro</th><th>Contato</th><th>Comissão</th><th>Status</th><th>Ações</th></tr></thead><tbody>{partners.map(partner=><tr key={partner.id}><td>{partner.name}</td><td>{partner.phone}</td><td>{partner.commissionPercentage ?? 30}%</td><td>{partner.active?'Ativo':'Inativo'}</td><td><div className="partner-row-actions"><button type="button" className="partner-action partner-action-primary" aria-label={"Ver clientes ativos de " + partner.name} disabled={busy} onClick={()=>setClientPartner(partner)}><Users size={17} aria-hidden="true"/><span>Clientes ativos</span><span className="partner-client-count">{(report.clients || []).filter(client=>client.partnerId===partner.id && client.active).length}</span></button><button type="button" className="partner-action partner-action-secondary" aria-label={"Editar parceiro " + partner.name} disabled={busy} onClick={()=>{setEditing(partner.id);setForm({name:partner.name,phone:partner.phone,commissionPercentage:String(partner.commissionPercentage ?? 30),active:partner.active})}}><Pencil size={16} aria-hidden="true"/><span>Editar</span></button></div></td></tr>)}{!partners.length && <tr><td colSpan={5}>Cadastre seu primeiro parceiro acima.</td></tr>}</tbody></table></div>
    <div className="referral-filter"><h3>Indicações e pagamentos</h3><label>Parceiro<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Todos os parceiros</option>{partners.map(partner=><option key={partner.id} value={partner.id}>{partner.name}</option>)}</select></label></div>
    <div className="table-wrap"><table><thead><tr><th>Clube</th><th>Parceiro</th><th>Mensalidade / período</th><th>Comissão</th><th>Situação</th><th>Ações / registro</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.clubName}</td><td>{row.partnerName}</td><td>{money(row.baseAmount)}<small>{date(row.cycleStart || row.qualifiedAt)} → {date(row.cycleEnd)}</small><small>Pagamento: {row.paymentId}</small></td><td>{money(row.amount)}<small>{row.percentage ? row.percentage + '%' : 'Repasse anterior preservado'}</small></td><td>{labels[row.status]}{row.paymentReversedAt && row.status==='paid' && <small className="referral-warning">Mensalidade revertida após o repasse. Revisar com o parceiro.</small>}{row.cancelReason && <small>{row.cancelReason}</small>}</td><td>{row.status==='available' && <button disabled={busy} onClick={()=>{setPayout(row);setReference('');setConfirmed(false);setError('')}}>Registrar Pix pago</button>}{row.status==='available' && <button disabled={busy} onClick={()=>{setCancel(row);setReason('');setError('')}}>Cancelar comissão</button>}{row.status==='paid' && <><span>{new Date(row.paidAt).toLocaleDateString('pt-BR')}</span><small>{row.payoutReference}</small></>}</td></tr>)}{!rows.length && <tr><td colSpan={6}>As comissões aparecerão quando os clubes indicados pagarem suas mensalidades.</td></tr>}</tbody></table></div>
    <p className="referral-help">Os totais acompanham o parceiro selecionado e acumulam todo o histórico. Cada mensalidade paga gera uma comissão; meses sem pagamento não geram valores. Inativar um parceiro impede novos convites, sem apagar o histórico. Revise indicações duplicadas ou do próprio parceiro antes de concluir o cadastro.</p>
    {clientPartner && <div className="modal-backdrop"><div className="modal referral-clients-modal"><div className="modal-head"><h2>Clientes ativos • {clientPartner.name}</h2><button className="icon-button" aria-label="Fechar" onClick={()=>setClientPartner(null)}><X/></button></div><p>Clubes em produção com sistema ativo e mensalidade ativa ou período de teste válido. A comissão depende do pagamento, inclusive para clientes em teste.</p><div className="table-wrap"><table><thead><tr><th>Clube</th><th>Mensalidade</th><th>Vencimento</th></tr></thead><tbody>{activeClients.map(client=><tr key={client.id}><td>{client.name}</td><td>{client.billingStatus==='trial'?'Em teste':'Ativa'}</td><td>{date(client.nextDueDate)}</td></tr>)}{!activeClients.length && <tr><td colSpan={3}>Este parceiro ainda não tem clientes ativos.</td></tr>}</tbody></table></div></div></div>}
    {payout && <div className="modal-backdrop"><div className="modal referral-modal"><div className="modal-head"><h2>Registrar comissão paga</h2><button className="icon-button" aria-label="Fechar" disabled={busy} onClick={()=>setPayout(null)}><X/></button></div><p>{payout.partnerName} • {payout.clubName} • <strong>{money(payout.amount)}</strong></p><p>Faça o Pix por fora do sistema e registre aqui. Este botão não transfere dinheiro.</p>{error && <div className="form-error" role="alert">{error}</div>}<form onSubmit={e=>{e.preventDefault();void run(async()=>{await api.payReferralCommission(payout.id,{reference,confirmPaid:confirmed});setPayout(null);await load();setMessage('Pagamento da comissão registrado.')})}}><label>Referência / comprovante<input required minLength={3} maxLength={160} value={reference} onChange={e=>setReference(e.target.value)} placeholder="Ex.: ID da transação Pix"/></label><label className="referral-check"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo que já paguei o parceiro.</label><button className="primary-wide" disabled={busy || !confirmed}>{busy?'Registrando...':'Confirmar registro'}</button></form></div></div>}
    {cancel && <div className="modal-backdrop"><div className="modal referral-modal"><div className="modal-head"><h2>Cancelar comissão</h2><button className="icon-button" aria-label="Fechar" disabled={busy} onClick={()=>setCancel(null)}><X/></button></div><p>{cancel.clubName} • {cancel.partnerName}</p>{error && <div className="form-error" role="alert">{error}</div>}<form onSubmit={e=>{e.preventDefault();void run(async()=>{await api.cancelReferralCommission(cancel.id,{reason});setCancel(null);await load();setMessage('Comissão cancelada. O histórico foi preservado.')})}}><label>Motivo<input required minLength={3} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="primary-wide" disabled={busy}>Confirmar cancelamento</button></form></div></div>}
  </section>
}
