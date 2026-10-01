# Processo seguro de desenvolvimento e deploy

## Fluxo de trabalho

- `main`: produção. Não desenvolver diretamente nela.
- `develop`: integração das próximas alterações.
- alterações devem ser feitas em `develop` ou em branches derivadas dela;
- antes de levar uma mudança para `main`, abrir Pull Request;
- o GitHub Actions executa o job `build-and-check`;
- somente depois do CI verde a alteração deve ser incorporada em `main`;
- o deploy de produção deve ser disparado manualmente no Render.

## Validações automáticas

O workflow `.github/workflows/ci.yml` executa:

1. instalação reproduzível das dependências com `npm ci --include=dev` e `package-lock.json`;
2. validação de sintaxe do backend com `node --check server/index.js`;
3. testes de regressão com `npm test`;
4. build de produção do frontend com `npm run build`.

## Configuração recomendada da branch main no GitHub

Em Settings > Branches ou Settings > Rules > Rulesets, proteja `main` com:

- exigir Pull Request antes de merge;
- exigir o status check `build-and-check`;
- bloquear force-push;
- bloquear exclusão da branch;
- exigir que a branch esteja atualizada antes do merge.

Para um projeto mantido por uma única pessoa, não é necessário exigir aprovação de outro revisor.

## Render

Produção deve acompanhar a branch `main`, mas com Auto-Deploy desativado.

Fluxo:

```
desenvolvimento
  -> develop
  -> Pull Request
  -> CI verde
  -> merge em main
  -> deploy manual no Render
  -> teste rápido de produção
```

Se o serviço do Render tiver sido configurado manualmente pelo painel e não por Blueprint, confirme também no Dashboard do Render que Auto-Deploy está desativado; o arquivo `render.yaml` não altera retroativamente todos os serviços criados manualmente.


## Testes locais e dependências

Use Node.js 24, a mesma versão principal do CI.

```sh
npm ci --include=dev
npm test
npm run build
```

Os testes usam dados fictícios e servidores HTTP apenas em loopback. Não conectam ao MongoDB, não enviam notificações e não criam cobranças reais. A aplicação só conecta ao banco e inicia agendadores quando executada por `npm start`.

Ao alterar dependências, use `npm install` para atualizar o `package.json` e o `package-lock.json` juntos; inclua ambos no Pull Request. CI e deploy usam `npm ci`, que falha quando esses arquivos estão inconsistentes.

No Render, se o serviço foi criado manualmente, atualize o **Build Command** para `npm ci --include=dev && npm run build`. Mantenha o **Start Command** como `npm start` e Auto-Deploy desativado.
