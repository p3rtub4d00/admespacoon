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

A página pública usa um identificador aleatório em sessionStorage por aba e respeita Do Not Track/Global Privacy Control. Visitas e ações são deduplicadas por sessão/aba, tipo e dia; não são pessoas únicas. Conclusões de reservas são informadas pelo servidor e deduplicadas por reserva. Nomes, CPF, telefone, assinatura, IP, referer e user-agent não são armazenados na coleção de métricas. O Master armazena somente clube, tipo, dia, horários e uma chave HMAC. Os registros expiram após 90 dias por índice TTL; backups podem conservar cópias conforme a política existente. A documentação de privacidade informa essa coleta.

O endpoint público não aceita eventos de conclusão. O envio ao Master usa a licença apenas no servidor; o Master valida novamente que o clube está em demonstração. As consultas de métricas exigem sessão Master. A coleta é auxiliar: bloqueios de navegador, indisponibilidade/reinício dos servidores, bots e testes próprios podem afetar os números. Falhas de métricas não interrompem reservas nem navegação.

Publicação: deploy primeiro do Master e depois do EspaçoOn/piloto. Não exige novas variáveis de ambiente.
