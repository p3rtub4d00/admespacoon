import { useEffect, useState } from 'react'
import { CheckCircle2, Link2, ShieldCheck, X } from 'lucide-react'
import { api } from './api'

export function RegistrationPage({ token }) {
  const [valid, setValid] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [form, setForm] = useState({ establishmentName: '', ownerName: '', cpfCnpj: '', phone: '', email: '', city: '', state: '' })
  useEffect(() => {
    let alive = true
    if (!token) { setError('Abra o link de cadastro enviado pela equipe ClubeOn.'); setLoading(false); return }
    api.registrationInfo(token).then(() => { if (alive) setValid(true) }).catch(err => { if (alive) setError(err.message) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])
  const submit = async event => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      await api.completeRegistration({ ...form, token, privacyAcknowledged: acknowledged })
      setForm({ establishmentName: '', ownerName: '', cpfCnpj: '', phone: '', email: '', city: '', state: '' })
      setDone(true)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }))
  return <div className="login-shell"><main className="login-card registration-card">
    <div className="master-brand"><div className="master-brand-mark">CO</div><div><strong>ClubeOn</strong><span>CADASTRO DO ESTABELECIMENTO</span></div></div>
    <div className="login-icon">{done ? <CheckCircle2 /> : <ShieldCheck />}</div>
    <span className="eyebrow">{done ? 'Dados enviados' : 'Seu clube começa aqui'}</span>
    <h1>{done ? 'Tudo certo!' : 'Cadastre seu clube'}</h1>
    <p>{done ? 'A equipe ClubeOn recebeu seu cadastro e entrará em contato para concluir a configuração do sistema. Este link já foi utilizado.' : 'Preencha seus dados diretamente aqui. Você não precisa enviar documentos ou informações pessoais por mensagem.'}</p>
    {loading && <p>Verificando convite...</p>}
    {!done && valid && <form className="club-form" onSubmit={submit}>
      <label>Nome do clube<input required minLength={2} maxLength={120} autoComplete="organization" value={form.establishmentName} onChange={e => update('establishmentName', e.target.value)} /></label>
      <label>Nome do responsável<input required minLength={3} maxLength={120} autoComplete="name" value={form.ownerName} onChange={e => update('ownerName', e.target.value)} /></label>
      <label>CPF/CNPJ<input inputMode="numeric" maxLength={14} value={form.cpfCnpj} onChange={e => update('cpfCnpj', e.target.value.replace(/\D/g, ''))} /><small>Usado na identificação e na cobrança da assinatura, quando contratada.</small></label>
      <label>WhatsApp<input required type="tel" minLength={10} maxLength={13} autoComplete="tel" value={form.phone} onChange={e => update('phone', e.target.value.replace(/\D/g, ''))} /></label>
      <label>E-mail<input type="email" maxLength={160} autoComplete="email" value={form.email} onChange={e => update('email', e.target.value)} /></label>
      <label>Cidade<input maxLength={100} autoComplete="address-level2" value={form.city} onChange={e => update('city', e.target.value)} /></label>
      <label>UF<input maxLength={2} autoComplete="address-level1" value={form.state} onChange={e => update('state', e.target.value.toUpperCase())} /></label>
      <div className="registration-privacy full"><ShieldCheck size={22} /><div><strong>Seus dados merecem cuidado</strong><p>O envio neste site usa conexão criptografada HTTPS. Seus dados ficam disponíveis à equipe autorizada da plataforma para cadastro, suporte e cobrança. Você pode solicitar correções pelo contato da nossa <a href="/privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a>.</p></div></div>
      <label className="full registration-ack"><input type="checkbox" required checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />Li o aviso e a Política de Privacidade e estou ciente do uso dos dados para meu cadastro.</label>
      <p className="full registration-help">Este envio não gera cobrança nem libera o painel. A equipe concluirá a configuração com você.</p>
      {error && <div className="form-error full" role="alert">{error}</div>}
      <button className="primary-wide full" disabled={busy || !acknowledged}>{busy ? 'Enviando...' : 'Enviar meu cadastro'}</button>
    </form>}
    {!valid && error && <div className="form-error" role="alert">{error}</div>}
  </main></div>
}

