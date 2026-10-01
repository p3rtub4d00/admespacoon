# Cadastro e entrega de novos clubes

O Master administra cadastros, licenças, senhas e mensalidades. Cada clube precisa de um Web Service do Espa-oOn e um banco MongoDB próprio. Cadastrar no Master não cria recursos no Render ou no Atlas automaticamente.

## 1. Cadastro

No Master, use **Novo cliente**. Informe o responsável, contatos e vencimento. O endereço HTTPS do sistema pode ser informado depois em **Editar cadastro**.

Para testes e pilotos, marque **Criar em demonstração** antes de salvar. Não é criada assinatura real nesse modo; o painel do clube funciona sem senha. No cadastro real, a criação automática da assinatura Asaas continua dependendo da configuração Asaas do Master e do CPF/CNPJ.

Guarde a chave de licença exibida no cadastro e use **Copiar configuração da licença**. Ela é mostrada uma única vez e não é incluída na ficha, nos logs nem no checklist. Se perdê-la, renove a licença na ficha e atualize o serviço do clube com a nova chave; a antiga deixará de funcionar.

## 2. Instalação de um clube

No Render, crie um Web Service Node com o repositório `p3rtub4d00/Espa-oOn`, branch `main`, Node.js 24:

```text
Build Command: npm ci --include=dev && npm run build
Start Command: npm start
Auto-Deploy: desativado
```

Configure no serviço desse clube:

| Variável | Valor |
| --- | --- |
| `MONGODB_URI` | Banco vazio e exclusivo para esse clube, com usuário autorizado apenas nesse banco |
| `JWT_SECRET` | Segredo longo, aleatório e exclusivo desse serviço |
| `MASTER_API_URL` | Endereço HTTPS do Admin Master |
| `MASTER_CLUB_ID` | Club ID gerado no cadastro |
| `MASTER_LICENSE_KEY` | Chave gerada no cadastro |
| `ASAAS_API_KEY` | Chave de produção do recebedor das reservas, conforme a configuração atual do sistema |
| `ASAAS_ENV` | `production` |
| `ASAAS_WEBHOOK_TOKEN` | Token exclusivo do webhook desse clube, com pelo menos 32 caracteres |
| `NODE_ENV` | `production` |

A configuração atual ainda exige uma chave Asaas válida de produção na inicialização, inclusive quando o clube usa Mercado Pago ou demonstração. No modo demonstração, os fluxos de pagamento das reservas são simulados; não use contas novas reais para testar cobranças.

Configure o webhook Asaas das reservas para o serviço do clube, em `/api/webhooks/asaas`. A conta Asaas da mensalidade do SaaS fica no Master, separada da conta que recebe as reservas. Para Mercado Pago, configure o OAuth central e peça ao proprietário para conectar sua conta no painel do clube.

As variáveis de backup permanecem opcionais para o funcionamento, mas o backup automático só estará ativo quando houver um destino configurado. Defina um destino adequado antes da operação comercial.

Não copie o banco do piloto, os contratos, reservas, senhas, tokens de pagamento ou configurações de outro cliente. O serviço registra a identidade do clube no banco antes das migrações e recusa iniciar se o banco já estiver vinculado a outro Club ID. Instalações anteriores são vinculadas ao ID configurado na primeira inicialização após esta atualização. A primeira vinculação exige uma consulta válida ao Master; licença inválida ou indisponibilidade não grava uma identidade incorreta no banco. Essa verificação não consegue identificar retroativamente cópias anteriores ainda sem o registro de identidade.

## 3. Primeiro acesso e configuração

1. Faça o deploy e cadastre o endereço HTTPS publicado em **Editar cadastro**.
2. Abra o sistema do clube e confira a conexão na ficha do Master.
3. Gere o link de primeiro acesso no momento da entrega. Ele é de uso único e expira em 30 minutos; gerar um novo link invalida os anteriores pendentes.
4. O proprietário cria a senha e usa **Abrir painel do clube**. Se o endereço ainda não estiver cadastrado, a página orienta solicitar o endereço ao administrador.
5. No painel, salve os dados do estabelecimento e a tabela de preços. Ambos os provedores usam a lista de configuração inicial; Mercado Pago acrescenta a conexão da conta.
6. Na ficha do Master, confira **Preparação do cliente** e use **Atualizar status**. Os dados vêm de relatórios autenticados do sistema do clube, não de marcar manualmente uma instalação como pronta. O relatório é enviado na inicialização, ao salvar configurações e nas consultas de licença; a consulta de licença tem cache de até 5 minutos. Sem relatório há pendência; após 20 minutos sem relatório a conexão precisa ser verificada novamente.

O checklist confirma configuração e conexão, não confirma liquidação de um pagamento nem substitui uma conferência do proprietário da conta recebedora. Clubes suspensos ou com mensalidade pendente não aparecem como prontos para entrega.

## 4. Conferência de entrega

- endereço correto e proprietário consegue acessar o painel;
- dados, preços, horários, imagens e adicionais do cliente revisados;
- conta de recebimento correta, demonstrativo sem cobrança real validado e retornos de pagamento conferidos;
- modo demonstração desligado apenas quando for operar com pagamentos reais;
- política de privacidade e termos revisados na etapa 6;
- backup configurado para operação comercial.

Alterações de código seguem por PR, CI verde, merge em `main` e deploy manual. Para esta atualização, faça primeiro o deploy do Master e depois do Espa-oOn. Os clubes antigos continuam operando; podem aparecer com pendências no checklist até preencher o endereço e enviar o primeiro relatório.

## Privacidade na entrega

Preencha a identidade do responsável e o canal de atendimento no Master e no painel do estabelecimento. Confira as páginas `/privacidade` e o indicador de privacidade na ficha. Consulte [PRIVACY_OPERATIONS.md](PRIVACY_OPERATIONS.md) para guarda, atendimento e fornecedores. A presença de configuração não é certificação de adequação legal.
