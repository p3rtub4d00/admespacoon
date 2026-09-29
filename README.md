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
npm install && npm run build
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