export function RegistrationInvites({ refreshKey, onReview }) {
  const [rows, setRows] = useState([])
  const [partners, setPartners] = useState([])
  const [partnerId, setPartnerId] = useState('')
  const [link, setLink] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const load = async () => { try { const [invites, list] = await Promise.all([api.registrationInvites(), api.referralPartners()]); setRows(invites); setPartners(list); setError('') } catch (err) { setError(err.message) } }
  useEffect(() => { void load() }, [refreshKey])
  const create = async () => {
    setBusy(true); setError(''); setCopied(false)
    try { setLink(await api.createRegistrationInvite({ partnerId })); await load() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const revoke = async id => {
    setBusy(true)
    try { await api.revokeRegistrationInvite(id); if (link?.id === id) setLink(null); await load() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <div className="registration-invites">
    <div className="registration-head"><div><h3>Cadastro por convite</h3><p>Envie um link para o proprietário preencher os dados. Depois, revise e configure o clube aqui.</p></div><button className="primary-wide" disabled={busy} onClick={create}><Link2 size={17} /> Gerar link de cadastro</button></div>
    <label className="referral-invite-select">Indicado por (opcional)<select value={partnerId} disabled={busy} onChange={e => setPartnerId(e.target.value)}><option value="">Sem indicação</option>{partners.filter(partner => partner.active).map(partner => <option key={partner.id} value={partner.id}>{partner.name} • {partner.commissionPercentage ?? 30}% por mensalidade paga</option>)}</select><small>Cadastre os parceiros na seção Parceiros. O vínculo e o percentual ficam salvos neste convite.</small></label>
    {error && <div className="form-error" role="alert">{error}</div>}
    {rows.length > 0 && <div className="registration-list">{rows.map(row => <article key={row.id}><div><strong>{row.registration?.establishmentName || 'Convite aguardando preenchimento'}</strong><p>{row.submittedAt ? 'Cadastro recebido • ' + row.registration.ownerName : 'Link ' + (new Date(row.expiresAt) > new Date() ? 'válido até ' : 'expirado em ') + new Date(row.expiresAt).toLocaleString('pt-BR')}</p>{row.referral?.partnerId && <p className="referral-invite-credit">Indicação: {row.referral.partnerName} • Comissão recorrente {row.referral.percentage ?? 30}%</p>}</div><div className="registration-row-actions">{row.submittedAt && <button disabled={busy} onClick={() => onReview({ ...row.registration, registrationInviteId: row.id, referral: row.referral })}>Revisar e concluir</button>}<button className="secondary" disabled={busy} onClick={() => revoke(row.id)}>Revogar</button></div></article>)}</div>}
    {link && <div className="modal-backdrop"><div className="modal registration-link-modal"><div className="modal-head"><div><span>Convite individual</span><h2>Link de cadastro criado</h2></div><button className="icon-button" aria-label="Fechar" onClick={() => setLink(null)}><X /></button></div><p>Envie este link somente ao proprietário. Ele aceita um único cadastro e vence em {new Date(link.expiresAt).toLocaleString('pt-BR')}.</p>{link.referral && <p>Indicado por <strong>{link.referral.partnerName}</strong>. Comissão recorrente: {link.referral.percentage ?? 30}% sobre cada mensalidade paga.</p>}<label>Link para compartilhar<input readOnly value={link.url} onFocus={e => e.target.select()} /></label><p>Copie antes de fechar. Por segurança, o link completo não fica salvo no painel. Se necessário, revogue este convite e gere outro.</p><button className="primary-wide" onClick={async () => { try { await navigator.clipboard.writeText(link.url); setCopied(true) } catch { setError('Selecione o link e copie manualmente.') } }}>{copied ? 'Link copiado!' : 'Copiar link'}</button></div></div>}
  </div>
}
