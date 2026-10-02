import { useEffect, useState } from 'react'
import { RefreshCcw, Eye, LayoutDashboard, MessageCircle, CheckCircle2 } from 'lucide-react'
import { api } from './api'

const metrics = [
  ['visit', 'Visitas à página', Eye],
  ['admin_open', 'Acessos ao painel', LayoutDashboard],
  ['contact_click', 'Cliques no WhatsApp', MessageCircle],
  ['reservation_completed', 'Reservas simuladas', CheckCircle2],
]
export default function DemoAnalytics() {
  const [data, setData] = useState(null)
  const [period, setPeriod] = useState('last7')
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    api.demoAnalytics().then(result => { if (active) setData(result) })
      .catch(err => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refresh])
  return <section className="content-card demo-analytics" aria-labelledby="demo-analytics-title">
    <div className="card-head">
      <div><span>Demonstração comercial</span><h2 id="demo-analytics-title">Acessos à demonstração</h2></div>
      <button disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCcw size={16} />{loading ? 'Atualizando...' : 'Atualizar'}</button>
    </div>
    <div className="demo-periods" aria-label="Período dos indicadores">
      {[['today', 'Hoje'], ['last7', 'Últimos 7 dias'], ['month', 'Mês atual']].map(([key, label]) => <button key={key} aria-pressed={period === key} className={period === key ? 'selected' : ''} onClick={() => setPeriod(key)}>{label}</button>)}
    </div>
    {error && <div className="form-error" role="alert">Não foi possível atualizar os acessos: {error}</div>}
    {data && <>
      <div className="demo-metrics">
        {metrics.map(([key, label, Icon]) => <article key={key}><Icon size={21} /><span>{label}</span><strong>{data.periods?.[period]?.[key] ?? 0}</strong></article>)}
      </div>
      {!data.demoClubs?.length && <p className="demo-analytics-note">Nenhum clube está em demonstração. Ative o modo demonstração no cadastro do piloto.</p>}
      {data.demoClubs?.length > 0 && <p className="demo-analytics-note">Demonstrações acompanhadas: {data.demoClubs.map(club => club.name).join(', ')}.</p>}
      <div className="table-wrap"><table><caption className="demo-table-caption">Movimento dos últimos 7 dias</caption><thead><tr><th>Dia</th>{metrics.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody>{data.daily.map(row => <tr key={row.day}><td>{row.day.split('-').reverse().join('/')}</td>{metrics.map(([key]) => <td key={key}>{row[key]}</td>)}</tr>)}</tbody></table></div>
      <div className="demo-location-section">
        <h3>De onde vêm as visitas</h3>
        <p className="demo-analytics-note">Localização aproximada por IP, no período selecionado. São acessos ao site; não representam todas as pessoas que viram seus anúncios. VPNs e redes móveis podem indicar outra cidade.</p>
        <div className="table-wrap"><table><caption className="demo-table-caption">Até 20 localidades com mais visitas</caption><thead><tr><th>Cidade</th><th>Estado / região</th><th>País</th><th>Visitas</th></tr></thead><tbody>
          {(data.locations?.[period]?.rows || []).map(row => <tr key={JSON.stringify([row.city,row.region,row.countryCode,row.country])}><td>{row.city || 'Não identificada'}</td><td>{row.region || 'Não identificado'}</td><td>{row.country || row.countryCode}</td><td>{row.count}</td></tr>)}
          <tr><td colSpan={3}>Localização não identificada (inclui acessos antigos)</td><td>{data.locations?.[period]?.unknown ?? data.periods?.[period]?.visit ?? 0}</td></tr>
          {(data.locations?.[period]?.other || 0) > 0 && <tr><td colSpan={3}>Outras localidades</td><td>{data.locations[period].other}</td></tr>}
        </tbody></table></div>
      </div>
      <p className="demo-analytics-note">Visitas e ações são contadas uma vez por aba/sessão, por dia. Reservas são contadas por conclusão. Os números podem incluir seus testes e não representam pessoas únicas nem mensagens enviadas no WhatsApp. A coleta começa após esta atualização e pode ser limitada pelo navegador ou pela conexão.</p>
      <p className="demo-analytics-note">Horário de Manaus. Atualizado às {new Date(data.updatedAt).toLocaleTimeString('pt-BR', { timeZone: data.timezone })}.</p>
    </>}
  </section>
}
