import { RegistrationPage, RegistrationInvites } from './Registration'
import DemoAnalytics from './DemoAnalytics'
import PrivacyPage from './PrivacyPage'
import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BadgeDollarSign,
  BellRing,
  Building2,
  CheckCircle2,
  Clock3,
  CreditCard,
  Download,
  FileClock,
  Eye,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  UnlockKeyhole,
  Trash2,
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

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
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
        <p className="privacy-notice"><a href="/privacidade">Política de Privacidade</a></p>
      </div>
    </div>
  )
}

function AdminAccessPage({ token }) {
  const [info, setInfo] = useState(null)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    let alive = true
    setBusy(true)
    api.adminAccessInfo(token)
      .then((data) => { if (alive) setInfo(data) })
      .catch((err) => { if (alive) setError(err.message) })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [token])

  const submit = async (event) => {
    event.preventDefault()
    if (busy || done) return
    if (password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.')
      return
    }
    if (password !== confirmation) {
      setError('As senhas não conferem.')
      return
    }

    setBusy(true)
    setError('')
    try {
      const result = await api.completeAdminAccess(token, password, confirmation)
      setInfo(current => ({ ...current, adminUrl: result.adminUrl }))
      setPassword('')
      setConfirmation('')
      window.history.replaceState({}, '', window.location.pathname)
      setDone(true)
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
          <div className="master-brand-mark">CO</div>
          <div>
            <strong>ClubeOn</strong>
            <span>ACESSO DO CLUBE</span>
          </div>
        </div>

        <div className="login-icon"><KeyRound /></div>
        <span className="eyebrow">
          {info?.purpose === 'reset' ? 'Redefinição de senha' : 'Primeiro acesso'}
        </span>
        <h1>{done ? 'Senha definida com sucesso.' : (info?.clubName || 'Acesso administrativo')}</h1>
        <p>
          {done
            ? 'O proprietário já pode acessar o painel do clube usando a nova senha.'
            : busy
              ? 'Validando link...'
              : 'Crie uma senha segura para o painel administrativo do clube.'}
        </p>

        {!done && !busy && info && (
          <form onSubmit={submit}>
            <label>
              Nova senha
              <div className="input-icon">
                <LockKeyhole size={18} />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                />
              </div>
            </label>
            <label>
              Confirmar senha
              <div className="input-icon">
                <LockKeyhole size={18} />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder="Repita a senha"
                />
              </div>
            </label>

            {error && <div className="form-error">{error}</div>}
            <button disabled={busy}>{busy ? 'Salvando...' : 'Salvar nova senha'}</button>
          </form>
        )}

        <p className="privacy-notice">Os dados de acesso são utilizados para administrar o sistema contratado. <a href="/privacidade" target="_blank" rel="noreferrer">Consulte a Política de Privacidade</a>.</p>
        {done && info?.adminUrl && <a className="access-panel-link" href={info.adminUrl}>Abrir painel do clube</a>}
        {done && !info?.adminUrl && <p>Solicite o endereço do painel ao administrador do ClubeOn.</p>}
        {!busy && !info && error && <div className="form-error">{error}</div>}
      </div>
    </div>
  )
}

