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

A seção **Parceiros** permite cadastrar nome, WhatsApp, comissão única e status. O valor inicial sugerido é R$ 20 e pode ser editado (R$ 0,01 a R$ 1.000). Alterações valem somente para futuros convites. Em **Clientes → Cadastro por convite**, selecione **Indicado por** antes de gerar o link individual. O vínculo e o valor são salvos no servidor e copiados ao aprovar o cadastro. O cliente não pode escolher ou alterar parceiro/comissão no formulário público. Links continuam temporários (24 horas), de uso único; não são links públicos reutilizáveis de afiliado. Convites já existentes e clubes sem indicação continuam funcionando como antes.

Ao aprovar um cadastro indicado, surge uma comissão pendente, única pelo ID do clube. Fica disponível após a primeira mensalidade positiva efetivamente registrada em produção no Master (Asaas autenticado ou confirmação manual pelo Master). Reservas do espaço, demonstrações, mensalidades pendentes e pagamentos históricos anteriores a esta alteração não qualificam. A comissão não é recorrente. Repetições dos webhooks e renovações não criam outro repasse. Cada indicação preserva nome e valor históricos mesmo que o parceiro seja editado/inativado. Inativar impede apenas novos convites.

O relatório é reconciliado com pagamentos persistidos ao abrir/atualizar, reparando eventuais falhas auxiliares de registro. Estorno/remoção de mensalidade Asaas marca o pagamento correspondente como cancelado no histórico financeiro. A comissão da primeira mensalidade é cancelada se ainda não tiver sido paga. Se o repasse já foi registrado, mantém status/data/referência de pagamento e mostra um aviso de revisão com o parceiro. Não há recuperação automática de dinheiro, pagamento Pix automático nem arquivo de comprovante: o Master registra a referência de uma transação efetuada por fora. **Registrar Pix pago** exige confirmação explícita e referência, e só permite a transição disponível → paga uma vez. Cancelamento manual exige motivo e mantém histórico; não pode cancelar um repasse já pago.

Exclusão/cancelamento do clube cancela comissões ainda não pagas na próxima reconciliação. Antes de concluir um pré-cadastro, revise indicações duplicadas do mesmo estabelecimento e indicações do próprio parceiro; nesta versão não há identificação automática da mesma empresa cadastrada com IDs diferentes. Não existe portal do afiliado, rastreamento público por cookie/UTM nem pagamento recorrente ao parceiro. O mês grátis discutido comercialmente não foi implementado nesta alteração; exige ajuste próprio da cobrança.

Publicação: somente o Master no Render, sem novas variáveis/dependências. As coleções e índices únicos de parceiros/comissões são criados pelo Mongoose. Validar primeiro com um convite de teste e depois conferir uma mensalidade de produção confirmada. Não marcar mensalidade como paga apenas para testar em um clube real.

### Ponto de restauração desta versão

Código anterior às indicações: branch `restore/before-referrals-2026-10-02`, commit `01f9d1550f4adca4dd60ad8a5c3564dc6b1d7368`. Pode ser selecionado como commit anterior no Render ou usado para criar uma reversão no GitHub. Esse ponto preserva código, não é snapshot de banco. As adições são opcionais e os novos campos/coleções podem permanecer no banco após voltar ao código anterior; os dados não são removidos automaticamente. Preserve os registros financeiros e de repasses ao reverter.
