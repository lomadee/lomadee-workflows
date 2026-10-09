# AGENTS.md — Padrão de engenharia Lomadee

Padrão compartilhado pelos repositórios de serviço. A fonte é este arquivo, em `lomadee/lomadee-workflows`. Não há inclusão automática: o `AGENTS.md` de cada serviço aponta para cá e acrescenta só o que é local (branch de deploy, mapa do código e a seção de regras de negócio). Em conflito, vale a regra **mais restritiva**. O arquivo local não afrouxa CI, segurança, dinheiro nem esta lista.

Público: agentes de IA e pessoas. Se algo aqui contradizer o código atual, o código atual é dívida técnica, não exemplo. Não replique o padrão antigo e não refatore fora do escopo do PR (ver §8).

Exemplos citados de `open-api` e `dashboard-api` vêm da leitura de código de 08/10/2026. Esta revisão (09/10/2026) não teve acesso a esses repositórios; o que foi reaberto está marcado no texto. O que este repositório faz de fato foi conferido nos workflows de deploy.

## 0. Como este documento é usado

- Todo PR aberto por agente cita, na descrição, quais seções deste arquivo e do `AGENTS.md` do serviço foram consideradas.
- O serviço não copia este texto inteiro. O `AGENTS.md` local começa com o link para `https://github.com/lomadee/lomadee-workflows/blob/main/AGENTS.md` e declara a herança.
- Repositório de workflows (este) não tem regra de produto. As regras operacionais daqui estão na §2, com ID `WF-*`.

## 1. Modelo de segurança do auto-fix

Decisão de engenharia: o CI não é rede de teste. A rede de segurança do auto-fix é monitoramento pós-deploy e rollback.

| Camada | Decisão |
|---|---|
| CI | **Somente lint + typecheck.** Sem teste unitário e sem smoke test no CI (custo alto, valor baixo). |
| Rede de segurança | **Monitoramento pós-deploy no New Relic + rollback** da imagem anterior. |
| Consequência para o código | Tipos estritos, null-safety, erro explícito e telemetria são a barreira antes de produção. O watch precisa enxergar regressão em minutos. |

O que já existe neste repositório, conferido em `coolify-build-deploy.yml` e `coolify-build-deploy-dashboard.yml`:

- A imagem é publicada em `registry.digitalocean.com/lomadee/<app>:latest` e `registry.digitalocean.com/lomadee/<app>:<sha>`.
- O job dispara o deploy no Coolify. Não há job de rollback, nem de teste, nem de lint.
- Rollback, neste padrão, é redeploy da tag `:<sha>` anterior. O disparo automático desse rollback não mora aqui.

Regras derivadas:

1. Serviço que adotou `.github/workflows/quality.yml` passa no lint **sem** `--fix` e no typecheck (`script typecheck`, ou `tsc --noEmit` se o script não existir). Nada além disso entra nesse gate.
2. Não criar teste unitário, teste de CI nem smoke test para "cobrir" o auto-fix. A ausência de teste não bloqueia PR e não é defeito perante este padrão. Arquivo `*.spec.ts` que já exista não é apagado daqui e não é executado pelo `quality.yml`.
3. Todo PR de serviço é revertível sozinho: um deploy, um PR, um rollback limpo. Mudança que dependa de migração de banco no mesmo deploy não entra.
4. Todo PR de serviço diz qual sinal do New Relic mostra sucesso ou falha, e qual sha volta em caso de rollback.
5. Subir `max_warnings` para o CI ficar verde é proibido. O teto só desce (regra WF-CI-02).

## 2. Regras de negócio sempre explícitas

Regra de negócio nunca fica implícita num `if` solto, número mágico ou comentário vago.

1. **Constante nomeada**, com a unidade no nome: `SENT_COOLDOWN_SECONDS = 48 * 3600`, `LINK_GENERATION_MAX = 20`. Proibido `limit > 20` solto.
2. **Política como dado ou função pura**, em arquivo próprio `*.policy.ts` dentro de `application/`. Referência observada em 08/10/2026: `dashboard-api/src/modules/activation/application/activation-nudge.policy.ts` (`ACTIVATION_NUDGE_RULES` é tabela: passo, atraso, tolerância, template, elegibilidade).
3. **Comentário de regra** acima de cada regra, com ID estável:

   ```ts
   /**
    * Regra de negócio OA-SHORT-03: link do tipo Custom exige `url` https em domínio permitido.
    * Status: inferido do código (pendente confirmação de Produto).
    */
   ```