function ClubModal({ club, onClose, onSaved, planPrice = 49.9, planName = 'EspaçoOn' }) {
  const [form, setForm] = useState({
    establishmentName: club?.establishmentName || '',
    ownerName: club?.ownerName || '',
    cpfCnpj: club?.cpfCnpj || '',
    phone: club?.phone || '',
    email: club?.email || '',
    city: club?.city || '',
    state: club?.state || '',
    nextDueDate: club?.billing?.nextDueDate?.slice(0, 10) || (() => {
      const now = new Date()
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 10, 12))
      if (date <= now) date.setUTCMonth(date.getUTCMonth() + 1)
      return date.toISOString().slice(0, 10)
    })(),
    systemUrl: club?.system?.publicUrl || '',
    demoMode: club?.demoMode === true,
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
        ...(club?.registrationInviteId ? { registrationInviteId: club.registrationInviteId } : {}),
        nextDueDate: form.nextDueDate,
      }
      const result = club?.id
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
            <span>{club?.id ? 'Editar cadastro' : 'Novo cliente'}</span>
            <h2>{club?.id ? club.establishmentName : club?.registrationInviteId ? 'Revisar cadastro recebido' : 'Cadastrar clube'}</h2>
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
          <label>CPF/CNPJ
            <input inputMode="numeric" value={form.cpfCnpj}
              onChange={(e) => setForm({ ...form, cpfCnpj: e.target.value.replace(/\D/g, '').slice(0, 14) })} />
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
          <label>Próximo vencimento
            <input type="date" required value={form.nextDueDate}
              onChange={(e) => setForm({ ...form, nextDueDate: e.target.value })} />
            <small>Escolha dia, mês e ano. As próximas mensalidades seguirão esse dia; meses menores usam o último dia.</small>
          </label>

          <label className="full">Endereço do sistema do clube
            <input type="url" placeholder="https://meu-clube.onrender.com" value={form.systemUrl}
              onChange={(e) => setForm({ ...form, systemUrl: e.target.value })} />
            <small>Pode preencher depois que o sistema estiver publicado.</small>
          </label>
          {!club?.id && <label className="full demo-create-option">
            <input type="checkbox" checked={form.demoMode} onChange={(e) => setForm({ ...form, demoMode: e.target.checked })} />
            Criar em demonstração, com pagamentos simulados e painel sem senha
          </label>}

          <div className="plan-preview">
            <CreditCard />
            <div>
              <span>Plano atual</span>
              <strong>{planName} • {money(planPrice)}/mês</strong>
            </div>
          </div>

          {error && <div className="form-error full">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
            <button disabled={busy}>{busy ? 'Salvando...' : club?.id ? 'Salvar alterações' : 'Criar cliente'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function LicenseModal({ data, onClose }) {
  const [copied, setCopied] = useState('')
  const [copyError, setCopyError] = useState('')
  if (!data?.licenseKey) return null
  const copy = async (value, key) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopyError('')
      setCopied(key)
      setTimeout(() => setCopied(''), 1600)
    } catch { setCopyError('Não foi possível copiar. Selecione e copie o texto exibido.') }
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
          {data.adminAccessUrl && (
            <>
              <span>Primeiro acesso do proprietário</span>
              <code>{data.adminAccessUrl}</code>
            </>
          )}
        </div>
        <p>Use um serviço e um banco exclusivos para este clube. O cadastro no Master é o primeiro passo da instalação.</p>
        <div className="license-data">
          <span>Configuração da licença no serviço do clube</span>
          <pre>{`MASTER_API_URL=${window.location.origin}\nMASTER_CLUB_ID=${data.club.id}\nMASTER_LICENSE_KEY=${data.licenseKey}`}</pre>
        </div>
        <button className="primary-wide" onClick={() => copy(`MASTER_API_URL=${window.location.origin}\nMASTER_CLUB_ID=${data.club.id}\nMASTER_LICENSE_KEY=${data.licenseKey}`, 'config')}>
          {copied === 'config' ? 'Configuração copiada' : 'Copiar configuração da licença'}
        </button>
        {copyError && <div className="form-error">{copyError}</div>}
        <button className="primary-wide" onClick={() => copy(data.licenseKey, 'license')}>
          {copied === 'license' ? 'Chave copiada' : 'Copiar chave'}
        </button>
        {data.adminAccessUrl && (
          <button className="primary-wide" onClick={() => copy(data.adminAccessUrl, 'access')}>
            {copied === 'access' ? 'Link copiado' : 'Copiar link de primeiro acesso'}
          </button>
        )}
      </div>
    </div>
  )
}

