import { useEffect, useState } from 'react'
import './privacy.css'

export default function PrivacyPage() {
  const [policy, setPolicy] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/privacy', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Não foi possível carregar a política. Tente novamente.')
        return response.json()
      }).then(setPolicy).catch(error => { if (error.name !== 'AbortError') setError(error.message) })
    return () => controller.abort()
  }, [attempt])
  return <main className="privacy-page">
    <a className="privacy-back" href="/">← Voltar ao sistema</a>
    <h1>Política de Privacidade</h1>
    {!policy && !error && <p>Carregando política...</p>}
    {error && <div role="alert"><p>{error}</p><button onClick={() => { setError(''); setAttempt(value => value + 1) }}>Tentar novamente</button></div>}
    {policy && <>
      <p className="privacy-version">Versão: {policy.version} • Responsável: {policy.controllerName}</p>
      {policy.sections.map(section => <section key={section.title}><h2>{section.title}</h2><p>{section.text}</p></section>)}
      <section className="privacy-contact"><h2>Canal para solicitações sobre dados</h2>
        <p><strong>{policy.controllerName}</strong></p>
        {policy.contactEmail && <p><a href={'mailto:' + policy.contactEmail}>{policy.contactEmail}</a></p>}
        {policy.contactPhone && <p><a href={'tel:+' + (policy.contactPhone.length <= 11 ? '55' : '') + policy.contactPhone}>{policy.contactPhone}</a></p>}
        {!policy.contactEmail && !policy.contactPhone && <p>O canal ainda não foi informado. Solicite o contato ao responsável pelo estabelecimento ou pela plataforma antes de enviar seus dados.</p>}
        {policy.platformPolicyUrl && <p><a href={policy.platformPolicyUrl} target="_blank" rel="noreferrer">Privacidade da plataforma ClubeOn</a></p>}
      </section>
      <p className="privacy-sources">Referências: <a href="https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm" target="_blank" rel="noreferrer">Lei Geral de Proteção de Dados</a> e <a href="https://www.gov.br/anpd/pt-br" target="_blank" rel="noreferrer">ANPD</a>.</p>
    </>}
  </main>
}
