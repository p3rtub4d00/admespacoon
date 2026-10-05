# EspaçoOn Master

Central administrativa do SaaS EspaçoOn.

## Primeira fase

- Login Master com cookie HTTP-only
- Cadastro e edição de clubes
- Plano único R$ 49,90/mês
- Controle de vencimento
- Bloqueio/liberação manual
- Liberação temporária
- Registro manual de mensalidade
- Chave de licença individual por clube
- Endpoint de verificação de licença
- Última conexão do sistema
- Logs de auditoria
- Dashboard de clientes, ativos, inadimplência e MRR

## Ambiente

Crie as variáveis:

```
MONGODB_URI=
MASTER_PASSWORD=
JWT_SECRET=
```

Requisitos:
- MASTER_PASSWORD: mínimo 10 caracteres
- JWT_SECRET: mínimo 32 caracteres

## Render

Build:

```
npm ci --include=dev && npm run build
```

Start:

```
npm start
```

## Licenciamento

Cada clube recebe:

- `clubId`
- `licenseKey`

A chave é armazenada apenas como SHA-256 no Master e exibida somente na criação/rotação.

O sistema do clube consultará:

```
GET /api/license/status
X-Club-ID: CLB-...
X-License-Key: ...
```

A conexão atualiza `lastSeen` e recebe o status efetivo da licença.


## Backup automático

O serviço suporta backup lógico diário para um banco MongoDB separado.

Variáveis:

```
BACKUP_MONGODB_URI=
BACKUP_RETENTION_DAYS=14
BACKUP_INTERVAL_HOURS=24
```

Use um cluster/projeto Atlas separado do banco principal. Quando configurado, o serviço cria snapshots lógicos automaticamente e mantém a retenção definida. O endpoint `/api/health` informa se o backup está configurado e a data do último snapshot concluído.

## Novos clientes

Consulte [PROVISIONING.md](PROVISIONING.md) para o fluxo de cadastro, instalação e primeiro acesso. A ficha do cliente mostra o checklist de preparação; o cadastro permite informar o endereço HTTPS do clube e iniciar em demonstração sem gerar assinatura real.

## Privacidade

A página `/privacidade` é pública. Em Configurações, preencha a identidade do responsável e o canal para solicitações. Consulte [PRIVACY_OPERATIONS.md](PRIVACY_OPERATIONS.md) para o roteiro operacional e limitações.

### Vencimento e exclusão de clubes

O cadastro e a edição aceitam a data completa do próximo vencimento (dia, mês e ano). O dia escolhido é usado na recorrência; nos meses sem esse dia, utiliza-se o último dia do mês. Datas novas devem ser atuais ou futuras. A API continua aceitando `dueDay` de clientes antigos, mas o painel envia `nextDueDate` no formato `YYYY-MM-DD`.

A lixeira nas ações permite excluir clubes de demonstração, suspensos ou cancelados, confirmando o código do clube. Para excluir um clube real ainda ativo, bloqueie-o antes. A assinatura Asaas vinculada é encerrada antes da exclusão, incluindo suas cobranças pendentes/vencidas; pagamentos já realizados são mantidos. Uma falha do provedor impede concluir a exclusão.

A exclusão é lógica: o clube deixa de aparecer na operação e de autenticar licenças/acessos. Chaves, senhas e tokens de integração são invalidados, e o histórico de pagamentos e auditoria é preservado. O faturamento histórico continua identificando o clube excluído, mas ele não conta na receita potencial. O serviço Render e o banco próprio do clube não são apagados por esse botão. Esta ação não é um fluxo de eliminação de dados pessoais.

### Indicadores da demonstração

O Master apresenta “Acessos à demonstração” na visão geral: visitas, acessos ao painel, cliques no WhatsApp e reservas simuladas concluídas, com períodos de hoje, últimos 7 dias e mês atual (horário de Manaus). O quadro soma os clubes atualmente em demonstração e não cancelados/excluídos. Atualize pelo botão do quadro. A coleta começa após o deploy e não recupera acessos antigos.

A página pública usa um identificador aleatório em sessionStorage por aba e respeita Do Not Track/Global Privacy Control. Visitas e ações são deduplicadas por sessão/aba, tipo e dia; não são pessoas únicas. Conclusões de reservas são informadas pelo servidor e deduplicadas por reserva. Nomes, CPF, telefone, assinatura, IP, referer e user-agent não são armazenados na coleção de métricas. O Master armazena clube, tipo, dia, horários, uma chave HMAC e, nas novas visitas, cidade, estado e país aproximados. Os registros expiram após 90 dias por índice TTL; backups podem conservar cópias conforme a política existente. A documentação de privacidade informa essa coleta.