4. O `AGENTS.md` de cada serviço tem a seção **Regras de negócio**. Cada regra leva um destes status:
   - **Confirmado** — quem é dono do negócio (Produto, Financeiro ou Comercial) validou;
   - **Inferido** — o código faz isso hoje, e ninguém confirmou que é a regra desejada;
   - **TODO** — desconhecido; precisa de resposta humana.
5. Agente não muda regra Inferida ou TODO sem a confirmação no PR (link de issue ou decisão). Pode corrigir crash e null-safety **preservando o comportamento**.
6. Código de erro de regra de negócio é estável e documentado (§4.3).

### Regras deste repositório

| ID | Regra | Status |
|---|---|---|
| WF-CI-01 | O workflow reutilizável `quality.yml` executa somente lint sem `--fix` e typecheck. Não executa teste unitário nem smoke test. | Confirmado |
| WF-CI-02 | `max_warnings` trava a contagem atual de warnings. O valor só pode cair. Aumentar o teto para destravar o CI é proibido. | Confirmado |
| WF-REL-01 | Deploy publica `registry.digitalocean.com/lomadee/<app>:latest` e `:<sha>`. Rollback é o redeploy do sha anterior. | Confirmado (tags conferidas nos dois workflows de deploy; o job que dispara o rollback não está neste repositório) |

## 3. DRY e SOLID

Prioridade de implementação: DRY, SOLID, qualidade do código e escalabilidade. Código novo segue estes limites. Código legado só é reestruturado quando o PR é de refactor, para o diff não misturar preocupações (§8).

### 3.1 DRY

- Configuração de infraestrutura (Redis, TypeORM, HTTP) nasce **uma vez** numa factory em `src/config/*` e é reutilizada. Violação observada em 08/10/2026: `open-api/src/app.module.ts` montava a conexão Redis duas vezes (RedisModule e ThrottlerModule).
- SQL ou query repetida vira **uma função de query nomeada** no repositório. Exemplo observado: o subselect de `users_organization_service_roles` duplicado em `findAll` e `findById` do shortener.
- O `try/catch` que relança `HttpException` e embrulha o resto em `InternalServerErrorException` não se repete em todo método. Isso é trabalho do filtro global. Onde o filtro ainda não existe, o PR que introduz o filtro é que centraliza; até lá, não espalhe uma cópia nova.
- Antes de criar helper, procure em `@lomadee/nest`, `@lomadee/utils`, `@lomadee/definitions` e em `src/modules/shared` ou `src/common` do serviço. Esses nomes vêm da leitura de 08/10/2026, não de um índice refeito aqui. O SDK público visível hoje é `@thelomadee/sdk` (`lomadee-sdk`), publicado no npmjs.
- DRY não acopla domínios. Duas regras que parecem iguais e pertencem a negócios diferentes ficam separadas e nomeadas.

### 3.2 SOLID

| Princípio | Regra prática |
|---|---|
| **S** — responsabilidade única | Controller ou resolver: só HTTP/GraphQL (parse, guard, chamar serviço). Serviço de aplicação: um caso de uso. Repositório: só acesso a dados. Alvo de código novo: função ≤ 50 linhas, arquivo ≤ 300 linhas, complexidade ciclomática ≤ 10. Esses tetos viram erro de lint na fase 3 (§9.3), não são um convite a repartir arquivo legado dentro de um fix. |
| **O** — aberto/fechado | Variação por tipo (link, plataforma, provedor) via mapa de estratégias (`Record<Tipo, Handler>`), não `if/else` ou ternário aninhado. |
| **L** — substituição | Implementações de uma interface de domínio (ex.: `CampaignRunRepository` em memória e em Redis) cumprem o mesmo contrato, inclusive para `null` e erro. |
| **I** — segregação | Interfaces pequenas em `domain/interfaces.ts`. Não injete um serviço grande para usar um método. |
| **D** — inversão | Serviço depende de token e interface (`domain/tokens.ts` e `domain/interfaces.ts`), não de `DataSource` nem de schema Mongoose direto. |

### 3.3 Estrutura de módulo NestJS

Vale para backend NestJS. Não vale para frontend Next.js nem para este repositório de workflows.