function App() {
  const [registrationToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('convite') || '')
  useEffect(() => {
    if (registrationToken) window.history.replaceState(null, '', window.location.pathname)
  }, [registrationToken])
  const [adminAccessToken] = useState(() => new URLSearchParams(window.location.search).get('adminAccessToken') || '')
  const [sessionChecked, setSessionChecked] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [active, setActive] = useState('dashboard')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [dashboard, setDashboard] = useState(null)
  const [revenueMonth, setRevenueMonth] = useState(() => {
    const now = new Date()
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
  })
  const [revenueData, setRevenueData] = useState(null)
  const [revenueLoading, setRevenueLoading] = useState(false)
  const [revenueError, setRevenueError] = useState('')
  const [masterSettings, setMasterSettings] = useState({ planName: 'EspaçoOn', planPrice: 49.9 })
  const [clubs, setClubs] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [modalClub, setModalClub] = useState(undefined)
  const [licenseData, setLicenseData] = useState(null)
  const [detailClubId, setDetailClubId] = useState(null)
  const [pushStatus, setPushStatus] = useState(null)
  const [pushSubscription, setPushSubscription] = useState(null)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushMessage, setPushMessage] = useState('')
  const [installPrompt, setInstallPrompt] = useState(null)
  const [appInstalled, setAppInstalled] = useState(() =>
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )

  const loadAll = async () => {
    setLoading(true)
    setMessage('')
    try {
      const [dash, settingsData, clubList, logList] = await Promise.all([
        api.dashboard(),
        api.settings(),
        api.clubs(),
        api.logs(),
      ])
      setDashboard(dash)
      setMasterSettings(settingsData)
      setClubs(clubList)
      setLogs(logList)
    } catch (err) {
      setMessage(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (window.location.pathname === '/cadastro') return
    api.session()
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false))
      .finally(() => setSessionChecked(true))
  }, [])

  useEffect(() => {
    if (authenticated) loadAll()
  }, [authenticated])

  useEffect(() => {
    if (!authenticated || active !== 'billing') return

    let alive = true
    setRevenueLoading(true)
    setRevenueError('')

    api.revenue(revenueMonth)
      .then((data) => {
        if (alive) setRevenueData(data)
      })
      .catch((error) => {
        if (alive) setRevenueError(error.message || 'Não foi possível carregar o faturamento.')
      })
      .finally(() => {
        if (alive) setRevenueLoading(false)
      })

    return () => { alive = false }
  }, [authenticated, active, revenueMonth])

  useEffect(() => {
    const handleBeforeInstall = (event) => {
      event.preventDefault()
      setInstallPrompt(event)
    }

    const handleInstalled = () => {
      setAppInstalled(true)
      setInstallPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  const installApp = async () => {
    if (appInstalled) return

    if (installPrompt) {
      installPrompt.prompt()
      await installPrompt.userChoice.catch(() => null)
      setInstallPrompt(null)
      return
    }

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    if (isIOS) {
      window.alert('No iPhone: abra no Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”.')
      return
    }

    window.alert('O navegador ainda não liberou a instalação. Atualize a página uma vez após o deploy. No Chrome, a opção também pode aparecer no menu ⋮ como “Instalar EspaçoOn Master”.')
  }

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

  if (window.location.pathname === '/cadastro') return <RegistrationPage token={registrationToken} />
  if (adminAccessToken) return <AdminAccessPage token={adminAccessToken} />
  if (!sessionChecked) return <div className="screen-loading">Carregando Master...</div>
  if (!authenticated) return <Login onLogged={() => setAuthenticated(true)} />

  const nav = [
    ['dashboard', 'Visão geral', LayoutDashboard],
    ['clubs', 'Clientes', Building2],
    ['billing', 'Cobranças', WalletCards],
    ['settings', 'Configurações', Settings],
    ['notifications', 'Notificações', BellRing],
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
          <strong>{money(masterSettings.planPrice)}/mês</strong>
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
          <div className="topbar-actions">
            <button className="install-master" onClick={installApp} disabled={appInstalled}>
              <Download size={17} />
              {appInstalled ? 'Instalado' : 'Instalar app'}
            </button>
            <button className="refresh" onClick={loadAll} disabled={loading}><RefreshCcw size={17} /> Atualizar</button>
          </div>
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

            <DemoAnalytics />

            <section className="content-card">
              <div className="card-head">
                <div><span>Operação</span><h2>Clientes recentes</h2></div>
                <button onClick={() => { setModalClub(null); setActive('clubs') }}><Plus size={16} /> Novo cliente</button>
              </div>
              <ClubTable clubs={clubs.slice(0, 6)} setModalClub={setModalClub} act={act} setLicenseData={setLicenseData} setDetailClubId={setDetailClubId} />
            </section>
          </>
        )}

        {active === 'clubs' && (
          <section className="content-card">
            <div className="card-head">
              <div><span>Licenciamento</span><h2>Clubes cadastrados</h2></div>
              <button onClick={() => setModalClub(null)}><Plus size={16} /> Novo cliente</button>
            </div>
            <RegistrationInvites refreshKey={clubs} onReview={setModalClub} />
            <div className="search-box"><Search size={17} /><input placeholder="Buscar clube, proprietário, telefone ou ID..." value={query} onChange={(e) => setQuery(e.target.value)} /></div>
            <ClubTable clubs={filteredClubs} setModalClub={setModalClub} act={act} setLicenseData={setLicenseData} setDetailClubId={setDetailClubId} />
          </section>
        )}

        {active === 'billing' && (
          <section className="content-card">
            <div className="card-head">
              <div><span>Financeiro</span><h2>Faturamento mensal</h2></div>
              <label className="revenue-month-picker">
                <span>Mês</span>
                <input
                  type="month"
                  value={revenueMonth}
                  onChange={(e) => setRevenueMonth(e.target.value)}
                />
              </label>
            </div>

            {revenueError && <div className="form-error">{revenueError}</div>}

            <div className="billing-summary revenue-summary">
              <article><span>Recebido</span><strong>{money(revenueData?.totalReceived)}</strong><small>{revenueData?.paymentCount || 0} pagamento(s)</small></article>
              <article><span>Clientes pagantes</span><strong>{revenueData?.payingClients ?? 0}</strong><small>no mês selecionado</small></article>
              <article><span>Ticket médio</span><strong>{money(revenueData?.averageTicket)}</strong><small>por pagamento</small></article>
              <article><span>Potencial mensal</span><strong>{money(revenueData?.potentialRevenue)}</strong><small>{Number(revenueData?.realizationRate || 0).toFixed(1)}% realizado</small></article>
            </div>

            <div className="revenue-table-head">
              <div>
                <span>Detalhamento</span>
                <h3>Pagamentos recebidos</h3>
              </div>
              {revenueLoading && <small>Atualizando...</small>}
            </div>

            {revenueData?.payments?.length ? (
              <div className="table-wrap">
                <table className="revenue-table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Valor</th>
                      <th>Pagamento</th>
                      <th>Origem</th>
                      <th>Ciclo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenueData.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td>
                          <div className="club-name">
                            <strong>{payment.clubName}</strong>
                            <span>{payment.ownerName || payment.clubId}</span>
                          </div>
                        </td>
                        <td><strong>{money(payment.amount)}</strong></td>
                        <td>{dateTimeBR(payment.paidAt)}</td>
                        <td><span className="payment-provider">{payment.provider === 'asaas' ? 'Asaas' : 'Manual'}</span></td>
                        <td>{dateBR(payment.cycleStart)} → {dateBR(payment.cycleEnd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">Nenhum pagamento recebido neste mês.</div>
            )}

            <div className="billing-clients-section">
              <div className="revenue-table-head">
                <div><span>Assinaturas</span><h3>Situação dos clientes</h3></div>
              </div>
              <ClubTable clubs={clubs} setModalClub={setModalClub} act={act} setLicenseData={setLicenseData} setDetailClubId={setDetailClubId} billingOnly />
            </div>
          </section>
        )}

        {active === 'settings' && (
          <>
          <PrivacySettings />
          <PlanSettings
            settings={masterSettings}
            onSaved={async (saved) => {
              setMasterSettings(saved)
              setMessage('Valor do plano atualizado e sincronizado com o Asaas.')
              await loadAll()
            }}
          />
          </>
        )}

        {active === 'notifications' && (
          <MasterNotifications
            pushStatus={pushStatus}
            setPushStatus={setPushStatus}
            pushSubscription={pushSubscription}
            setPushSubscription={setPushSubscription}
            busy={pushBusy}
            setBusy={setPushBusy}
            message={pushMessage}
            setMessage={setPushMessage}
          />
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
        <p className="privacy-notice"><a href="/privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a></p>
      </main>

      {modalClub !== undefined && (
        <ClubModal
          club={modalClub || null}
          planPrice={masterSettings.planPrice}
          planName={masterSettings.planName}
          onClose={() => setModalClub(undefined)}
          onSaved={async (result) => {
            setModalClub(undefined)
            if (result?.licenseKey && result?.club?.id) {
              setLicenseData(result)
              try {
                if (!result.club.demoMode) {
                  const access = await api.createAdminAccessLink(result.club.id, 'first-access')
                  setLicenseData({ ...result, adminAccessUrl: access.url })
                }
              } catch {
                setLicenseData(result)
              }
            }
            setMessage(modalClub?.id ? 'Cadastro atualizado.' : 'Cliente criado com sucesso.')
            await loadAll()
          }}
        />
      )}

      {licenseData && <LicenseModal data={licenseData} onClose={() => setLicenseData(null)} />}
      {detailClubId && (
        <ClubDetails
          clubId={detailClubId}
          onClose={() => setDetailClubId(null)}
          onEdit={(club) => {
            setDetailClubId(null)
            setModalClub(club)
          }}
          act={act}
          onLicense={setLicenseData}
          onRefresh={loadAll}
        />
      )}
    </div>
  )
}

function MasterNotifications({
  pushStatus,
  setPushStatus,
  pushSubscription,
  setPushSubscription,
  busy,
  setBusy,
  message,
  setMessage,
}) {
  const loadStatus = async () => {
    const status = await api.pushStatus()
    setPushStatus(status)

    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const registration = await navigator.serviceWorker.ready
      setPushSubscription(await registration.pushManager.getSubscription())
    }
  }

  useEffect(() => {
    let alive = true

    const run = async () => {
      try {
        const status = await api.pushStatus()
        if (!alive) return
        setPushStatus(status)

        if ('serviceWorker' in navigator && 'PushManager' in window) {
          const registration = await navigator.serviceWorker.ready
          const subscription = await registration.pushManager.getSubscription()
          if (alive) setPushSubscription(subscription)
        }
      } catch (error) {
        if (alive) setMessage(error.message || 'Não foi possível carregar as notificações.')
      }
    }

    run()
    return () => { alive = false }
  }, [])

  const enable = async () => {
    setBusy(true)
    setMessage('')
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('Este navegador não oferece suporte a notificações Push.')
      }

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error('A permissão de notificações não foi autorizada.')

      const registration = await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(pushStatus.publicKey),
        })
      }

      await api.subscribePush(subscription.toJSON())
      setPushSubscription(subscription)
      await loadStatus()
      setMessage('Notificações ativadas neste dispositivo.')
    } catch (error) {
      setMessage(error.message || 'Não foi possível ativar as notificações.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="content-card">
      <div className="card-head">
        <div><span>Web Push</span><h2>Notificações do Master</h2></div>
      </div>

      <div className="master-notifications-layout">
        <article className="master-notification-status">
          <div className="notification-icon"><BellRing /></div>
          <div>
            <span>Este dispositivo</span>
            <strong>{pushSubscription ? 'Notificações ativas' : 'Notificações desativadas'}</strong>
            <small>{pushStatus?.subscriptions || 0} dispositivo(s) cadastrado(s) no Master</small>
          </div>
        </article>

        <div className="master-notification-events">
          <strong>Eventos automáticos</strong>
          <span>Pagamento de mensalidade confirmado</span>
          <span>Mensalidade vencida</span>
          <span>Suspensão automática</span>
          <span>Assinatura Asaas criada ou com falha</span>
        </div>
      </div>

      <div className="master-notification-actions">
        {!pushSubscription ? (
          <button onClick={enable} disabled={busy || !pushStatus?.publicKey}>
            <BellRing size={16} />
            {busy ? 'Ativando...' : 'Ativar neste dispositivo'}
          </button>
        ) : (
          <>
            <button disabled={busy} onClick={async () => {
              setBusy(true); setMessage('')
              try {
                await api.testPush(pushSubscription.endpoint)
                setMessage('Notificação de teste enviada.')
              } catch (error) {
                setMessage(error.message)
              } finally { setBusy(false) }
            }}>
              <BellRing size={16} /> Enviar teste
            </button>

            <button disabled={busy} onClick={async () => {
              setBusy(true); setMessage('')
              try {
                await api.testPushBackground(pushSubscription.endpoint)
                setMessage('Teste agendado. Feche o navegador/app e aguarde 15 segundos.')
              } catch (error) {
                setMessage(error.message)
              } finally { setBusy(false) }
            }}>
              <BellRing size={16} /> Testar em segundo plano
            </button>

            <button className="danger-outline" disabled={busy} onClick={async () => {
              setBusy(true); setMessage('')
              try {
                await api.unsubscribePush(pushSubscription.endpoint)
                await pushSubscription.unsubscribe()
                setPushSubscription(null)
                await loadStatus()
                setMessage('Notificações removidas deste dispositivo.')
              } catch (error) {
                setMessage(error.message)
              } finally { setBusy(false) }
            }}>
              Desativar
            </button>
          </>
        )}
      </div>

      {message && <div className="notice notification-notice">{message}</div>}
    </section>
  )
}