O endpoint público não aceita eventos de conclusão. O envio ao Master usa a licença apenas no servidor; o Master valida novamente que o clube está em demonstração. As consultas de métricas exigem sessão Master. A coleta é auxiliar: bloqueios de navegador, indisponibilidade/reinício dos servidores, bots e testes próprios podem afetar os números. Falhas de métricas não interrompem reservas nem navegação.

Publicação: deploy primeiro do Master e depois do EspaçoOn/piloto. Não exige novas variáveis de ambiente.


## Cadastro do proprietário por convite

Na aba **Clubes**, use **Gerar link de cadastro** e copie o link antes de fechar.
Envie-o individualmente ao proprietário. O convite vence em 24 horas, pode ser
revogado no Master e aceita apenas um envio, com consumo atômico inclusive em
requisições simultâneas. Para reenviar um convite perdido ou expirado, revogue o
anterior e gere outro.

O formulário público em `/cadastro` recebe nome do clube, responsável, CPF/CNPJ,
WhatsApp, e-mail, cidade e UF. Não recebe vencimento, modo demonstração, preço,
credenciais ou endereço do **sistema**. Não cria sessão, licença ou cobrança.
Na aba Clubes, atualize a lista e use **Revisar e concluir** no cadastro recebido;
confirme os dados, configure vencimento, URL e demonstração e crie o cliente.
Somente essa etapa autenticada usa o fluxo existente de assinatura e licença.
O cadastro recebido mantém um ID de clube estável para impedir criações duplas.
O formulário manual continua disponível em **Novo cliente**.

O token de 32 bytes fica no fragmento do link (não na query ou caminho das APIs),
é retirado da barra de endereço após a abertura e enviado no corpo das consultas.
Somente seu hash SHA-256 fica no banco. Ao recarregar a página, reabra o link
original. APIs usam `no-store`, não devolvem dados pessoais ao portador do link e
validam prazo e revogação em cada operação. A página informa envio por HTTPS e
acesso da equipe autorizada; **não** afirma criptografia de todos os campos no
banco nem oculta CPF/CNPJ da equipe master. Há link para o aviso de privacidade.
Os registros de convite não têm expurgo automático; revogação desativa o convite,
sem apagar seus dados. Revise sua guarda conforme a finalidade do cadastro.

Não há nova variável obrigatória. Em produção, o endereço do Master deve usar
HTTPS; `PUBLIC_BASE_URL`, se configurada, deve apontar para sua origem HTTPS.
Apenas o repositório Master precisa ser atualizado para esta funcionalidade.

### Localização dos acessos à demonstração

O painel Master mostra “De onde vêm as visitas”, com até 20 localidades por período (hoje, últimos 7 dias ou mês atual), além das contagens de localização não identificada e outras localidades. O quadro considera apenas eventos de visita, mantém a deduplicação existente e não mede impressões de anúncios. Acessos antigos continuam sem localização; dados expirados mantêm a retenção de 90 dias.

O servidor do piloto usa o IP determinado pelo proxy confiável (`trust proxy = 1`, conforme a implantação no Render) para consultar `https://ipwho.is/`, com resposta limitada a cidade, região e país. Não usa o IP do servidor Master nem campos de localização enviados pelo navegador. Nunca exponha diretamente esse servidor fora do proxy configurado sem rever `trust proxy`. O IP é transmitido ao provedor, mas não é salvo nas métricas, logs dessa consulta ou enviado ao Master; também não são salvas coordenadas. Cache temporário em memória usa uma chave HMAC com segredo aleatório por processo, duração de 15 minutos e limite de 1.000 entradas. Do Not Track e Global Privacy Control continuam respeitados.

A consulta tem timeout de 1,5 segundo, limite de oito consultas simultâneas e orçamento local de 1.000 consultas diárias por processo. O serviço gratuito do IPWHOIS.io dispensa chave e admite uso comercial, mas tem limite próprio de 1.000 consultas por dia por IP de saída e não garante disponibilidade: https://ipwhois.io/documentation . Processos que compartilham IP de saída compartilham a quota externa. Falha, quota excedida, IP privado/reservado ou geografia ausente deixam a visita sem localização; não impedem reservas ou navegação. VPN e redes móveis podem indicar outra localidade.

Publicação desta alteração: primeiro Master, depois EspaçoOn/piloto. Sem novas variáveis de ambiente. Conferir a tabela depois de um novo acesso público à demonstração e clicar em Atualizar. A política pública foi atualizada para explicar o uso do IP pelo provedor de geolocalização e a guarda apenas da localização aproximada.