```
src/modules/<feature>/
├── application/        # casos de uso, *.policy.ts, *.service.ts
├── domain/             # interfaces.ts, tokens.ts, types.ts, exceptions.ts
├── infrastructure/     # repositories/, adapters/
├── presentation/       # *.controller.ts, *.resolver.ts, dto/
├── schemas/            # *.graphql (schema-first)
└── <feature>.module.ts
```

## 4. Erros e null-safety

### 4.1 Null-safety

- Relação de ORM (`item.network`, `organization.network.channels`) pode ser `null` até prova em contrário. Acesso encadeado sem guarda é proibido.
- Caso observado no `open-api` em 08/10/2026: `TypeError: Cannot read properties of null (reading 'isPublic')` em `POST /affiliate/shortener/url`.

  ```ts
  // Ruim — affiliate-links.repository.ts (getLinksInfo), leitura de 08/10/2026
  operationBrands.filter((item) => !item.network.isPublic)
  ```

  ```ts
  // Correção que preserva o comportamento e deixa a regra explícita
  const privateNetworkIds = operationBrands
    .filter((item) => item.network != null && item.network.isPublic === false)
    .map((item) => item.networkId);
  // TODO: organização sem network é tratada como "não exige aprovação"?
  ```

- Sem `!` (non-null assertion) em código de produção, exceto `prop!:` em DTO ou entidade.
- Dado externo (Mongo `lean()`, payload de parceiro, query string) entra como `unknown` e só segue depois de validado (class-validator no DTO, ou type guard).
- Alvo de `tsconfig`: `noUncheckedIndexedAccess`. Com ele, `approvalsMap[id]` é `T | undefined`. O `lomadee-sdk`, conferido em 09/10/2026, já liga `strict` e `noUncheckedIndexedAccess`. Vários serviços ainda não (§9.4).

### 4.2 Lançamento e tratamento

- Erro esperado de negócio vira exceção de domínio com `code` (ex. observado: `AgentValidationException` em `dashboard-api`, `agent-api/domain/exceptions.ts`). Sem `throw new Error('string')` genérico.
- Erro inesperado propaga até o filtro global. Engolir erro é proibido (`catch { console.log(e) }`). Caso observado: `dashboard-api/src/main.ts` engolia falha de boot.
- Não devolva objeto meio-erro no lugar do dado (caso observado: `{ id, error: 'Error processing order data', rawData }` em `affiliate-orders.service.ts`).
- Chamada externa dentro de transação de banco é proibida. A transação abre só para a escrita local.

### 4.3 Contrato de erro

- REST, contrato alvo: `{ success: false, message: string, code: string }`. Era o formato do `HttpExceptionFilter` do `open-api` na leitura de 08/10/2026. Serviço que ainda não tem esse filtro não inventa um formato paralelo; adota este quando for alterar o tratamento de erro.
- GraphQL: payload unificado para erro esperado (`success`, `message`, `code`) e exceção para erro inesperado.
- `code` novo é **snake_case minúsculo** (`invalid_url`, `campaigns_request_failed`). Código já existente em maiúsculas (`TOO_MANY_REQUESTS`) permanece por compatibilidade com cliente. Não criar código novo nesse formato.
- Mensagem não expõe stack, SQL, host, ID interno de outro tenant nem segredo.

## 5. Logging e observabilidade

O watch pós-deploy no New Relic é metade da rede de segurança (§1). Não existe `newrelic-standard.md` neste repositório; o que segue é o contrato de código. Segredo do agente fica em variável de ambiente no Coolify, nunca no git. O workflow do dashboard já recebe `NEXT_PUBLIC_NEW_RELIC_*` como build-arg, o que confirma o uso no frontend.

1. Backend: agente New Relic carregado no start (`node -r newrelic dist/main`), só por variável de ambiente. Nome de aplicação: `lomadee-<app>-<env>`.
2. Logger estruturado JSON (pino é o alvo; `Logger` do Nest com contexto enquanto a migração não acontece). O agente Node encaminha log de pino e winston com `trace.id` e `span.id`. `console.log` não ganha esse contexto e é proibido fora de `scripts/`.
3. Campos padrão: `requestId`, `credentialId` ou `userId`, `organizationId` quando houver, `module`, `event`, e `code` em erro. Nunca logar API key, JWT, senha, cookie, CPF/CNPJ completo, e-mail completo, dado bancário ou payload de pagamento.
4. Atributo customizado de transação vai em interceptor (`newrelic.addCustomAttributes`), no padrão observado do `NewRelicAttributesInterceptor` do `open-api`. Não espalhar a chamada pelo código.
5. `newrelic.noticeError` só para erro inesperado (5xx). 4xx de validação não é erro de SRE.
6. Job, cron e consumer: `newrelic.startBackgroundTransaction(<nome>, <grupo>, fn)` e evento `CronRun` ou `JobRun` com `status`, `durationMs`, `itemsProcessed`. Sem isso o watch fica cego para worker.
7. GraphQL: `@newrelic/apollo-server-plugin`. Na leitura de 08/10/2026 o `open-api` usava e o `dashboard-api` não usava; erro GraphQL com HTTP 200 fica invisível no APM.
8. Health: `GET /health` barato, sem query pesada, ignorado no APM via `NEW_RELIC_IGNORING_RULES`.

