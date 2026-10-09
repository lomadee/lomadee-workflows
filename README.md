# lomadee-workflows

Workflows reutilizáveis de GitHub Actions da Lomadee (Coolify e DigitalOcean Container Registry).

O padrão de engenharia dos serviços está em [`AGENTS.md`](./AGENTS.md).

## Workflows de deploy

- [`coolify-build-deploy.yml`](./.github/workflows/coolify-build-deploy.yml) — build da imagem no GitHub Actions, push para `registry.digitalocean.com/lomadee/<app>:<sha>` e `:latest`, disparo do deploy no Coolify.
- [`coolify-build-deploy-dashboard.yml`](./.github/workflows/coolify-build-deploy-dashboard.yml) — o mesmo fluxo para o dashboard, com os segredos lidos de um GitHub Environment.

Esses workflows publicam a imagem e disparam o Coolify. Não rodam lint nem typecheck.

## Adotar o `quality.yml`

O gate de pull request é só **lint** (sem `--fix`) e **typecheck**. Não inclui teste unitário nem smoke test. O serviço chama o workflow; este repositório não o liga ao deploy.

Pré-requisitos no `package.json` do diretório informado:

- um lockfile (`yarn.lock`, `pnpm-lock.yaml` ou `package-lock.json`);
- script `lint` (pode conter `--fix`; o CI remove esse flag e recusa `--write`);
- script `typecheck`, ou `typescript` instalado para o fallback `tsc --noEmit`.

`node_version` deve ser a versão do Dockerfile. O input de mesmo nome em `coolify-build-deploy.yml` não é usado pelo build da imagem.

Se o serviço instala pacote privado `@lomadee/*`, passe o mesmo `GH_TOKEN` do build no segredo `npm_token`. Sem pacote privado, omita o segredo.

`max_warnings` trava a contagem atual de warnings do ESLint. `-1` (padrão) não impõe teto. O número só pode cair.

```yaml
name: Qualidade

on:
  pull_request:
  push:
    branches:
      - main # branch que dispara o deploy do serviço

jobs:
  quality:
    permissions:
      contents: read
      actions: write # cache de dependências
    uses: lomadee/lomadee-workflows/.github/workflows/quality.yml@main
    with:
      node_version: "22"
      working_directory: .
      max_warnings: 128 # contagem de hoje; só pode cair
    secrets:
      npm_token: ${{ secrets.GH_TOKEN }}
```

O job tem um único runner, cancela a execução anterior do mesmo repositório, ref e diretório, e estoura em 10 minutos. Confirme em Settings → Actions deste repositório que o workflow reutilizável está liberado para a organização.

Para um monorepo, `working_directory` é a pasta que contém o `package.json` **e** o lockfile, não cada pacote interno.

## Adotar o `AGENTS.md`

Não há herança automática de arquivo. No serviço, crie um `AGENTS.md` curto que:

1. Aponte para `https://github.com/lomadee/lomadee-workflows/blob/main/AGENTS.md`.
2. Diga que, em conflito, vale a regra mais restritiva.
3. Acrescente só o que é local: a branch que dispara o deploy e a seção **Regras de negócio**, com cada regra marcada como Confirmado, Inferido ou TODO.

O arquivo local não pede teste, não enfraquece o CI e não autoriza agente a editar `.github`, migração, segredo ou dinheiro. O detalhe está na §0 e na §7 do padrão.
