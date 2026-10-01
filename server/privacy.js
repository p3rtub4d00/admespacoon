export const PRIVACY_VERSION = '2026-10-01'
const clean = (value, max) => String(value ?? '').trim().slice(0, max)

export function sanitizePrivacyConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Configuração de privacidade inválida.'), { statusCode: 400 })
  const controllerName = clean(input.controllerName, 160)
  const contactEmail = clean(input.contactEmail, 160).toLowerCase()
  const contactPhone = clean(input.contactPhone, 30).replace(/\D/g, '')
  if (controllerName && controllerName.length < 3) throw Object.assign(new Error('Informe o nome do responsável pelo tratamento dos dados.'), { statusCode: 400 })
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw Object.assign(new Error('E-mail de privacidade inválido.'), { statusCode: 400 })
  if (clean(input.contactPhone, 30) && (contactPhone.length < 10 || contactPhone.length > 13)) throw Object.assign(new Error('Telefone de privacidade inválido.'), { statusCode: 400 })
  return { controllerName, contactEmail, contactPhone }
}

export function buildPrivacyPolicy({ scope = 'club', config = {}, establishment = {}, platformUrl = '' } = {}) {
  const privacy = sanitizePrivacyConfig(config)
  const fallbackPhone = String(establishment.phone || '').replace(/\D/g, '')
  const contactPhone = privacy.contactPhone || (/^\d{10,13}$/.test(fallbackPhone) ? fallbackPhone : '')
  const controllerName = privacy.controllerName || (scope === 'club' ? establishment.name || 'Responsável pelo estabelecimento' : 'Responsável pela plataforma ClubeOn')
  const configured = Boolean(privacy.controllerName && (privacy.contactEmail || contactPhone))
  const isClub = scope === 'club'
  return {
    version: PRIVACY_VERSION, controllerName, configured,
    contactEmail: privacy.contactEmail, contactPhone,
    platformPolicyUrl: /^https:\/\//.test(platformUrl) ? platformUrl.replace(/\/$/, '') + '/privacidade' : null,
    sections: [
      { title: 'Quem trata seus dados', text: isClub
        ? 'O responsável pelo estabelecimento identificado nesta página decide o uso dos dados de visitas, reservas e contratos. A plataforma ClubeOn presta serviços técnicos de armazenamento e operação. O responsável pela plataforma trata também os dados necessários à gestão da assinatura do estabelecimento.'
        : 'O responsável pela plataforma identificado nesta página administra os dados de proprietários, contatos comerciais, licenças, senhas administrativas e mensalidades. Cada estabelecimento responde pelas decisões sobre os dados dos seus clientes; a plataforma presta a operação técnica desses sistemas.' },
      { title: 'Dados e finalidades', text: isClub
        ? 'Para visitas, usamos nome, telefone e data/horário sugeridos. Para reservas e contratos, usamos nome, CPF, telefone, e-mail e endereço informados, período, valores, adicionais e imagem da assinatura eletrônica. Esses dados permitem atender seu pedido, identificar o contratante, registrar o contrato, cobrar, confirmar pagamentos e tratar cancelamentos. Registros técnicos e sessões são usados para segurança e funcionamento.'
        : 'Usamos identificação e contato do responsável e do estabelecimento, CPF/CNPJ informado, endereço do sistema, plano, vencimentos, pagamentos, licenças e registros administrativos. Senhas são armazenadas como hashes; integrações de pagamento usam credenciais protegidas. A finalidade é prestar o serviço contratado, dar suporte, administrar cobranças e acessos e proteger a plataforma.' },
      { title: 'Fundamentos do tratamento', text: 'Pedidos e contratos utilizam os dados necessários à execução contratual e às providências solicitadas pelo titular. Registros exigidos por lei e defesa de direitos podem justificar a conservação. Atividades de segurança devem observar necessidade e avaliação da base aplicável. Notificações no navegador dependem de permissão, que pode ser desativada. Este aviso não autoriza marketing nem tratamento indiscriminado.' },
      { title: 'Compartilhamento e serviços externos', text: 'Dados necessários podem ser enviados ao estabelecimento, à plataforma, aos provedores de pagamento selecionados (Asaas ou Mercado Pago) e à infraestrutura de hospedagem e banco de dados (Render e MongoDB/Atlas, conforme a instalação). Imagens/fontes externas e notificações podem transmitir dados técnicos aos respectivos serviços. Ao compartilhar um documento pelo WhatsApp, o usuário escolhe enviar os dados pelo serviço da Meta. A hospedagem pode envolver processamento fora do Brasil; peça informações sobre fornecedores e regiões ao canal abaixo. Os provedores têm políticas próprias.' },
      { title: 'Cookies e armazenamento no navegador', text: 'Cookies de sessão mantêm acessos administrativos autenticados. O navegador pode guardar arquivos da aplicação; preferências de avisos podem permanecer na sessão do navegador. Notificações usam uma inscrição do dispositivo e exigem permissão. No modo demonstração, um identificador aleatório temporário por aba permite contar acessos e cliques sem enviar nome, CPF, telefone ou conteúdo da reserva aos indicadores. As conclusões de reservas simuladas são contadas por uma chave derivada do identificador da reserva. Os registros de métricas ficam por até 90 dias, sujeitos à limpeza técnica e à retenção de backups. Fora da demonstração, essa coleta fica desativada. Não usamos esses indicadores para publicidade direcionada. Serviços externos podem tratar seus próprios dados técnicos.' },
      { title: 'Guarda, proteção e documentos', text: 'O responsável deve revisar a guarda conforme finalidade, obrigações e defesa de direitos. Reservas e contratos não são apagados automaticamente. Pedidos de eliminação são analisados para identificar registros que precisam ser conservados. Existem controles de acesso e validação de sessões; backups dependem da configuração de cada instalação. Documentos baixados ou compartilhados passam também a depender dos cuidados de quem os recebeu.' },
      { title: 'Seus direitos e contato', text: 'Você pode solicitar confirmação de tratamento, acesso, correção, informações sobre compartilhamento e, quando cabível, portabilidade, anonimização, bloqueio ou eliminação. Se houver consentimento, pode pedir sua revogação e informações sobre as consequências. Use o canal desta página e informe a solicitação; a identidade poderá ser verificada de forma proporcional. Não envie senha ou dados de cartão. Os pedidos são analisados pelo responsável e registrados para acompanhamento. Também é possível procurar a ANPD.' },
      { title: 'Atualizações', text: 'Mudanças relevantes serão refletidas na versão e no conteúdo desta página. Consulte este aviso antes de enviar dados. A política de cancelamento e o contrato da reserva são apresentados separadamente.' },
    ],
  }
}
