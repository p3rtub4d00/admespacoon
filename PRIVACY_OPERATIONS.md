# Privacidade e operação dos dados — etapa 6

Versão do aviso: 2026-10-01. As páginas públicas ficam em `/privacidade` nos dois serviços. O conteúdo foi elaborado a partir dos fluxos existentes, da LGPD e das orientações da ANPD; não equivale a certificação de adequação integral.

## Configuração após o deploy

1. Master > Configurações > Responsável e canal de privacidade: informe o nome ou razão social de quem responde pela plataforma e um e-mail ou telefone efetivamente atendido. A gravação usa uma rota própria, sem alterar plano ou cobranças.
2. Painel do clube > Dados do estabelecimento: preencha os campos de privacidade e use Salvar dados. O telefone geral do estabelecimento pode ser o canal, se o campo específico estiver vazio.
3. Abra `/privacidade` sem login e confira identidade, contato e informações sobre o uso dos dados.
4. Na ficha do Master, confira a pendência de responsável/canal de privacidade. O indicador só confirma presença de configuração; não confirma revisão jurídica ou funcionamento do atendimento.
5. Confira a razão social, a relação entre estabelecimento e plataforma e os contratos com os fornecedores. Não preencha nome/CNPJ ou endereços fictícios.

## Registro inicial das operações identificadas

| Operação | Dados observados no código | Objetivo e acesso | Onde conferir |
| --- | --- | --- | --- |
| Cadastro e assinatura do SaaS | Identificação, CPF/CNPJ informado, contatos, cidade/UF, plano e vencimentos | Prestação da plataforma e mensalidade; administração autenticada | Cadastro, cobrança e logs do Master |
| Primeiro acesso e autenticação | Hash/salt de senha, hash do link, expiração, uso, cookie de sessão | Controle de acesso; link expira em 30 minutos e tem uso único | Rotas de primeiro acesso e autenticação |
| Licenciamento e preparo | ID do clube, hash da chave, endereço do serviço, última conexão e indicadores de configuração | Autorizar acesso e acompanhar entrega; envio autenticado por licença | Ficha do Master e relatórios de configuração |
| Pagamentos | Identificadores e estados dos provedores; credenciais OAuth protegidas | Cobranças e recebimentos; compartilhamento necessário com Asaas/Mercado Pago | Integrações, webhooks e registros financeiros |
| Notificações | Endpoint/chaves de inscrição do dispositivo, preferências e aviso | Alertas administrativos mediante permissão | Configuração de push e navegador |
| WhatsApp | IDs de evento/mensagem e estado de processamento | Tratamento dos eventos configurados; telefone de remetente retirado do log de mensagens novas | Webhook central |

O responsável deve complementar este registro com os fornecedores e regiões realmente contratados, justificativas, responsáveis internos, acessos e prazos de guarda. Não foi criada uma rotina de envio de publicidade.

## Atendimento ao titular

Receba o pedido no canal publicado. Registre data, assunto, responsável, identificação proporcional e providências; não peça senha nem cópia de documento completo sem necessidade. Encaminhe solicitações sobre visitas/reservas ao estabelecimento responsável e as da assinatura da plataforma ao responsável do Master.

Pesquise registros por acesso administrativo autorizado e responda por canal seguro. Não envie listagens de outros clientes. Analise correção, acesso, portabilidade e demais pedidos conforme a base aplicável. Preserve a integridade dos contratos assinados; uma retificação pode exigir registro complementar. Para eliminação, determine antes quais dados podem ser apagados e quais registros precisam permanecer. O sistema não implementa um prazo de expurgo automático nem uma exclusão geral de contratos pagos.

Os prazos e exceções devem ser verificados no caso concreto nas referências oficiais abaixo. O atendimento não foi automatizado: a inclusão de contato na página não significa que há equipe respondendo.

## Guarda, fornecedores e incidentes

Defina e documente uma tabela de guarda para visitas, contratos, registros de pagamento, logs, links expirados e inscrições de push. Revise os registros sem finalidade; esta etapa não elimina dados de produção. Backups dependem das variáveis e do destino configurado: sua ativação continua pendente quando não houver destino. Inclua backups e cópias exportadas no procedimento de retenção e atendimento.

Confirme no Render, Atlas e provedores as regiões de tratamento e os contratos aplicáveis. O código não verifica cláusulas contratuais de transferência internacional. Documente instruções da plataforma como prestadora técnica e as responsabilidades próprias na cobrança do SaaS.

Se houver suspeita de incidente, preserve evidências, interrompa a exposição, restrinja os acessos e avalie o impacto com o responsável. Verifique a regulamentação vigente da ANPD e as comunicações cabíveis. Não apague evidências nem publique dados de clientes em logs, tickets ou prints de suporte.

## Alterações técnicas desta etapa

- avisos públicos acessíveis sem login e informações próximas à coleta;
- contatos configuráveis sem inventar identidade ou endereço de atendimento;
- consulta de reserva por `POST /api/reservations/lookup`, com CPF no corpo em vez da URL; continua exigindo o código e o CPF correto;
- retirada da rota GET antiga de consulta; abas com JavaScript antigo precisam ser atualizadas após o deploy;
- respostas administrativas, consultas pessoais e documentos com `Cache-Control: no-store`;
- retirada do telefone do remetente dos novos logs de WhatsApp; logs antigos não são alterados;
- pendência de privacidade integrada ao checklist dos clubes; não bloqueia funcionalidades existentes;
- sem transformar a ciência do aviso em consentimento genérico para usos adicionais.

## Referências consultadas

- [LGPD — texto compilado](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm)
- [ANPD — direitos dos titulares](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares)
- [ANPD — titular e agentes de tratamento](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados)
- [Resolução CD/ANPD nº 2/2022](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-2-de-27-de-janeiro-de-2022)

A dispensa de encarregado para determinados agentes de pequeno porte não elimina o canal de atendimento. O enquadramento e as demais obrigações dependem da operação concreta.
