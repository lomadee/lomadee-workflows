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

O check desse caminho continua `quality / Lint and typecheck`. O gate da organização, abaixo, usa outro nome de propósito.

## Gate da organização (`org-quality.yml`)

Workflow para o Hugo exigir lint e typecheck num ruleset da organização, sem abrir PR em cada repositório. O arquivo é [`.github/workflows/org-quality.yml`](./.github/workflows/org-quality.yml). Ele não é `workflow_call`: ruleset workflow não recebe inputs nem secrets do caller.

| O que o Hugo configura | Valor |
|---|---|
| Regra | Require workflows to pass before merging |
| Repositório | `lomadee/lomadee-workflows` |
| Branch | `main` |
| Caminho | `.github/workflows/org-quality.yml` |
| Check no pull request | `Org quality / Org lint and typecheck` |

O check do `quality.yml` (`quality / Lint and typecheck`) não muda. O ruleset `quality-gate` que já exige esse check continua válido. Este workflow não cria um job com o nome `Lint and typecheck`.

O job só faz lint (sem `--fix`) e/ou typecheck. Não roda teste unitário nem smoke test. Permissões: `contents: read` e `packages: read`. Não há cache de `node_modules`.

### O que cada repositório pode declarar

Arquivo opcional, na raiz do repositório alvo: `.github/quality.json`.

```json
{
  "working_directory": "apps/api",
  "max_warnings": 40
}
```

Os dois campos são opcionais. Sem o arquivo, o diretório é `.` e `max_warnings` é `-1` (sem teto). `max_warnings` é número JSON inteiro, maior ou igual a `-1`. String não vale. Chave desconhecida ou JSON inválido faz o check falhar. O teto só pode cair (WF-CI-02).

Node, nesta ordem: `.nvmrc` e `.node-version` no `working_directory`, os mesmos arquivos na raiz do repositório, o primeiro número de `engines.node`, senão `22`. Um arquivo de pin vazio ou ilegível falha o check. `engines.node` com intervalo usa o primeiro número (`>=20.11.0 <23` instala `20.11.0`). Para travar a versão, use `.nvmrc`.

Há um diretório por repositório. Quem precisa de vários pacotes continua chamando o `quality.yml` (o gate da organização inteiro é ignorado nesse caso).

### Quando o check passa sem rodar lint

O job fica verde e escreve um notice e um summary:

- não existe `package.json` no diretório;
- o `package.json` não tem script `lint` nem script `typecheck` (só string não vazia conta);
- algum arquivo `.github/workflows/*.{yml,yaml}` contém `lomadee/lomadee-workflows/.github/workflows/quality.yml` (é o caso de `open-api` e `dashboard-api`).

Se só um dos scripts existe, roda esse. Não há fallback `tsc --noEmit` (isso continua só no `quality.yml`). Script presente sem lockfile falha: não dá para instalar de forma congelada.

Presença da string do `quality.yml` num workflow, inclusive em comentário, ignora o repositório inteiro. Monorepo que chama o workflow reutilizável para um pacote não ganha o gate da organização nos outros pacotes.

### Token dos pacotes `@lomadee/*`

O workflow roda no repositório **alvo**. Secrets de `lomadee-workflows` não chegam lá. O valor nunca é impresso. Precedência:

1. Segredo `GH_TOKEN` disponível no repositório alvo: segredo do repositório, ou segredo de organização com esse nome e acesso ao repositório. É o mesmo nome que o build Coolify já usa. Se os dois existirem, o segredo do repositório ganha.
2. Se `GH_TOKEN` estiver vazio, `github.token` com `packages: read`.

O `GITHUB_TOKEN` só instala pacote de outro repositório se o pacote liberar Actions para o repositório alvo (página do pacote → Package settings → Manage Actions access). Não há um padrão da organização que entregue todos os pacotes privados a todos os repositórios.

O token é gravado em `~/.npmrc` só no passo de install (modo `0600`) e o arquivo é restaurado ao terminar. Lint e typecheck não recebem `GITHUB_TOKEN` nem `NODE_AUTH_TOKEN`. Um `postinstall` do PR ainda enxerga o token durante o `npm ci` / `yarn` / `pnpm`. O `GH_TOKEN` precisa ser só `read:packages`, não um PAT de administração.

Pull request vindo de fork fora da organização pode não receber o segredo `GH_TOKEN`. O `GITHUB_TOKEN` do repositório base continua valendo quando o pacote libera esse repositório.

### Rollout

O arquivo precisa estar em `main` antes do ruleset enxergá-lo. Esta regra bloqueia push direto nos branches que ela mira: só use em branch que muda por pull request. Não mire todos os branches.

1. Confirme em Settings → Actions → General de `lomadee-workflows` que workflows e actions estão acessíveis aos repositórios da organização (`Accessible from repositories in the lomadee organization`). O `quality.yml` já depende disso. A action `.github/actions/quality-gate` também.
2. Depois do merge, em Actions de `lomadee-workflows`, desabilite o workflow **Org quality**. Isso impede que um PR neste repositório execute a cópia do arquivo vinda do branch. O ruleset continua usando a cópia de `main` nos outros repositórios. Não inclua `lomadee-workflows` na lista de repositórios do ruleset.
3. Organização → Settings → Repository → Rulesets → New branch ruleset (ou um ruleset só deste gate, separado do `quality-gate`).
4. Enforcement: **Evaluate** (o check roda e não bloqueia). Se o menu só tiver Active e Disabled, deixe Disabled até o piloto ficar verde, e só então mude para Active.
5. Target repositories: um repositório piloto que já tenha `lint` e/ou `typecheck` e que **não** chame o `quality.yml`.
6. Target branches: inclua `main` e `lomadee-prod`. Não use "all branches".
7. Branch protections → **Require workflows to pass before merging** → repositório `lomadee/lomadee-workflows`, branch `main`, caminho `.github/workflows/org-quality.yml`. Opcional: "Do not require workflow checks on creation".
8. Abra ou atualize um PR no piloto. O check `Org quality / Org lint and typecheck` precisa ficar verde, e o summary precisa dizer que o lint ou o typecheck vai executar. Verde com notice de skip não é lint.
9. Passe o ruleset para **Active** nesse piloto. Inclua repositórios em lotes. Repositório sem `package.json` ou sem os scripts fica verde de propósito, até alguém adicionar o script.
10. Pacotes `@lomadee/*`: ou libere Actions no pacote para os repositórios do lote, ou garanta o segredo de organização `GH_TOKEN` (`read:packages` apenas) visível a esses repositórios.

Um PR que já estava aberto quando o ruleset foi criado não dispara o workflow sozinho. É preciso um commit novo, um update do branch, ou fechar e reabrir o PR.

O contrato normativo está na §11 de [`AGENTS.md`](./AGENTS.md) (WF-CI-03).

## Adotar o `AGENTS.md`

Não há herança automática de arquivo. No serviço, crie um `AGENTS.md` curto que:

1. Aponte para `https://github.com/lomadee/lomadee-workflows/blob/main/AGENTS.md`.
2. Diga que, em conflito, vale a regra mais restritiva.
3. Acrescente só o que é local: a branch que dispara o deploy e a seção **Regras de negócio**, com cada regra marcada como Confirmado, Inferido ou TODO.

O arquivo local não pede teste, não enfraquece o CI e não autoriza agente a editar `.github`, migração, segredo ou dinheiro. O detalhe está na §0 e na §7 do padrão.