## Parceiros e indicações por pré-cadastro

A seção **Parceiros** permite cadastrar nome, WhatsApp, comissão percentual mensal e status. O percentual inicial é **30%**, editável entre 0,01% e 100%. Alterações valem somente para futuros convites: cada vínculo mantém o percentual acordado. Em **Clientes → Cadastro por convite**, selecione **Indicado por** antes de gerar o link individual. O vínculo e o percentual são definidos no servidor e copiados ao aprovar o cadastro. O formulário público não permite alterá-los. Links continuam temporários (24 horas), de uso único.

A comissão é **recorrente sobre cada mensalidade positiva efetivamente paga**, registrada em produção no Master (Asaas autenticado para uma cobrança da assinatura, ou baixa manual pelo Master). Reservas do espaço, demonstrações, cobranças pendentes e pagamentos históricos sem a marca de elegibilidade não qualificam. Cada registro guarda pagamento, período, base paga, percentual e valor em centavos. O percentual também é fixado no registro financeiro para reconciliação posterior. Webhooks repetidos não geram outra comissão para o mesmo pagamento; um identificador único por clube e pagamento protege contra concorrência.

Exemplo: R$ 49,90 × 30% = R$ 14,97 por mensalidade. Se 15 clubes pagarem, são R$ 224,55; se só 9 renovarem no mês seguinte, são R$ 134,73 nesse mês. Meses sem pagamento não geram comissão; uma mensalidade atrasada gera a comissão quando paga. A base é o valor bruto registrado da mensalidade, sem dedução de taxas do gateway.

O filtro por parceiro altera tanto a tabela quanto os totais acumulados disponíveis, pagos e cancelados. **Ver clientes ativos** em cada parceiro mostra os clubes em produção, não excluídos, com sistema ativo, cobrança ativa ou teste válido e sem vencimento passado. A lista exibe nome, situação e vencimento; estar ativo, inclusive em teste, não gera comissão por si só. Não inclui dados pessoais do proprietário. Parceiros inativos não podem gerar novos convites; vínculos existentes continuam gerando comissão por mensalidade paga.

O relatório reconcilia pagamentos persistidos ao abrir/atualizar, reparando eventuais falhas auxiliares. Estorno/remoção da mensalidade cancela somente sua comissão ainda disponível; renovações posteriores geram registros independentes. Repasses já pagos mantêm valor/data/referência e exibem aviso de revisão com o parceiro. Exclusão/cancelamento do clube cancela valores disponíveis na reconciliação. Cancelamento manual exige motivo e afeta somente a comissão selecionada, preservando o histórico. **Registrar Pix pago** exige confirmação explícita e referência e permite registrar cada comissão uma única vez. O Pix é feito por fora: não há transferência, recuperação de dinheiro nem upload de comprovante automáticos.

### Compatibilidade com a comissão única anterior

A coleção anterior `ReferralCommission` fica preservada, sem remoção do índice único por clube. Os registros recorrentes usam `ReferralMonthlyCommission`. Uma comissão anterior já paga é importada para o mesmo pagamento, preservando valor e referência, sem gerar novo repasse. Comissões anteriores disponíveis passam a usar 30% do valor da mensalidade; canceladas com pagamento identificado mantêm o cancelamento daquela mensalidade. Registros antigos pendentes sem pagamento permanecem na coleção anterior e não representam dinheiro a receber. Parceiros, clubes e convites antigos sem percentual usam 30%; o campo antigo em reais não é interpretado como percentual. Não alteramos mensalidades, cobranças do provedor ou reservas para gerar comissão.

Antes de concluir um pré-cadastro, revise indicações duplicadas e indicações do próprio parceiro; não há identificação automática da mesma empresa cadastrada com IDs diferentes. Não existe portal do afiliado, rastreamento público por cookie/UTM ou repasse Pix automático. O mês grátis não faz parte desta alteração.

Publicação: somente o Master no Render, sem novas variáveis/dependências. Após o deploy, conferir Parceiros, um convite indicado e o relatório de mensalidades confirmadas. Não registrar pagamentos fictícios em clubes reais para testar.

### Ponto de restauração desta versão

Código anterior às indicações: branch `restore/before-referrals-2026-10-02`, commit `01f9d1550f4adca4dd60ad8a5c3564dc6b1d7368`. Pode ser selecionado como commit anterior no Render ou usado para criar uma reversão no GitHub. Esse ponto preserva código, não é snapshot de banco. As adições são opcionais e os novos campos/coleções podem permanecer no banco após voltar ao código anterior; os dados não são removidos automaticamente. Preserve os registros financeiros e de repasses ao reverter.