## 6. Escalabilidade

| Tema | Regra |
|---|---|
| Async | Toda Promise é aguardada, ou explicitamente `void` com `.catch` logado (`no-floating-promises` em erro no alvo). Sem `bootstrap()` solto. Leitura independente corre em `Promise.all`. |
| Paginação | Listagem paginada, com limite padrão e máximo (padrão 100, constante nomeada). Ordenação determinística (`ORDER BY` mais desempate por id). Sem `SELECT *` ilimitado. |
| Banco | Só as colunas usadas. Mongo: `.lean()` e `.select()`. Índice conferido para filtro novo. Sem N+1 (`In(ids)` ou DataLoader). |
| Cache | Chave Redis em constante (`REDIS_KEYS`), TTL obrigatório, invalidação explícita na escrita. `INCR` + `EXPIRE` atômico (`MULTI` ou Lua). |
| Idempotência | Endpoint ou consumer com efeito (link, postback, e-mail, comissão, pagamento) tem chave de idempotência ou fingerprint determinístico. Exemplo observado: `buildCampaignFingerprint` no `dashboard-api`. |
| Timeouts | Chamada HTTP externa com timeout explícito (padrão 5 s; referência observada: `config/http.ts` do `open-api`). Retry só em operação idempotente, com backoff e limite. |
| Rate limit | Throttler por credencial (Redis) em API pública. Mudar limite é decisão de negócio, não auto-fix. |
| Filas | Consumer idempotente, com DLQ, e `ack` só depois do sucesso. |

## 7. O que agentes nunca tocam sem humano

PR que altere qualquer item abaixo não é elegível a auto-merge e deve ser marcado para revisão humana:

- **Migração e schema**: `**/migrations/**`, `**/*.sql`, `**/docs/migration*.md`, `scripts/migrate-*`, entidades em `@lomadee/definitions`, `supabase/migrations/**`.
- **Segredo e ambiente**: `.env*`, `.docker/.npmrc`, `.npmrc`, variável no Coolify, `newrelic.js` e config do agente.
- **CI, CD e infraestrutura nos serviços**: `.github/**`, `Dockerfile*`, `docker-compose*`, `nest-cli.json`, `tsconfig*.json`, `eslint.config.*`, `.eslintrc*`. Workflow reutilizável muda **neste** repositório, com revisão humana. Auto-fix em serviço não edita `.github` para enfraquecer ou contornar o gate.
- **Autenticação e autorização**: guard, decorator de escopo, JWT, API key, OAuth, throttling, CORS, helmet.
- **Dinheiro**: comissão, pagamento, saque, dado bancário, faturamento, conciliação, `@lomadee/affiliate-commission`.
- **Dependência**: adicionar, remover ou atualizar pacote em `package.json` ou no lockfile.
- **Código gerado**: `src/graphql.ts`.
- **Dado de terceiro e PII**: integração que grava segredo (`OrganizationIntegrationSecret`).

## 8. Regras de PR

1. **Uma preocupação só.** Um bug, uma regra ou um refactor. Meta: ≤ 200 linhas alteradas e ≤ 5 arquivos. Refactor oportunista é outro PR.
2. Título: `<tipo>(<módulo>): <resumo>`. Tipos: `fix`, `feat`, `refactor`, `chore`, `perf`, `obs`.
3. Descrição obrigatória:
   - **Problema** (issue do New Relic ou do bot de SRE, com `trace.id` se houver);
   - **Regra de negócio**: ID (ex.: `OA-SHORT-03`) e status (Confirmado, Inferido, TODO), ou "nenhuma" se for só técnico;
   - **Comportamento antes e depois**;
   - **Risco** (baixo, médio ou alto) e o motivo;
   - **Sinal pós-deploy** (NRQL ou métrica) e **critério de rollback**.
