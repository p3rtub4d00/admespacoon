import { useEffect, useState } from 'react'
import { api } from './api'
export default function AiChatControl({ clubId }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { let alive = true; api.aiChat(clubId).then(x => { if (alive) setData(x) }).catch(e => { if (alive) setMessage(e.message) }); return () => { alive = false } }, [clubId])
  return <section className="ai-chat-control"><div><span>Atendimento no site</span><h3>Assistente com IA</h3><p>Responde dúvidas e consulta a agenda. A chave Gemini deve estar no ambiente do serviço de reservas.</p></div>
    {data && <form onSubmit={async e => { e.preventDefault(); setBusy(true); setMessage(''); try { await api.saveAiChat(clubId, { enabled: data.enabled, monthlyLimit: Number(data.monthlyLimit) }); setMessage('Configuração do chat salva.'); setData(await api.aiChat(clubId)) } catch (e) { setMessage(e.message) } finally { setBusy(false) } }}>
      <label className="ai-chat-toggle"><input type="checkbox" disabled={busy} checked={data.enabled} onChange={e => setData({ ...data, enabled: e.target.checked })} />Ativar chat IA neste clube</label>
      <label>Limite mensal de perguntas<input type="number" min="1" max="100000" required disabled={busy} value={data.monthlyLimit} onChange={e => setData({ ...data, monthlyLimit: e.target.value })} /></label>
      <p>{data.usage?.attempts || 0} consultas iniciadas em {data.usage?.month} · {data.usage?.calls || 0} chamadas à IA · {data.usage?.totalTokens || 0} tokens</p>
      <small>Inclui tentativas com falha. Consumo sincronizado pelo serviço do clube{data.usage?.reportedAt ? ' em ' + new Date(data.usage.reportedAt).toLocaleString('pt-BR') : ' após a primeira consulta'}. Limite renovado a cada mês. Alterar esta opção não muda a mensalidade.</small>
      <button disabled={busy} className="primary">{busy ? 'Salvando…' : 'Salvar chat IA'}</button>
    </form>}{message && <p role="status">{message}</p>}
  </section>
}