Ponto adicional anterior à comissão recorrente: `restore/before-recurring-referrals-2026-10-02`, commit `689f7ee33ea48b97d4f2832122e27c1a87646edc`. Ao reverter, preservar as duas coleções e revisar o histórico recorrente antes de registrar novos repasses na versão antiga, que não o consulta.

### Diagnóstico das visitas sem localização

As visitas novas do demo podem incluir `locationStatus`, restrito a códigos fixos de resultado da consulta. O relatório agrega os motivos por período e exibe timeout, quota, indisponibilidade, IP público ausente ou dados não disponíveis. Visitas anteriores sem esse campo aparecem como antigas/sem diagnóstico; não há recuperação retroativa de localização, porque o IP não foi armazenado. Não são aceitos IPs nem mensagens brutas de erro nesse campo. Publicar também a correção de coleta no serviço do demo.

## Catálogo público ClubeOn

A seção **Catálogo** administra gratuitamente espaços e fornecedores enviados pelo site `clubeon`. Cadastros novos já aparecem no site e geram uma notificação de revisão. Confira informações e fotos, depois marque como revisado ou recuse com um motivo para retirar do site; **Ocultos** retira o anúncio e suas fotos do acesso público. Nome do responsável, e-mail e observações ficam restritos ao master. Não há criação de licença, assinatura, pagamento ou comissão ao enviar um cadastro de catálogo.

O catálogo usa a coleção `CatalogEntry`, separada dos clientes pagantes, no banco existente do master. As fotos são JPEG reduzidos de até 100 KB cada, no máximo seis por anúncio; aproximadamente 600 KB de fotos por cadastro completo, mais seus textos e metadados. O backup existente inclui a nova coleção automaticamente. Cadastros não são apagados automaticamente.

Publique esta atualização antes de configurar o novo site. No serviço Render do repositório `clubeon`, configure `MASTER_API_URL` com a origem HTTPS deste master (sem caminho, senha ou `/api`). Nenhuma variável adicional é necessária neste master. Os endpoints públicos `/api/catalog` devolvem somente anúncios publicados; as rotas `/api/master/catalog` exigem a sessão administrativa existente.

Ponto de restauração: branch `restore/before-public-catalog-2026-10-04`. A reversão de código não apaga os dados cadastrados.

O sino no topo e a seção **Notificações** mostram a quantidade e os cinco anúncios mais recentes ainda não revisados. O master aberto consulta novidades a cada 60 segundos; a revisão ou recusa atualiza o contador. A notificação leva direto ao anúncio para revisão. Cadastros pendentes da versão anterior permanecem visíveis na fila, sem publicação retroativa automática. Não há mensagens automáticas por WhatsApp nem edição pelo proprietário nesta etapa. Novo ponto de restauração: `restore/before-catalog-auto-publication-2026-10-04`.

## Acesso de anunciantes ao catálogo

Em Notificações, a seção Pedidos de acesso aos anúncios recebe solicitações feitas no catálogo pelo WhatsApp cadastrado. Confira os anúncios, selecione os que pertencem ao responsável e gere o link. O envio por WhatsApp é manual: o botão abre a conversa no número cadastrado com mensagem pronta. O link vale por 24 horas e só pode ser usado uma vez para definir/recuperar senha. Não há Telegram ou API de WhatsApp neste fluxo.

As coleções CatalogOwner e CatalogAccessRequest ficam no banco do Master. CatalogEntry recebe ownerId apenas após liberação pela equipe. Sessões dos anunciantes são independentes da sessão Master, com papel e audiência próprios; todas as leituras/escritas e fotos privadas exigem o proprietário vinculado. Recuperar a senha revoga sessões anteriores. Alterar o WhatsApp do anúncio no Master remove o vínculo anterior; é necessário liberar o anúncio ao novo responsável.

Novos pedidos e alterações de anúncios aparecem nas notificações. Edições não republicam anúncios ocultos/recusados automaticamente. O cadastro continua gratuito, separado dos clubes pagos e de suas reservas/assinaturas.

Não há novas variáveis obrigatórias. O segredo JWT_SECRET existente também assina as sessões com audiência exclusiva do anunciante. Publique o Master antes do catálogo.

### Contato dos espaços com agendamento online

A opção de reservas online exige um site HTTPS e direciona os visitantes apenas ao botão de reservas. O WhatsApp continua obrigatório como contato privado para liberar o acesso do responsável; não é retornado pelas APIs públicas desses anúncios. A área do dono e o Master continuam recebendo o telefone. Fornecedores e espaços sem agendamento mantêm o WhatsApp público. Anúncios antigos de espaços que já têm site usam reservas online por padrão; o responsável ou o Master pode desativar a opção se o link for apenas institucional.