4. O template da organização em `lomadee/.github` ainda traz, como exemplo de checklist, "Testes adicionados/atualizados". Isso **não** é requisito. Não adicionar teste para marcar esse item.
5. Elegível a auto-merge somente quando o mecanismo existir no serviço **e** todas as condições abaixo forem verdade: CI verde (lint + typecheck), risco baixo, nenhum arquivo da §7, sem dependência nova, sem mudança de contrato público (rota, campo GraphQL, formato de erro), até 200 linhas. Este repositório não liga auto-merge.
6. Branch de destino: a branch que dispara o deploy do serviço, escrita no `AGENTS.md` local. Na leitura de 08/10/2026: `main` no `open-api`, `lomadee-prod` no `dashboard-api`. Confirme no workflow do serviço antes de abrir o PR.

## 9. Lint e TypeScript

O `quality.yml` roda o que o repositório já tem. Ele não aplica o config abaixo. O bloco é o **alvo da fase 3**. Adotar o workflow não exige chegar lá no mesmo PR. Mudança de `tsconfig`, ESLint ou dependência em serviço é humana (§7).

### 9.1 `tsconfig.json` (alvo)

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "incremental": true
  }
}
```

Script recomendado: `"typecheck": "tsc --noEmit -p tsconfig.json"`. Sem esse script, o `quality.yml` chama `tsc --noEmit` se `typescript` estiver instalado.

### 9.2 ESLint (alvo da fase 3)

Flat config, ESLint 9 e typescript-eslint 8. Dev dependencies do alvo, instaladas por humano: `typescript-eslint`, `@eslint/js`, `eslint-plugin-import-x`, `eslint-import-resolver-typescript`, `eslint-plugin-prettier`, `eslint-config-prettier`.

```js
// eslint.config.mjs
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import prettier from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
  { ignores: ['dist/**', 'src/graphql.ts', 'eslint.config.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked, // fase 3: strictTypeChecked
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  prettier,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    settings: { 'import-x/resolver': { typescript: true } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      complexity: ['error', 10],
      'max-depth': ['error', 3],
      'max-params': ['error', 4],
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'no-nested-ternary': 'error',
      'no-console': 'error',
      'import-x/no-cycle': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-self-import': 'error',
      'import-x/order': ['error', { 'newlines-between': 'always', alphabetize: { order: 'asc' } }],
      'no-restricted-imports': ['error', { patterns: ['@lomadee/*/dist/*', '**/node_modules/**', '../../../*'] }],
    },
  },
  // Arquivo de teste que já exista não pode derrubar o lint. Isso não cria suíte nem a coloca no CI.
  { files: ['**/*.spec.ts', 'test/**'], rules: { '@typescript-eslint/no-unsafe-assignment': 'off', 'max-lines-per-function': 'off' } },
  { files: ['scripts/**', 'src/scripts/**'], rules: { 'no-console': 'off' } },
);
```

Scripts:

- `"lint"`: verificação. Pode usar `--fix` no uso local. O CI remove `--fix` e recusa `--write`. Não crie um segundo script só para o CI.
- `"typecheck"`: o comando da §9.1.

### 9.3 Adoção em catraca

Sem big-bang.

1. **Fase 1.** Chamar `quality.yml` com as regras novas em `warn` e `max_warnings` igual à contagem de hoje. O número só pode cair (WF-CI-02).
2. **Fase 2.** `strict` e `noUncheckedIndexedAccess` por arquivo, com `typescript-strict-plugin` (`tsc-strict`). Arquivo tocado no PR entra no modo estrito. Arquivo legado leva `// @ts-strict-ignore` até ser corrigido de propósito.
3. **Fase 3.** Regras da §9.2 em `error`, `max_warnings` em `0`, preset `strictTypeChecked`.

### 9.4 Estado em 08/10/2026 e o que foi conferido depois

Colunas `open-api` e `dashboard-api`: leitura de 08/10/2026, não refeita aqui. A proposta é o alvo da §9, não o que o CI já exige hoje.

