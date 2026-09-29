import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BadgeDollarSign,
  Building2,
  CheckCircle2,
  Clock3,
  CreditCard,
  FileClock,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  UnlockKeyhole,
  Users,
  WalletCards,
  X,
} from 'lucide-react'
import { api } from './api'

const money = (value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))

const dateBR = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR')
}

const dateTimeBR = (value) => {
  if (!value) return 'Nunca'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Nunca'
  return date.toLocaleString('pt-BR')
}

const statusLabel = {
  active: 'Ativo',
  past_due: 'Em atraso',
  suspended: 'Suspenso',
  cancelled: 'Cancelado',
  trial: 'Teste',
}

function Login({ onLogged }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError('')
    try {
      await api.login(password)
      onLogged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="master-brand">
          <div className="master-brand-mark">EO</div>
          <div>
            <strong>EspaçoOn</strong>
            <span>MASTER</span>
          </div>
        </div>

        <div className="login-icon"><ShieldCheck /></div>
        <span className="eyebrow">Acesso restrito</span>
        <h1>Central administrativa</h1>
        <p>Gerencie clientes, vencimentos, pagamentos e liberação dos sistemas EspaçoOn.</p>

        <form onSubmit={submit}>
          <label>
            Senha Master
            <div className="input-icon">
              <KeyRound size={18} />
              <input
                type="password"
                autoFocus
                autoComplete="current-password"
                placeholder="Digite sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </label>

          {error && <div className="form-error">{error}</div>}

          <button disabled={busy}>
            {busy ? 'Verificando...' : 'Entrar no Master'}
          </button>
        </form>
      </div>
    </div>
  )
}