Atualize o Master antes do catálogo. Não há novas variáveis de ambiente ou migração obrigatória.

### Push para pedidos de acesso ao catálogo

Um novo pedido de acesso de um anunciante cadastrado dispara o Web Push existente do Master para os dispositivos habilitados. Uma nova tentativa também alerta quando o pedido já está pendente, incluindo pedidos antigos salvos antes da integração do push. Um limite atômico de um alerta por minuto e por pedido evita duplicação por cliques rápidos ou tentativas simultâneas. Uma solicitação atendida ou arquivada pode ser reaberta após o intervalo existente de 10 minutos. O payload não contém telefone, senha ou link de ativação. Ao tocar no alerta, o Master abre a área de notificações (após login, se necessário). Uma falha de entrega não impede salvar o pedido.

Não há novas variáveis de ambiente. As notificações precisam estar habilitadas no dispositivo; o recebimento físico deve ser conferido no PWA após atualizar o serviço Master.

### Instagram no anúncio

Instagram é opcional para espaços e fornecedores e aceita somente `@perfil` (até 30 caracteres no nome, com letras, números, ponto e sublinhado). Links não são aceitos. O Master e o responsável podem editar o perfil; a API pública retorna o perfil informado. Anúncios antigos continuam funcionando sem preenchimento. Atualize o Master antes do catálogo, sem novas variáveis de ambiente.

### Estruturas adicionais do espaço

TV, bebedouro e ar-condicionado integram as opções fixas e os filtros do catálogo. O cadastro e a edição pelo proprietário ou Master também aceitam até 20 estruturas personalizadas, com até 60 caracteres por item. Elas aparecem no anúncio e podem ser removidas na edição; não criam filtros globais. Nomes equivalentes às opções fixas selecionam a opção existente, evitando duplicação. Anúncios antigos continuam funcionando sem preenchimento adicional.

Publicar o backend/painel Master antes do catálogo. Não há novas variáveis de ambiente nem migração obrigatória.


### Controle do assistente com IA

Nos detalhes de cada clube, a seção Assistente com IA permite ativar o chat e definir o limite mensal (padrão: 1.000 perguntas). Todos os clubes começam desativados. A chave `GEMINI_API_KEY` deve estar no ambiente do serviço de reservas, não no Master nem no navegador. Publique o Master antes do serviço de reservas. Ativar a opção não altera a mensalidade.

O painel mostra consultas iniciadas, chamadas ao modelo e tokens do mês em Porto Velho. Inclui falhas; contadores são sincronizados pelo serviço do clube após consultas. Reenvios não duplicam os valores e uma falha de sincronização é recuperada na próxima consulta. Mensagens não são armazenadas no Master. O limite de perguntas não representa orçamento financeiro nem substitui as cotas do provedor.


### Recuperação de senha do painel dos clubes

O proprietário solicita recuperação na tela de login do seu clube usando o celular cadastrado. O serviço autentica o pedido pela licença do próprio clube; número diferente recebe o mesmo retorno público, sem identificar cadastros e sem criar pedido. Não exige senha nem mensalidade ativa para solicitar atendimento. Demonstração não utiliza senha e não cria pedidos.

O Master recebe o pedido na área Notificações e dispara o Web Push existente para dispositivos habilitados, com destino à mesma área após login. Confira o responsável, gere o link e abra o WhatsApp pelo botão. O envio da mensagem é manual e usa somente o celular cadastrado; se ele mudou após o pedido, a emissão é recusada até uma nova solicitação. O link mantém validade de 30 minutos, uso único, hash no banco e revogação de links anteriores. Solicitar recuperação não altera a senha e não emite link automaticamente.

A coleção ClubRecoveryRequest registra um pedido por clube; pedidos pendentes não são duplicados, alertas repetidos têm intervalo mínimo de um minuto e pedidos atendidos/arquivados podem ser reabertos após dez minutos. A lista mostra até 50 pendentes por vez; ao atender, atualize para carregar os demais. Há limite de cinco solicitações por 15 minutos por clube no Master e por IP no serviço público.

Na ficha, Acesso ao painel fica visível inclusive na demonstração (geração desabilitada e explicação). Preparação do clube e Assistente com IA começam recolhidos. Publique o Master antes do serviço de reservas. Não há novas variáveis. Valide o recebimento físico do push no PWA depois do deploy; testes locais verificam o disparo, não o dispositivo real.