function PlanSettings({ settings, onSaved }) {
  const [planName, setPlanName] = useState(settings.planName || 'EspaçoOn')
  const [planPrice, setPlanPrice] = useState(String(settings.planPrice ?? 49.9).replace('.', ','))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setPlanName(settings.planName || 'EspaçoOn')
    setPlanPrice(String(settings.planPrice ?? 49.9).replace('.', ','))
  }, [settings.planName, settings.planPrice])

  const submit = async (event) => {
    event.preventDefault()
    setError('')

    const numericPrice = Number(planPrice.replace(',', '.'))
    if (!Number.isFinite(numericPrice) || numericPrice < 5) {
      setError('Informe um valor de pelo menos R$ 5,00.')
      return
    }

    if (!confirm(
      'Alterar o valor do plano para ' + money(numericPrice) +
      '? As assinaturas e cobranças pendentes no Asaas também serão atualizadas.'
    )) return

    setBusy(true)
    try {
      const saved = await api.saveSettings({
        planName: planName.trim() || 'EspaçoOn',
        planPrice: numericPrice,
      })
      onSaved(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="content-card">
      <div className="card-head">
        <div><span>Comercial</span><h2>Configuração do plano</h2></div>
      </div>

      <div className="plan-settings-layout">
        <form className="plan-settings-form" onSubmit={submit}>
          <label>
            Nome do plano
            <input value={planName} maxLength={80} onChange={(e) => setPlanName(e.target.value)} />
          </label>
          <label>
            Valor mensal (R$)
            <input
              inputMode="decimal"
              value={planPrice}
              onChange={(e) => setPlanPrice(e.target.value.replace(/[^0-9,.]/g, ''))}
              placeholder="49,90"
            />
          </label>

          {error && <div className="form-error">{error}</div>}

          <button disabled={busy}>
            {busy ? 'Sincronizando...' : 'Salvar e atualizar Asaas'}
          </button>
        </form>

        <aside className="plan-settings-note">
          <BadgeDollarSign />
          <div>
            <strong>Valor centralizado</strong>
            <p>
              Este valor passa a ser usado nos novos clientes, novas assinaturas, QR Codes,
              cobranças recorrentes e indicadores do Master.
            </p>
            <small>Valor mínimo permitido: R$ 5,00.</small>
          </div>
        </aside>
      </div>
    </section>
  )
}

function ClubDetails({ clubId, onClose, onEdit, act, onLicense, onRefresh }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setBusy(true)
    setError('')
    try {
      setData(await api.clubDetails(clubId))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    load()
  }, [clubId])

  const club = data?.club

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal client-detail-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span>Ficha do cliente</span>
            <h2>{club?.establishmentName || 'Carregando...'}</h2>
          </div>
          <button className="icon-button" onClick={onClose}><X /></button>
        </div>

        {busy && !data && <div className="empty">Carregando dados do cliente...</div>}
        {error && <div className="form-error">{error}</div>}

        {club && (
          <>
            <section className="client-detail-summary">
              <article>
                <span>Responsável</span>
                <strong>{club.ownerName}</strong>
                <small>{club.phone}{club.cpfCnpj ? ' • Doc. ' + club.cpfCnpj : ''}{club.email ? ' • ' + club.email : ''}</small>
              </article>
              <article>
                <span>Plano</span>
                <strong>{money(club.plan?.price || 49.9)}</strong>
                <small>{club.plan?.name || 'EspaçoOn'} / mês</small>
              </article>
              <article>
                <span>Próximo vencimento</span>
                <strong>{dateBR(club.billing?.nextDueDate)}</strong>
                <small>{statusLabel[club.billing?.status] || club.billing?.status}</small>
              </article>
              <article>
                <span>Status do sistema</span>
                <strong>{club.demoMode ? 'Demonstração' : (statusLabel[club.system?.status] || club.system?.status)}</strong>
                <small>
                  {club.demoMode
                    ? 'Sem cobrança real • painel sem senha'
                    : (club.adminPasswordConfigured ? 'Senha do proprietário configurada' : 'Primeiro acesso pendente') +
                      ' • Última conexão: ' + dateTimeBR(club.system?.lastSeen)}
                </small>
              </article>
            </section>

            <div className="client-identity">
              <div><span>Club ID</span><code>{club.id}</code></div>
              <div><span>Slug</span><code>{club.slug}</code></div>
              <div><span>Localidade</span><strong>{[club.city, club.state].filter(Boolean).join(' / ') || 'Não informada'}</strong></div>
              <div><span>Cadastrado em</span><strong>{dateTimeBR(club.createdAt)}</strong></div>
            </div>

            <section className="provisioning-section">
              <div className="detail-section-head">
                <div><span>Preparação do cliente</span><h3>{club.provisioning?.ready ? 'Pronto para entrega' : 'Configuração pendente'}</h3></div>
                <button className="secondary" onClick={load} disabled={busy}>{busy ? 'Atualizando...' : 'Atualizar status'}</button>
              </div>
              <ul className="provisioning-checks">
                {(club.provisioning?.checks || []).map(item => <li key={item.id} className={item.complete ? 'complete' : ''}>
                  <CheckCircle2 size={17} /><span>{item.label}</span><strong>{item.complete ? 'Concluído' : 'Pendente'}</strong>
                </li>)}
              </ul>
              {!club.provisioning?.active && <p>O clube está bloqueado. Regularize o acesso antes de entregá-lo.</p>}
              <p>Última atualização do sistema: {dateTimeBR(club.provisioning?.reportedAt)}. Abra o painel do clube para atualizar a conexão; o status pode levar até 5 minutos.</p>
              {club.provisioning?.adminUrl && <a className="access-panel-link" href={club.provisioning.adminUrl} target="_blank" rel="noreferrer">Abrir painel do clube</a>}
              <details><summary>Como instalar um novo clube</summary>
                <ol>
                  <li>Crie um Web Service no Render usando o repositório Espa-oOn e a branch main.</li>
                  <li>Use um banco MongoDB exclusivo para este clube e um JWT_SECRET exclusivo. Não copie o banco do piloto nem do Master.</li>
                  <li>Configure a licença com o Club ID e a chave exibidos no cadastro. A chave não pode ser recuperada; use a renovação somente se a tiver perdido.</li>
                  <li>Configure o recebimento do clube, faça o deploy e cadastre o endereço HTTPS em Editar cadastro.</li>
                  <li>Gere o link de primeiro acesso quando for entregar ao proprietário. Ele expira em 30 minutos.</li>
                  <li>Peça ao proprietário para preencher os dados e os preços; valide uma reserva de demonstração antes da entrega.</li>
                </ol>
              </details>
            </section>

            <section className="payment-provider-section">
              <div className="detail-section-head">
                <div>
                  <span>Recebimentos das reservas</span>
                  <h3>Provedor de pagamento</h3>
                </div>
              </div>

              <div className="payment-provider-control">
                <label>
                  Banco usado nas novas cobranças
                  <select
                    value={club.reservationPaymentProvider || 'asaas'}
                    onChange={async (event) => {
                      const provider = event.target.value
                      const current = club.reservationPaymentProvider || 'asaas'
                      if (provider === current) return
                      const label = provider === 'mercadopago' ? 'Mercado Pago' : 'Asaas'
                      if (!confirm(
                        'Alterar o provedor de novas reservas para ' + label +
                        '? Cobranças já existentes continuarão vinculadas ao provedor original.'
                      )) return

                      await act(
                        () => api.setPaymentProvider(club.id, provider),
                        'Provedor de recebimento atualizado.',
                      )
                      await load()
                    }}
                  >
                    <option value="asaas">Asaas</option>
                    <option value="mercadopago">Mercado Pago</option>
                  </select>
                </label>

                <div className="payment-provider-note">
                  <strong>
                    {(club.reservationPaymentProvider || 'asaas') === 'asaas'
                      ? 'Asaas selecionado para novas reservas'
                      : 'Mercado Pago selecionado para novas reservas'}
                  </strong>
                  <span>
                    A mensalidade do EspaçoOn continua separada e permanece no Asaas.
                  </span>
                </div>
              </div>

              <div className="mercadopago-connection">
                <div>
                  <span>Mercado Pago</span>
                  <strong>
                    {!data?.mercadopago?.platformConfigured
                      ? 'Integração ainda não configurada'
                      : data?.mercadopago?.connected
                        ? 'Conta do proprietário conectada'
                        : (club.reservationPaymentProvider || 'asaas') === 'mercadopago'
                          ? 'Aguardando o proprietário conectar pelo painel do clube'
                          : 'Não conectado'}
                  </strong>
                  {data?.mercadopago?.connected && (
                    <small>
                      ID do vendedor: {data.mercadopago.userId}
                      {data.mercadopago.expiresAt ? ' • renovação até ' + dateBR(data.mercadopago.expiresAt) : ''}
                    </small>
                  )}
                </div>
              </div>
            </section>

            <div className="client-detail-actions">
              {!club.demoMode && (
                <button
                  onClick={async () => {
                    try {
                      const result = await api.createAdminAccessLink(
                        club.id,
                        club.adminPasswordConfigured ? 'reset' : 'first-access',
                      )
                      if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(result.url)
                        window.alert(
                          club.adminPasswordConfigured
                            ? 'Link de redefinição copiado. Ele expira em 30 minutos.'
                            : 'Link de primeiro acesso copiado. Ele expira em 30 minutos.'
                        )
                      } else {
                        window.prompt('Copie o link e envie ao proprietário:', result.url)
                      }
                      onRefresh?.()
                    } catch (error) {
                      window.alert(error.message || 'Não foi possível gerar o link.')
                    }
                  }}
                >
                  <KeyRound size={15} />
                  {club.adminPasswordConfigured ? 'Redefinir senha' : 'Gerar primeiro acesso'}
                </button>
              )}
              <button onClick={() => onEdit(club)}><Pencil size={15} /> Editar cadastro</button>
              <button
                className={club.demoMode ? 'demo-active' : 'demo'}
                onClick={async () => {
                  const next = !club.demoMode
                  const message = next
                    ? 'Ativar modo demonstração? A cobrança recorrente real será encerrada, pagamentos de reservas serão simulados e o painel do clube ficará sem senha.'
                    : 'Desativar modo demonstração? A operação real será restaurada, incluindo senha, Asaas e cobrança mensal.'
                  if (!confirm(message)) return
                  await act(
                    () => api.setDemoMode(club.id, next),
                    next ? 'Modo demonstração ativado.' : 'Modo demonstração desativado.',
                  )
                  await load()
                }}
              >
                <Eye size={15} />
                {club.demoMode ? 'Desativar demonstração' : 'Ativar demonstração'}
              </button>
              {club.system?.status === 'suspended' ? (
                <button className="ok" onClick={async () => {
                  await act(() => api.setClubStatus(club.id, 'active', 'Liberação manual pelo Master'), 'Sistema liberado.')
                  await load()
                }}><UnlockKeyhole size={15} /> Liberar sistema</button>
              ) : (
                <button className="danger" onClick={async () => {
                  if (!confirm('Bloquear o sistema deste cliente?')) return
                  await act(() => api.setClubStatus(club.id, 'suspended', 'Bloqueio manual pelo Master'), 'Sistema bloqueado.')
                  await load()
                }}><LockKeyhole size={15} /> Bloquear sistema</button>
              )}
              <button className="warning" onClick={async () => {
                await act(() => api.temporaryUnlock(club.id, 24), 'Liberação temporária concedida por 24h.')
                await load()
              }}><Clock3 size={15} /> Liberar 24h</button>
              <button className="money" onClick={async () => {
                if (!confirm('Registrar a mensalidade atual como paga e renovar por mais um ciclo?')) return
                await act(() => api.markPaid(club.id), 'Pagamento registrado e sistema regularizado.')
                await load()
              }}><BadgeDollarSign size={15} /> Registrar mensalidade</button>
              <button onClick={async () => {
                if (!confirm('A chave atual deixará de funcionar. Gerar nova chave?')) return
                try {
                  const result = await api.rotateLicense(club.id)
                  onLicense(result)
                  await onRefresh()
                  await load()
                } catch (err) {
                  setError(err.message)
                }
              }}><RefreshCcw size={15} /> Nova licença</button>
            </div>

            <section className="client-history-section">
              <div className="detail-section-head">
                <div><span>Asaas</span><h3>{club.demoMode ? 'Cobrança desativada na demonstração' : 'Assinatura recorrente'}</h3></div>
                {data.asaas?.subscriptionStatus && (
                  <span className={'asaas-status ' + String(data.asaas.subscriptionStatus).toLowerCase()}>
                    {data.asaas.subscriptionStatus}
                  </span>
                )}
              </div>

              <div className="asaas-detail-grid">
                <article>
                  <span>ID da assinatura</span>
                  <code>{data.asaas?.subscriptionId || 'Ainda não criada'}</code>
                </article>
                <article>
                  <span>Valor recorrente</span>
                  <strong>{money(data.asaas?.value ?? club.plan?.price)}</strong>
                </article>
                <article>
                  <span>Próxima cobrança</span>
                  <strong>{dateBR(data.asaas?.nextDueDate || club.billing?.nextDueDate)}</strong>
                </article>
                <article>
                  <span>Cobrança atual</span>
                  <strong>{data.asaas?.currentPayment?.status || 'Sem cobrança'}</strong>
                  {data.asaas?.currentPayment?.value != null && (
                    <small>{money(data.asaas.currentPayment.value)} • {dateBR(data.asaas.currentPayment.dueDate)}</small>
                  )}
                </article>
              </div>

              {data.asaas?.error && (
                <div className="asaas-warning">{data.asaas.error}</div>
              )}
            </section>

            <section className="client-history-section">
              <div className="detail-section-head">
                <div><span>Financeiro</span><h3>Histórico de mensalidades</h3></div>
                <strong>{money(data.financial?.totalPaid)}</strong>
              </div>

              {data.payments?.length ? (
                <div className="detail-history-list">
                  {data.payments.map((payment) => (
                    <article key={payment.id}>
                      <div>
                        <strong>{money(payment.amount)}</strong>
                        <span>{payment.provider === 'manual' ? 'Registro manual' : payment.provider}</span>
                      </div>
                      <div>
                        <strong>{dateTimeBR(payment.paidAt)}</strong>
                        <span>Ciclo até {dateBR(payment.cycleEnd)}</span>
                      </div>
                      <span className={'status ' + payment.status}>{payment.status === 'paid' ? 'Pago' : payment.status}</span>
                    </article>
                  ))}
                </div>
              ) : <div className="empty compact">Nenhum pagamento registrado.</div>}
            </section>

            <section className="client-history-section">
              <div className="detail-section-head">
                <div><span>Auditoria</span><h3>Histórico administrativo</h3></div>
              </div>

              {data.logs?.length ? (
                <div className="detail-log-list">
                  {data.logs.map((log) => (
                    <article key={log._id}>
                      <Activity size={15} />
                      <div>
                        <strong>{log.description}</strong>
                        <span>{dateTimeBR(log.createdAt)}</span>
                      </div>
                      <code>{log.action}</code>
                    </article>
                  ))}
                </div>
              ) : <div className="empty compact">Nenhuma atividade registrada.</div>}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function ClubTable({ clubs, setModalClub, act, setLicenseData, setDetailClubId, billingOnly = false }) {
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
                  <button title="Ver ficha completa" onClick={() => setDetailClubId(club.id)}><Eye /></button>
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
                    if (confirm('Registrar a mensalidade atual como paga e renovar por mais um ciclo?')) {
                      act(() => api.markPaid(club.id), 'Pagamento registrado e sistema regularizado.')
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
                  {!billingOnly && <button title="Excluir clube" aria-label={'Excluir ' + club.establishmentName} className="danger" onClick={() => {
                    if (!club.demoMode && !['suspended', 'cancelled'].includes(club.system?.status)) {
                      alert('Bloqueie ou cancele o clube antes de excluir. Clubes de demonstração podem ser excluídos diretamente.')
                      return
                    }
                    const confirmation = prompt('Excluir ' + club.establishmentName + '? O acesso será invalidado e a assinatura Asaas vinculada será encerrada, incluindo cobranças pendentes ou vencidas. O histórico financeiro será preservado. Esta ação não apaga o banco nem o serviço Render do clube. Para confirmar, digite: ' + club.id)
                    if (confirmation === null) return
                    if (confirmation.trim() !== club.id) { alert('Código diferente. Exclusão cancelada.'); return }
                    act(() => api.deleteClub(club.id, confirmation.trim()), 'Clube excluído da lista e acessos invalidados.')
                  }}><Trash2 /></button>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Root() {
  return window.location.pathname === '/privacidade' ? <PrivacyPage /> : <App />
}

function PrivacySettings() {
  const [form, setForm] = useState({ controllerName: '', contactEmail: '', contactPhone: '' })
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let alive = true
    api.privacySettings().then(data => { if (alive) { setForm(data); setLoaded(true) } }).catch(error => { if (alive) setMessage(error.message) })
    return () => { alive = false }
  }, [])
  return <section className="content-card">
    <div className="card-head"><div><span>Dados pessoais</span><h2>Responsável e canal de privacidade</h2></div></div>
    <form className="plan-settings-form" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setMessage('')
      try { setForm(await api.savePrivacySettings(form)); setMessage('Dados de privacidade salvos.') }
      catch (error) { setMessage(error.message) }
      finally { setBusy(false) }
    }}>
      {[
        ['Nome ou razão social do responsável pela plataforma', 'controllerName', 'text'],
        ['E-mail para solicitações sobre dados pessoais', 'contactEmail', 'email'],
        ['Telefone para solicitações sobre dados pessoais', 'contactPhone', 'tel'],
      ].map(([label, key, type]) => <label key={key}>{label}<input type={type} disabled={!loaded || busy} value={form[key] || ''} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>)}
      <p className="privacy-settings-note">Informe o responsável e ao menos um canal atendido por você. Estes dados serão publicados na <a href="/privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a>. Esta configuração não altera o plano nem as cobranças.</p>
      {message && <p role="status">{message}</p>}
      <button disabled={!loaded || busy}>{busy ? 'Salvando...' : 'Salvar privacidade'}</button>
    </form>
  </section>
}