| Item | open-api (08/10/2026) | dashboard-api (08/10/2026, `lomadee-prod` e `refactory`) | Alvo |
|---|---|---|---|
| TypeScript | 5.x, `module nodenext`, target ES2023 | 5.x, `module NodeNext`, target ES2021 | manter a linha 5.x de cada repo |
| `strict` | ausente | ausente | `true`, pela catraca |
| `strictNullChecks` | `true` | `false` | `true` |
| `noImplicitAny` | `false` | `false` | `true` |
| `strictBindCallApply` | `false` | `false` | `true` |
| `noUncheckedIndexedAccess` | ausente | ausente | `true` |
| `noFallthroughCasesInSwitch` | `false` | `false` | `true` |
| `forceConsistentCasingInFileNames` | padrão | `false` | `true` |
| ESLint | 9 flat, `recommendedTypeChecked` + prettier | 8 legado (`.eslintrc.js`), recommended sem type-check + prettier | §9.2 na fase 3 |
| `no-floating-promises` | warn | inativa | error na fase 3 |
| `no-explicit-any` | off | off | error na fase 3 |
| `no-unsafe-*` | `no-unsafe-argument` warn; o resto do preset em error | inativas | error na fase 3 |
| Complexidade e tamanho | nenhuma regra | nenhuma regra de lint (só texto em `.cursor/rules/default.mdc`) | §9.2 na fase 3 |
| Import | nenhuma | nenhuma | `import-x` na fase 3 |
| `no-console` | nenhuma | nenhuma (24 arquivos com `console.*` naquela leitura) | error na fase 3 |
| Script `typecheck` | não existia | não existia (só `nest build`) | recomendado; o workflow aceita `tsc --noEmit` |
| Script `lint` | existia com `--fix` | existia com `--fix` | o CI executa o script sem `--fix` |
| Lint e typecheck no CI | não (o deploy só faz docker build) | não | opt-in via `quality.yml` |

Conferido em 09/10/2026 no `lomadee-sdk`: Yarn 1 (`yarn.lock` v1), TypeScript 5.9, `strict` e `noUncheckedIndexedAccess` já ligados, sem script `lint`, sem script `typecheck`, sem workflow de CI. Esse repositório **não** adota o `quality.yml` até um humano adicionar o script `lint`. O workflow não instala ESLint sozinho.

## 10. CI: `quality.yml`

Arquivo: `.github/workflows/quality.yml`. Disparo: só `workflow_call`. O exemplo de chamada está no [README](./README.md).

Contrato:

| Peça | Comportamento |
|---|---|
| Inputs | `node_version` (padrão `"22"`), `working_directory` (padrão `"."`), `max_warnings` (padrão `-1`, sem teto) |
| Segredo | `npm_token`, opcional. Necessário para instalar pacote privado `@lomadee/*` no GitHub Packages. O build Docker já usa o segredo `GH_TOKEN` como `NPM_TOKEN`. |
| Lockfile | `yarn.lock`, `pnpm-lock.yaml` ou `package-lock.json`, no `working_directory`. Mais de um lockfile só segue se `packageManager` desempata. |
| Install | Congelado: `npm ci`, `yarn install --frozen-lockfile` (Yarn 1) ou `yarn install --immutable` (Berry: `.yarnrc.yml` ou `packageManager` 2+), `pnpm install --frozen-lockfile`. |
| Node | `actions/setup-node` com cache do lockfile. A versão é o input. Não herda o input `node_version` de `coolify-build-deploy.yml`: esse input existe e **não é lido** pelo build. A imagem usa o Node do Dockerfile. |
| Lint | Script `lint` com `--fix` removido. `--write` restante falha o job. Se `max_warnings` ≥ 0, o teto é inserido em cada `eslint` ou `next lint` e substitui um `--max-warnings` já presente. Os dois no mesmo script, ou nenhum dos dois, falham quando o teto é pedido. |
| Typecheck | Script `typecheck` se existir. Sem o script: `yarn tsc --noEmit`, `pnpm exec tsc --noEmit` ou `tsc --noEmit`, conforme o lockfile. |
| Custo | Um job, sem matriz. Concurrency `quality-<repo>-<ref>-<diretório>` cancela a rodada superada. `timeout-minutes: 10`. |
| Fora do job | Teste unitário, smoke test, build de imagem, deploy, marcador de change tracking no New Relic. |

Os workflows `coolify-build-deploy.yml` e `coolify-build-deploy-dashboard.yml` não chamam este gate. Ligá-los é outro PR.

Pré-requisito de acesso: em Actions do `lomadee-workflows`, o workflow reutilizável precisa estar acessível aos repositórios da organização. Isso é configuração do GitHub, não deste arquivo.