function ClubModal({ club, onClose, onSaved }) {
  const [form, setForm] = useState({
    establishmentName: club?.establishmentName || '',
    ownerName: club?.ownerName || '',
    phone: club?.phone || '',
    email: club?.email || '',
    city: club?.city || '',
    state: club?.state || '',
    dueDay: club?.billing?.dueDay || 10,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const payload = {
        ...form,
        dueDay: Number(form.dueDay),
      }
      const result = club
        ? await api.updateClub(club.id, payload)
        : await api.createClub(payload)
      onSaved(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span>{club ? 'Editar cadastro' : 'Novo cliente'}</span>
            <h2>{club ? club.establishmentName : 'Cadastrar clube'}</h2>
          </div>
          <button className="icon-button" onClick={onClose}><X /></button>
        </div>

        <form className="club-form" onSubmit={submit}>
          <label>Nome do clube
            <input required minLength={2} value={form.establishmentName}
              onChange={(e) => setForm({ ...form, establishmentName: e.target.value })} />
          </label>
          <label>Responsável
            <input required minLength={3} value={form.ownerName}
              onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
          </label>
          <label>WhatsApp
            <input required inputMode="tel" value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 13) })} />
          </label>
          <label>E-mail
            <input type="email" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>Cidade
            <input value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </label>
          <label>UF
            <input maxLength={2} value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })} />
          </label>
          <label>Dia de vencimento
            <input type="number" min="1" max="28" value={form.dueDay}
              onChange={(e) => setForm({ ...form, dueDay: e.target.value })} />
          </label>

          <div className="plan-preview">
            <CreditCard />
            <div>
              <span>Plano atual</span>
              <strong>EspaçoOn • R$ 49,90/mês</strong>
            </div>
          </div>

          {error && <div className="form-error full">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
            <button disabled={busy}>{busy ? 'Salvando...' : club ? 'Salvar alterações' : 'Criar cliente'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function LicenseModal({ data, onClose }) {
  const [copied, setCopied] = useState(false)
  if (!data?.licenseKey) return null
  const copy = async () => {
    await navigator.clipboard.writeText(data.licenseKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal license-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span>Credencial gerada</span>
            <h2>Chave de licença</h2>
          </div>
          <button className="icon-button" onClick={onClose}><X /></button>
        </div>
        <div className="license-warning">
          Esta chave será exibida somente agora. Guarde-a em local seguro.
        </div>
        <div className="license-data">
          <span>Club ID</span>
          <strong>{data.club?.id}</strong>
          <span>License Key</span>
          <code>{data.licenseKey}</code>
        </div>
        <button className="primary-wide" onClick={copy}>{copied ? 'Copiado' : 'Copiar chave'}</button>
      </div>
    </div>
  )
}

export default function App() {
  const [sessionChecked, setSessionChecked] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [active, setActive] = useState('dashboard')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [dashboard, setDashboard] = useState(null)
  const [clubs, setClubs] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [modalClub, setModalClub] = useState(undefined)
  const [licenseData, setLicenseData] = useState(null)

  const loadAll = async () => {
    setLoading(true)
    setMessage('')
    try {
      const [dash, clubList, logList] = await Promise.all([
        api.dashboard(),
        api.clubs(),
        api.logs(),
      ])
      setDashboard(dash)
      setClubs(clubList)
      setLogs(logList)
    } catch (err) {
      setMessage(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    api.session()
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false))
      .finally(() => setSessionChecked(true))
  }, [])

  useEffect(() => {
    if (authenticated) loadAll()
  }, [authenticated])

  const filteredClubs = useMemo(() => {
    const search = query.trim().toLowerCase()
    if (!search) return clubs
    return clubs.filter((club) =>
      [club.establishmentName, club.ownerName, club.phone, club.id, club.city]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search))
    )
  }, [clubs, query])

  const act = async (operation, success) => {
    setMessage('')
    try {
      await operation()
      setMessage(success)
      await loadAll()
    } catch (err) {
      setMessage(err.message)
    }
  }

  if (!sessionChecked) return <div className="screen-loading">Carregando Master...</div>
  if (!authenticated) return <Login onLogged={() => setAuthenticated(true)} />

  const nav = [
    ['dashboard', 'Visão geral', LayoutDashboard],
    ['clubs', 'Clientes', Building2],
    ['billing', 'Cobranças', WalletCards],
    ['logs', 'Logs', FileClock],
  ]

  return (
    <div className="app-shell">
      {mobileOpen && <button className="mobile-overlay" onClick={() => setMobileOpen(false)} />}
      <aside className={mobileOpen ? 'sidebar open' : 'sidebar'}>
        <div className="master-brand">
          <div className="master-brand-mark">EO</div>
          <div><strong>EspaçoOn</strong><span>MASTER</span></div>
        </div>

        <nav>
          {nav.map(([id, label, Icon]) => (
            <button key={id} className={active === id ? 'active' : ''} onClick={() => {
              setActive(id)
              setMobileOpen(false)
            }}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-plan">
          <span>Plano comercial</span>
          <strong>R$ 49,90/mês</strong>
          <small>Mensalidade fixa por clube</small>
        </div>

        <button className="logout" onClick={async () => {
          await api.logout().catch(() => {})
          setAuthenticated(false)
        }}><LogOut size={17} /> Sair</button>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(true)}><Menu /></button>
          <div>
            <span>Central de administração</span>
            <h1>{nav.find(([id]) => id === active)?.[1]}</h1>
          </div>
          <button className="refresh" onClick={loadAll} disabled={loading}><RefreshCcw size={17} /> Atualizar</button>
        </header>

        {message && <div className="notice">{message}</div>}

        {active === 'dashboard' && (
          <>
            <section className="stats-grid">
              <article><div><Users /></div><span>Clientes</span><strong>{dashboard?.totalClubs ?? 0}</strong><small>cadastrados</small></article>
              <article><div><CheckCircle2 /></div><span>Ativos</span><strong>{dashboard?.activeClubs ?? 0}</strong><small>sistemas liberados</small></article>
              <article><div><Clock3 /></div><span>Em atraso</span><strong>{dashboard?.pastDueClubs ?? 0}</strong><small>aguardando regularização</small></article>
              <article><div><BadgeDollarSign /></div><span>MRR potencial</span><strong>{money(dashboard?.mrr)}</strong><small>mensalidades ativas</small></article>
            </section>

            <section className="content-card">
              <div className="card-head">
                <div><span>Operação</span><h2>Clientes recentes</h2></div>
                <button onClick={() => { setModalClub(null); setActive('clubs') }}><Plus size={16} /> Novo cliente</button>
              </div>
              <ClubTable clubs={clubs.slice(0, 6)} setModalClub={setModalClub} act={act} setLicenseData={setLicenseData} />
            </section>
          </>
        )}

        {active === 'clubs' && (
          <section className="content-card">
            <div className="card-head">
              <div><span>Licenciamento</span><h2>Clubes cadastrados</h2></div>
              <button onClick={() => setModalClub(null)}><Plus size={16} /> Novo cliente</button>
            </div>
            <div className="search-box"><Search size={17} /><input placeholder="Buscar clube, proprietário, telefone ou ID..." value={query} onChange={(e) => setQuery(e.target.value)} /></div>
            <ClubTable clubs={filteredClubs} setModalClub={setModalClub} act={act} setLicenseData={setLicenseData} />
          </section>
        )}

        {active === 'billing' && (
          <section className="content-card">
            <div className="card-head">
              <div><span>Financeiro</span><h2>Mensalidades</h2></div>
            </div>
            <div className="billing-summary">
              <article><span>Plano</span><strong>R$ 49,90</strong><small>por cliente / mês</small></article>
              <article><span>Recebido no mês</span><strong>{money(dashboard?.receivedThisMonth)}</strong><small>pagamentos registrados</small></article>
              <article><span>Em atraso</span><strong>{dashboard?.pastDueClubs ?? 0}</strong><small>clientes</small></article>
            </div>
            <ClubTable clubs={clubs} setModalClub={setModalClub} act={act} setLicenseData={setLicenseData} billingOnly />
          </section>
        )}

        {active === 'logs' && (
          <section className="content-card">
            <div className="card-head"><div><span>Auditoria</span><h2>Atividades administrativas</h2></div></div>
            <div className="log-list">
              {logs.length === 0 && <div className="empty">Nenhuma atividade registrada.</div>}
              {logs.map((log) => (
                <article key={log._id}>
                  <Activity size={17} />
                  <div><strong>{log.description}</strong><span>{log.clubName || 'Master'} • {dateTimeBR(log.createdAt)}</span></div>
                  <code>{log.action}</code>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      {modalClub !== undefined && (
        <ClubModal
          club={modalClub || null}
          onClose={() => setModalClub(undefined)}
          onSaved={async (result) => {
            setModalClub(undefined)
            if (result?.licenseKey) setLicenseData(result)
            setMessage(modalClub ? 'Cadastro atualizado.' : 'Cliente criado com sucesso.')
            await loadAll()
          }}
        />
      )}

      {licenseData && <LicenseModal data={licenseData} onClose={() => setLicenseData(null)} />}
    </div>
  )
}

function ClubTable({ clubs, setModalClub, act, setLicenseData, billingOnly = false }) {
  if (!clubs.length) return <div className="empty">Nenhum cliente encontrado.</div>

  return (
    <div className="table-wrap">
      <table>
        <thead><tr>
          <th>Clube</th><th>Plano</th><th>Vencimento</th><th>Sistema</th><th>Última conexão</th><th>Ações</th>
        </tr></thead>
        <tbody>
          {clubs.map((club) => (
            <tr key={club.id}>
              <td>
                <div className="club-name"><strong>{club.establishmentName}</strong><span>{club.ownerName} • {club.phone}</span><code>{club.id}</code></div>
              </td>
              <td><strong>{money(club.plan?.price || 49.9)}</strong><span className="sub">mensal</span></td>
              <td><strong>{dateBR(club.billing?.nextDueDate)}</strong><span className={'status ' + club.billing?.status}>{statusLabel[club.billing?.status] || club.billing?.status}</span></td>
              <td><span className={'system-pill ' + club.system?.status}>{statusLabel[club.system?.status] || club.system?.status}</span>
                {club.system?.temporaryUnlockUntil && <small className="temporary">Liberação até {dateTimeBR(club.system.temporaryUnlockUntil)}</small>}
              </td>
              <td>{dateTimeBR(club.system?.lastSeen)}</td>
              <td>
                <div className="row-actions">
                  {!billingOnly && <button title="Editar" onClick={() => setModalClub(club)}><Pencil /></button>}
                  {club.system?.status === 'suspended'
                    ? <button title="Liberar" className="ok" onClick={() => act(() => api.setClubStatus(club.id, 'active', 'Liberação manual pelo Master'), 'Sistema liberado.')}><UnlockKeyhole /></button>
                    : <button title="Bloquear" className="danger" onClick={() => {
                        if (confirm('Bloquear o sistema deste cliente?')) {
                          act(() => api.setClubStatus(club.id, 'suspended', 'Bloqueio manual pelo Master'), 'Sistema bloqueado.')
                        }
                      }}><LockKeyhole /></button>
                  }
                  {!billingOnly && <button title="Liberar por 24h" className="warning" onClick={() => act(() => api.temporaryUnlock(club.id, 24), 'Liberação temporária concedida por 24h.')}><Clock3 /></button>}
                  <button title="Registrar mensalidade paga" className="money" onClick={() => {
                    if (confirm('Registrar pagamento de R$ 49,90 e renovar por mais um ciclo?')) {
                      act(() => api.markPaid(club.id, 49.9), 'Pagamento registrado e sistema regularizado.')
                    }
                  }}><BadgeDollarSign /></button>
                  {!billingOnly && <button title="Gerar nova chave de licença" onClick={async () => {
                    if (!confirm('A chave atual deixará de funcionar. Gerar uma nova chave?')) return
                    try {
                      const result = await api.rotateLicense(club.id)
                      setLicenseData(result)
                    } catch (err) {
                      alert(err.message)
                    }
                  }}><RefreshCcw /></button>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
