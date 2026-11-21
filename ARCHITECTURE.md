# Arquitetura do Vimob CRM

> Revisão estrutural: 2026-11-18. Base conferida: checkout `main`, commit
> `05ff562c4dc4824b7b17ea2fb6c7bda1628b01fb` (5.583 arquivos rastreados).
> Mapa de pastas, organização dos domínios, contratos, testes, CI e tamanho dos
> arquivos foram revistos nessa base. As contagens são um retrato desse commit;
> uma extração de arquivos pode alterá-las sem mudar o comportamento.
> A auditoria original de 2026-10-08 usou o commit
> `ef1cefca6faa59a78fd2aecbbecbf31ed1030c4b`. Suas medições operacionais,
> de segurança e de dependências não foram refeitas nesta revisão estrutural.
> A reconciliação das imagens de produção está registrada em
> [production-source-baseline-2026-11-18.md](docs/runbooks/production-source-baseline-2026-11-18.md).
> Este mapa não substitui uma conferência atual da stack, banco ou filas.
> "Comprovado" significa comprovado **no repositório**, não em produção.
> Este guia mistura três tipos de conteúdo, sempre marcados:
>
> - **[Estado]** o que o código faz hoje.
> - **[Regra]** o que todo código novo deve respeitar.
> - **[Meta]** onde queremos chegar; ainda não é verdade.
>
> Uma [Regra] pode orientar revisão manual antes de existir verificação
> automática. Só descreva uma falha de CI quando o gate correspondente estiver
> implementado no workflow; os gates planejados aparecem como **[Meta]**.

**Proveniência das leituras** (uma seção pode combinar fontes):

| Fonte | Seções afetadas | Limite |
|---|---|---|
| Revisão estrutural da base `05ff562c` | Mapa, domínios, contratos, testes, CI e tamanho dos arquivos | Inspeção estática; não executa os gates nem confere produção |
| Auditoria estática de 2026-10-08 (`ef1cefca`) | Medições históricas de dependências, autorização, configuração e filas | Não foi refeita integralmente em 18/11 |
| Releituras dirigidas registradas nas seções | 9 (filas), 16 e 22 (`/readyz`), 17 (dados pessoais) | Não demonstram execução em produção |
| Leitura de `docs/deploy-portainer.md` | 9 (WhatsApp), 11 e 15 (sequências de release) | Registro documental; não confirma cutovers ou flags ativos |
| Runbook da baseline de 18/11 | Revisões de API, Web e bridge observadas na reconciliação | Registro datado; não comprova estado futuro do ambiente |

**[Regra]** e **[Meta]** são decisões editoriais, não resultados da auditoria.

---

## 1. Princípios

1. **Separação por domínio.** Cada domínio tem dono, pasta e API pública. Mexer
   em um domínio não deve exigir editar outro.
2. **Segurança em camadas.** Identidade (Supabase Auth) → organização e papéis
   (API Go) → regra de negócio → banco. Nenhuma camada confia só na anterior.
3. **O servidor é a autoridade.** Permissão e organização são decididas na API
   e no banco. O browser só esconde botões.
4. **Tenant em tudo.** Toda query, chave de cache, evento, job e arquivo carrega
   `organization_id`.
5. **Mudança pequena, reversível, testada.** Um PR muda um domínio. Todo bug
   vira teste antes da correção.
6. **Falhar alto e cedo.** Configuração faltando derruba a inicialização; nunca
   cai em valor padrão silencioso.
7. **Prova, não suposição.** "Pronto" tem evidência (teste, métrica, log).
   Código verde não prova produção saudável.

---

## 2. Visão geral

```text
Browser (Next.js App Router)
  -> components/features/{dominio}
     -> hooks/{dominio}
        -> lib/api/{dominio}.ts
           -> API Go /v1
              -> middleware de autenticação + tenant
                 -> handler -> regra -> repositório
                    -> Postgres (Supabase), Storage, provedores externos

Paralelo:  Supabase Auth e Realtime (browser, capacidades que pertencem ao cliente)
           Workers de fundo (hoje dentro da API Go)
           Edge Functions (legado em retirada + webhooks)
```

Supabase Auth inicia a identidade. A API Go resolve usuário, organização,
papéis e permissões antes de qualquer regra de negócio. Segredos e service role
nunca chegam ao frontend.

**[Estado] Exceções conhecidas ao fluxo acima** (conferidas na base `05ff562c`):

- `lib/api/auth.ts` fala com o Supabase Auth (esperado).
- `lib/api/user-activity.ts` escreve direto no Data API do Supabase (depende de
  RLS; avaliar mover para a API Go).
- `app/api/` tem 12 Route Handlers: BFFs de onboarding, e-mail, CEP e fallback
  interno de ajuda. Por exemplo, o cadastro valida a requisição e a encaminha
  à API Go; a existência desses handlers não significa uma segunda API de
  negócio completa. Ver seção 6.

---

## 3. Mapa do repositório

```text
.github/workflows/      docker-images.yml e staging-images.yml
app/                    rotas Next.js
  (auth)/               login, cadastro, convite, onboarding, reset...
  (protected)/          admin, agenda, crm, dashboard, financeiro, pipeline,
                        properties, settings, ...
  (public-site)/        site público das imobiliárias
  api/                  Route Handlers (12)  <- ver seção 6
  checkout/, comprovantes/, help/, sites/
components/
  features/{dominio}/   33 pastas de domínio
  shared/               usado por 2+ domínios
  ui/                   primitivas shadcn/Radix
  providers/            RootProvider, QueryProvider...
contexts/AuthContext.tsx   autenticação e organização no browser
hooks/                  React Query, estado e efeitos; raiz e pastas por domínio
lib/
  api/                  transporte HTTP + normalização de erro
  validation/           contratos Zod por domínio e fachadas de compatibilidade
  supabase/             client.ts, server.ts, types.ts (fachada)
  auth/, access/, realtime/, billing/, security/, ...
integrations/supabase/types.ts   gerado pelo CLI (não editar à mão)
apps/
  api/{cmd,internal}    API Go (57 pacotes internos com código de produção)
  worker/               só README (reservado)
packages/
  auth/                 validação de JWT
  db/                   pool Postgres
  contracts/openapi/    contrato público v1 (parcial)
  config/               só README
supabase/
  migrations/           append-only
  functions/            82 Edge Functions (LIVE / TOMBSTONE / RETIRED)
  tests/                testes SQL
  cutovers/, reconciliation/, legacy-migrations/, drafts/, templates/
deploy/                 portainer-stack.yml, supabase-self-hosted, edge-retirement
scripts/                audits, c2s, load, local, maintenance, qa, security,
                        staging, supabase, tests
docs/                   audits, integrations, runbooks
tests/                  cenários E2E, fixtures e runners locais
config/                 configuração e constantes do frontend
i18n/                   traduções
services/               fachadas de notificações/gamificação sobre lib/api
public/                 assets estáticos
proxy.ts                proteção de rotas do Next (substitui middleware.ts)
```

O frontend Next.js fica na raiz; a API é um monólito modular em Go. Os módulos
de `go.work` são `apps/api`, `packages/auth` e `packages/db`. `apps/worker` e
`packages/config` contêm apenas README; os workers atuais são compostos pela
API, não por um segundo executável. O gerenciador declarado é `npm@11.13.0`,
com `package-lock.json` e `npm ci` nos dois workflows. Os arquivos pnpm
existentes não definem outro fluxo de instalação ativo.

Na base `05ff562c`, havia 102 módulos de código em `lib/api` e 61 em
`lib/validation`, incluindo os pontos públicos de exportação e excluindo testes
identificados. São contagens históricas; a extração descrita abaixo muda a
distribuição de arquivos de validação. Elas não medem endpoints,
responsabilidades isoladas nem cobertura de testes.

**[Regra]** Cada pasta de topo tem um README de uma página dizendo: o que mora
ali, quem pode importar dela, o que nunca entra. O guia anterior não reúne a
descrição de `config/`, `services/`, `i18n/` e `tests/`; há documentação dispersa
no repositório, inclusive em `tests/e2e/README.md`.

### Primeiro lote estrutural local de 18/11

O working tree deste lote separa responsabilidades mantendo as regras, o SQL
e as interfaces existentes:

- `lib/validation/auxiliary.ts` passou de 1.361 linhas para 146 como
  fachada de compatibilidade. Seus 113 exports e 151 declarações foram
  preservados, com os contratos distribuídos entre os módulos donos. O mapa
  desses contratos e a regra de imports ficam em
  [lib/validation/README.md](lib/validation/README.md).
- A leitura de leads foi extraída para `repository_read.go` (222 linhas), e
  os scanners/conversores, para `repository_scan.go` (296 linhas), dentro do
  mesmo pacote `leads`. Assinaturas e SQL permanecem os mesmos. As
  responsabilidades e o contrato de ordem das colunas estão em
  [apps/api/internal/leads/README.md](apps/api/internal/leads/README.md).

O escopo, as verificações pertinentes e a reversão do conjunto ficam no
[runbook deste lote](docs/runbooks/architecture-refactor-2026-11-18.md).
O preparo de publicação inclui o patch Next 16.4.6 e o par de imagens API/Web;
seus limites e rollback estão no
[plano de release](docs/runbooks/architecture-release-2026-11-18.md).
Esta descrição registra a organização local e não declara resultado de teste,
build ou publicação. `leads/repository.go` continua acima de 800 linhas, e os
demais controladores e repositórios grandes ainda aguardam seus próprios
recortes. As tabelas de tamanho abaixo continuam sendo o retrato da baseline.

---

## 4. Domínios e donos

Domínios de negócio (nomes de referência; manter consistência nas camadas que
existirem):

| Domínio | Escopo |
|---|---|
| `leads` | cadastro de lead, detalhe, histórico, tarefas, anexos, timeline |
| `pipelines` | Kanban, estágios, configuração de funil, SLA |
| `distribution` | round-robin, regras de distribuição, redistribuição |
| `whatsapp` | sessões, conversas, mensagens, mídia, atendimento, outbox, inbox |
| `dashboard` | KPIs e gráficos (somente leitura de outros domínios via API) |
| `properties` | imóveis, empreendimentos, publicações, portais |
| `schedule` | agenda, eventos, Google Calendar |
| `automations` | fluxos, cadências, execuções |
| `ai` | agentes, regras de roteamento, auto-resposta de IA |
| `financial` | lançamentos, contratos, comissões, DRE |
| `integrations` | Meta, portais, Imoview, Vista, webhooks, chaves de API |
| `site` | site público e analytics do site |
| `settings` / `teams` / `users` | organização, papéis, permissões, equipes |
| `admin` | operação da plataforma (super admin) |
| `billing` | assinatura, checkout, Asaas |
| `notifications` / `attention` | notificações e itens de atenção |
| `gamification` | missões, ranking |

**[Estado] Organização das camadas na base `05ff562c`:**

- Existem 33 pastas em `components/features/` e 23 subpastas com hooks de
  código, incluindo `admin`, `automations`, `leads`, `properties` e `whatsapp`.
- A organização dos hooks ainda é mista: aproximadamente 160 arquivos de
  código na raiz convivem com os hooks por domínio. Ao tocar um fluxo, localizar
  todos os seus consumidores antes de mover o arquivo ou alterar seus exports.
- `chat`, `crm-management` e `pwa`, por exemplo, compõem capacidades de outros
  domínios; não precisam ganhar backend ou camada de dados só para repetir o
  mesmo nome em todas as pastas.
- Os nomes não são sempre literais: `round-robin` no frontend corresponde a
  `roundrobin` no Go; o histórico de leads também possui `hooks/lead-history`.

**[Regra]** Ao criar ou renomear domínio, usar nome consistente nas camadas que
tenham responsabilidade real (`components/features/X`, `hooks/X`, `lib/api/X.ts`,
`lib/validation/X.ts`, `apps/api/internal/X`). Não criar arquivo ou pasta vazia
apenas para completar o diagrama. Exceção documentada: `round-robin` (front) ↔
`roundrobin` (Go).

**[Meta]** Arquivo `docs/domains.md` com uma linha por domínio: dono, pastas,
tabelas principais, workers, rotas, o que ele pode consumir. Ele é a fonte para
a regra de fronteira da seção 5.

---

## 5. Regras de dependência

### 5.1 Frontend

**[Regra]**

1. Um domínio importa de outro **somente** por um ponto público documentado
   (`index.ts` quando houver consumidores reais) ou por `lib/api/`; não criar
   barrel sem uso apenas para cumprir o diagrama.
2. `components/shared/` não importa de `features/`.
3. `components/ui/` não importa de nada do produto.
4. `app/` só compõe; não contém regra de negócio nem acesso a dados (ver 6).
5. `dashboard` consome dados de outros domínios por `lib/api`, nunca por
   componente deles.

**[Registro de 08/10, não recontado nesta revisão]** 85 imports cruzados no front em 43 arquivos
(70 `features → features`, 15 `features → hooks` de outro domínio). Casos mais
centrais:

| De | Para | Observação |
|---|---|---|
| `chat/FloatingChat` | `whatsapp` (9 itens) | chat flutuante depende de internos do WhatsApp |
| `whatsapp/ConversationLeadPanel` | leads, properties, schedule | WhatsApp conhece 3 domínios |
| `leads/LeadUnifiedThread` | `whatsapp` | lead depende de WhatsApp |
| `pipelines/StageSettingsDialog` | automations, cadences | |
| `integrations/MetaFormConfigDialog` | properties, distribution | |
| `automations/NodeConfigPanel`, `leads/CreateLeadDialog` | properties | |

Esses exemplos indicam acoplamentos a revisar ao alterar os fluxos envolvidos;
a tabela não é um inventário atualizado de todos os imports.

### 5.2 API Go

**[Regra]**

1. Pacotes `internal/{dominio}` não importam o interior de outro domínio.
   Dependência entre domínios passa por **interface pequena** definida em quem
   consome.
2. Pacotes de infraestrutura compartilhada (`httpserver`, `tenant`, `pgvalue`,
   `jsonvalue`, `phonenumber`, `searchtext`, `numericinput`, `config`,
   `supabasehttp`, `authorization`, `permissions`) podem ser importados por todos.
3. `distribution` é serviço compartilhado: pode ser consumido por `leads`,
   `meta`, `portals`, `webhooks` pela sua API pública.

**[Registro de 08/10, não recontado nesta revisão]** 15 imports de produção entre pacotes de negócio:

| Consumidor | Importa |
|---|---|
| `whatsapp` (`ai_worker`, `auto_reply`) | `ai` |
| `leads`, `meta`, `portals`, `webhooks` | `distribution` |
| `publicapi` | `webhooks` |
| `publications` | `grupoolx` |
| `developments` | `properties` |

Esta tabela resume dependências existentes; ainda não é uma allowlist executada
pela CI. Novos imports entre domínios exigem revisão manual até existir o gate
da seção 5.3.

### 5.3 Enforcement

**[Estado]** Não existe regra geral de fronteira na CI (sem `eslint-plugin-boundaries`,
`dependency-cruiser`, `depguard` ou `go-arch-lint`). Há verificações pontuais,
como `lib/access/api-boundary.test.ts` e os contratos de funções Edge
aposentadas; elas não formam uma regra geral de imports entre os domínios.

**[Meta]** Criar um **baseline exato por arquivo/pacote** das violações atuais e
automatizar na CI a rejeição de novas violações. Reduzir o baseline
gradualmente, sem exigir a refatoração de todos os domínios de uma vez.

---

## 6. Frontend

- `app/`: composição de rotas, layouts, boundaries e redirects.
  **[Estado]** `app/api/` tem 12 Route Handlers de BFF, callbacks e suporte
  (`email/send`, `onboarding/signup` com rate limit, `properties/cep`, ajuda
  interna). **[Regra]** Route Handlers são exceção documentada
  e devem ser finos. Lógica de negócio nova vai para a API Go. Cada handler
  define seu acesso: autenticação, credencial/assinatura ou exceção pública
  documentada com validação e limite de uso. Registrar o dono no domínio e,
  quando existir, em `docs/domains.md`.
- `proxy.ts` (raiz) protege rotas. Não existe `middleware.ts`.
- `components/features/{dominio}`: UI do domínio. `components/shared`: usado por
  dois ou mais domínios. `components/ui`: primitivas.
- `hooks/`: React Query, estado e efeitos. **[Regra]** hook não acessa o banco
  direto; chama `lib/api`.
- `lib/api/`: transporte HTTP e normalização de erro.
- `lib/validation/`: Zod por domínio.
- `contexts/AuthContext.tsx`: autenticação e organização no browser.
- **Não existe Zustand.** Estado de UI fica local ou no contexto proprietário.
- Componentes de cliente só quando precisam de hooks, eventos ou APIs do
  browser. Layouts e páginas são Server Components por padrão.

**[Estado] Providers (correção do guia anterior).** `RootProvider` é montado em
`app/layout.tsx` para **todas** as rotas e inclui `AuthProviderWrapper`, que
registra listener de autenticação. O grupo protegido adiciona QueryProvider,
filtros e chat flutuante. Portanto rotas públicas **não** estão livres de Auth.
Se a meta é rota pública sem listener, isso é trabalho a fazer.

**[Estado] Acesso direto ao Data API** em `lib/api/user-activity.ts`. Avaliar
migração para a API Go (a presença grava no banco pelo navegador e depende de RLS).

**[Regra] Normas de componente**

- Arquivo novo: alvo ≤ 400 linhas, limite duro 800. Acima disso divide por
  responsabilidade (tela / lista / diálogo / hook / modelo).
- Nada de componente definido dentro de componente (causa flicker; já ocorreu em
  `SharedFilters`).
- Filtros compartilhados entre telas ficam em estado explícito, não duplicados.
- Texto de UI em `i18n/`.

---

## 7. Organização ativa e multi-tenant

`lib/auth/active-organization.ts` define o contrato:

- `resolving`: autenticação, memberships ou troca em andamento;
- `ready`: `organizationId` estável e autorizado;
- `missing`: sem tenant utilizável ou falha de carregamento.

**[Regra]**

1. Query, mutation, Realtime e cache key só usam o ID em `ready`; query
   multi-tenant fica desabilitada fora de `ready`.
2. A chave de cache **inclui** `organizationId` literalmente.
3. Durante login, impersonação ou troca, nunca reaproveitar ID antigo.
4. Handler Go: toda rota autenticada passa pelo middleware de tenant; rota
   sem ele é exceção documentada.
5. Todo job carrega `organization_id` no registro e filtra por ele.
6. Edge Function ou worker global (sem organização) é declarado como tal.

**[Registro de 08/10 para os levantamentos abaixo, não refeito em 18/11]**

- `QueryProvider` recria o `QueryClient` quando muda a organização (proteção
  existente).
- Sete chaves de React Query não trazem a organização literal (`use-lead-history`,
  `use-lead-meta`, 2 em `use-sla-reports`, `use-whatsapp-groups`, 2 em
  `use-whatsapp-labels`). Não é vazamento comprovado, mas viola a regra 2.
- Realtime: handler Go exige tenant; replay filtra organização e usuário;
  tópicos do WhatsApp incluem organização e têm política SQL.
- Das 579 rotas Go, 40 não passam pelo wrapper de tenant/auth na mesma linha:
  health (2), auto-reply interno (1), ajuda pública (2), aceite de convite (1),
  webhooks Evolution (2), 29 públicas, push-config público (1), troca de senha
  pré-tenant (1), 1 falso positivo. Cada uma deve ter o motivo registrado em
  `docs/security.md`.
- Edge Functions: 45 dos 82 entrypoints não mencionam organização diretamente
  (wrappers, globais, tombstones). Isolamento fim a fim **não verificado**.

**[Estado em 18/11]** Há testes com PostgreSQL descartável na CI para convites,
remoção/reentrada de membros, revogação de papéis e cenários de privacidade
(seção 13). Isso cobre fluxos específicos, não todo o isolamento do produto.
**[Meta]** Ampliar os cenários de duas organizações para as demais fronteiras;
testes de integração fora desses jobs ainda podem pular sem sua URL de teste.

---

## 8. API Go

- `apps/api/internal/app/app.go`: dependências e ciclo de vida.
- `apps/api/internal/app/routes.go`: composição das rotas e middleware; conferir
  o código ao alterar contratos, pois a medição histórica de 579 operações não
  foi refeita nesta revisão.
- Pacote por domínio: handlers, regras e repositório.
- Infraestrutura compartilhada: `tenant`, `httpserver` (envelopes, erros,
  decoder), `pgvalue`, `jsonvalue`, `config`, `authorization`, `permissions`.
  `pgvalue` centraliza as políticas de vazio, branco e trim para valores pgx;
  `jsonvalue` preserva a política legada de payload JSON vazio onde necessária.

**[Regra]**

1. Camadas dentro do pacote: `handler → serviço/regra → repositório`.
   Handler não tem SQL. Repositório não decide permissão.
2. Um **único** tipo `Envelope` em `httpserver`. **[Estado]** hoje há 21
   definições no Go e 30 no front; consolidar.
3. Pool de conexões é recurso escasso: jobs e rotas disputam o mesmo pool
   (limite por processo; confirmar o efeito com 2 réplicas).
4. Toda mudança de rota atualiza o contrato (seção 10).
5. No SuperAdmin, `/v1/admin/tables/{table}` mantém inventário de leitura.
   Escrita genérica fica limitada a planos, comunicados e artigos de ajuda;
   exclusão genérica, a planos e artigos. As demais tabelas do inventário não
   admitem mutação genérica; mudanças previstas usam seus fluxos de domínio.

**[Estado] Exemplos de arquivos grandes no Go na base `05ff562c` (não teste)**

| Arquivo | Linhas |
|---|---:|
| `leads/repository.go` | ~5.600 |
| `whatsapp/webhook_native_processor.go` | ~5.700 |
| `meta/repository.go` | ~3.700 |
| `whatsapp/media_queue.go` | ~2.850 |
| `settings/repository.go` | ~2.360 |
| `whatsapp/repository.go` | ~2.610 |

**[Regra]** Repositório com mais de ~1.500 linhas divide por agregado
(`leads/repository_board.go`, `repository_history.go`, ...). Os `types.go`
grandes (`roundrobin`, `leads`, `whatsapp`, `developments`, `automations`,
`properties`, todos acima de 1.000 linhas) dividem por assunto.

---

## 9. Workers e filas

**[Estado]** 22 chamadas de inicialização de trabalhos de fundo estão registradas na API
(`apps/api/internal/app/app.go`); `apps/worker/` é só um README. O gate global
`API_BACKGROUND_WORKERS_ENABLED` tem padrão ligado. Quantos rodam em produção:
**não verificado**.

| Trabalho | Intervalo | Coordenação |
|---|---:|---|
| Realtime (tail/prune) | 100 ms–1 s / 1 h | cursor durável |
| Asaas billing | 5 min | lease 10 min |
| Atenção | 30 s | advisory lock |
| Gamificação | 5 s | `SKIP LOCKED`, lease 5 min |
| Redistribuição de leads | 30 s | runtime de filas em até 10 lotes/10 s, transações próprias, advisory lock separado do legado |
| Notificações (padrão desligado) | 15 s | `SKIP LOCKED`, lease 2 min |
| Limpeza de assets de imóveis | 30 s | `SKIP LOCKED` |
| Publicações | 2 s | lease 2 min |
| Expiração de reservas | 1 min | `SKIP LOCKED` |
| Automações (runtime / inatividade) | 30 s / 5 min | advisory lock |
| Inatividade simples de etapa (padrão desligado) | 30 s; ciclo 45 s | scan por política; `SKIP LOCKED` e dedupe por episódio |
| WhatsApp IA e follow-up | 1 / 10 min | `SKIP LOCKED` |
| WhatsApp outbox | 1 s | lease/fence, heartbeat |
| WhatsApp webhook inbox | 1 s | `SKIP LOCKED`, owner |
| WhatsApp mídia (padrão desligado) | 2 s | lease 5 min |
| WhatsApp avatar | 2 s | lease 3 min |
| Supervisor de sessões | 1 min | leader lock |
| Webhooks de saída | 2 s | lease 90 s |
| Meta webhook | 15 s | lease 5 min |
| Meta conversion feedback | 5 s | `SKIP LOCKED` |
| Grupo OLX import report | 2 s | `SKIP LOCKED`, advisory por integração |

**[Regra] Contrato de um worker** (todo worker novo e, aos poucos, os atuais)

1. **Idempotente**: reexecutar não duplica efeito.
2. **Coordenado entre réplicas**: lease, `SKIP LOCKED` ou advisory lock.
3. **Com timeout** no ciclo inteiro, não só em partes.
4. **Panic recuperado** e registrado; panic de worker nunca derruba a API.
5. **Retentável com limite** e com **destino de falha** (dead letter) monitorado.
6. **Desliga com espera**: o deploy espera o ciclo atual terminar.
7. **Observável**: métrica de fila (pendentes, mais antiga, mortos) e de ciclo.
8. Carrega `organization_id` quando o dado é de tenant.
9. Registrado no teste de inventário.

**[Estado] Lacunas comprovadas**

- Redistribuição de leads recupera panic, limita seus ciclos e preserva lotes
  confirmados quando outro item falha. Os demais starters precisam de revisão
  específica; a proteção desse worker não demonstra a dos outros.
- Vários trabalhos têm timeout só em partes do ciclo (marcados NV na auditoria).
- `background_worker_contract_test.go` confere 21 nomes, incluindo inatividade simples, e **omite**
  `StartAvatarWorker`; não impede registrar worker extra fora da lista.

**[Estado] WhatsApp no código examinado**

- Inbox: `live`/`backlog`, época ativa, ordem por rota e barreira de sessão.
  Não há FIFO global; outbox de texto/mídia sem ordem global de entrega.
  Retry, capacidade e flags: `docs/runbooks/whatsapp-inbox.md`.
  Flags e comportamento ativos em produção: **não verificados**.

**[Meta] Separar worker da API** (`apps/worker`), sem trocar o comportamento:

1. Teste de inventário que detecta inicializações fora da lista e confere todos
   os trabalhos existentes; não assumir uma contagem fixa de starters.
2. Recuperação de panic e timeout total em cada starter.
3. Ciclo de vida com espera no desligamento.
4. Executável `apps/worker` inativo, mesma imagem de código.
5. Mover uma fila por vez, começando pelas simples (gamificação, expiração de
   reservas, limpeza).
6. WhatsApp por último.

---

## 10. Contratos e tipos

- Contrato público: `packages/contracts/openapi/v1.yaml`.
- **[Estado na base `05ff562c`]** O YAML declara **232 paths e 301 operações
  HTTP** e se identifica como contrato parcial. Não é o inventário completo
  do router. A porcentagem histórica de 37% não é uma medição atual; calcular
  cobertura exige comparar métodos e caminhos do código e do YAML na mesma
  revisão. O catálogo `docs/catalogo-contratos-backend.md` também é um registro
  datado, não a fonte do contrato.
- Tipos HTTP do front são em parte escritos à mão (`lib/api/leads.ts`,
  `lib/api/whatsapp.ts`); a geração de tipos a partir do OpenAPI ainda é
  próximo passo.
- `integrations/supabase/types.ts` (gerado) cobre **o banco**, não a API HTTP.

**[Regra]**

1. Rota nova entra no OpenAPI no mesmo PR. A CI compara os métodos e caminhos
   com o roteador Go. O [registro de paridade](packages/contracts/openapi/router-parity-baseline.json)
   identifica a cobertura histórica e as operações privadas.
2. Tipos do front de rota nova vêm do contrato ou de Zod, nunca duplicados à
   mão.
3. Resposta de erro e envelope são únicos.

**[Meta]** Cobertura de todas as rotas novas e expansão do legado por domínio.
Antes de priorizar um grupo, comparar o router e o contrato atuais; os totais
por domínio levantados em outubro não foram recontados nesta revisão.

---

## 11. Supabase e banco

- `lib/supabase/client.ts`: singleton do browser (proteção read-only local e
  recuperação de senha).
- `lib/supabase/server.ts`: cliente por request.
- `integrations/supabase/types.ts`: única saída gerada pelo CLI;
  `lib/supabase/types.ts` é a fachada.
- `supabase/migrations/`: cadeia append-only, verificada por
  `scripts/supabase/verify-migrations.mjs` contra o lock de origem
  `supabase/migrations.source-lock.json`.
- `supabase/functions/`: 82 funções com estado `LIVE`, `TOMBSTONE` ou `RETIRED`
  no manifesto; o roteador self-hosted falha fechado para slug não declarado.

**[Regra]**

1. Migração aplicada **não se edita**. Mudança vai em arquivo novo.
2. Toda migração diz como voltar (ou por que é irreversível) no cabeçalho.
3. **Compatibilidade de release**: a ordem entre banco, API, Web, Edge Functions
   e workers é definida no runbook de cada mudança, conforme as dependências e
   as versões que coexistem durante a troca de réplicas. Schema aditivo exigido
   pela API nova entra antes dela; restrições ou cortes que dependem de novos
   consumidores entram depois da convergência deles. Verificar o estado real do
   banco e os pré-requisitos antes de executar SQL.
4. Migração pesada define `lock_timeout` e roda fora do horário de pico.
5. Tabela nova de tenant: coluna `organization_id` e índice correspondente. Em
   esquema exposto à Data API, habilitar RLS, políticas de isolamento por
   organização e grants mínimos para `anon`/`authenticated`. Para uso exclusivo
   da API Go, preferir esquema não exposto; se a tabela ficar em esquema exposto,
   manter RLS e revogar os grants de cliente. A API também valida o tenant;
   credencial privilegiada fica somente no servidor e não substitui RLS de
   tabela exposta.
6. Função nova que usa tabela de lookup em RLS leva índice (já houve queda por
   Disk IO esgotado).
7. Edge Function nova só com justificativa; o padrão é a API Go.

---

## 12. Testes

**[Estado na base `05ff562c`] (arquivos, não casos nem cobertura)**

- 664 arquivos identificados como testes em `app`, `components`, `hooks`, `lib`
  e `contexts`; 939 arquivos `_test.go` em `apps/api`.
- Domínios de `features/` **sem teste co-localizado**: attention, auth,
  crm-management, help, marketing, news, notifications, onboarding, presence,
  public e site. Isso não prova ausência de testes em outra pasta.
- Pacotes Go sem teste co-localizado: `me`, `telemetry`, `whatsappbinding`.
- Existem E2E (Playwright) e testes SQL. A CI executa cenários focados de
  navegador, PostgreSQL e pgTAP, conforme a seção 13; a suíte geral
  `npm run test:e2e` e toda a pasta `supabase/tests` não são gates gerais.
- Testes Go de integração com banco podem pular quando falta a URL exigida;
  os jobs dedicados fornecem URLs para seus cenários específicos.

**[Regra]**

- Bug corrigido = teste que falha antes e passa depois.
- Regra de autorização e de tenant: teste de **duas organizações** (A não vê B).
- Worker: teste de idempotência e de falha com retry.
- Mudança em contrato: teste de contrato.
- Teste que "pula" na CI é aviso, não sucesso (contar e exibir pulados).

**[Meta]** Pirâmide: muitos testes unitários e de repositório, testes de
integração com Postgres isolado na CI, poucos E2E nos fluxos críticos (login,
criar lead, distribuição, enviar WhatsApp, troca de organização, checkout).

---

## 13. CI e gates de release

**[Estado na base `05ff562c`]** Existem dois workflows:

- `docker-images.yml`: atende push/PR da `main` e execução manual. Os gates
  estáticos executam `npm ci`, audit de dependências, `audit:check`, validação,
  testes de contrato, typecheck, ESLint, verificadores de migrations/Edge e
  `go test ./apps/api/... ./packages/auth/... ./packages/db/...`.
- Esse workflow também tem jobs de PostgreSQL descartável para convites e
  acesso de membros. O job `whatsapp-contracts` instala PostgreSQL 17, pgTAP e
  Chromium e executa testes focados de formulários, permissões, filas e mobile.
  A publicação de API e Web depende desses quatro gates e não ocorre em PR.
- `staging-images.yml`: execução manual, restrita à branch `homologacao` em
  repositório privado e às variáveis próprias de staging. Não é acionado por um
  push da `main`.

Os workflows geram/publicam imagens; não contêm etapa de atualização da stack.
Verificar o arquivo do workflow e a execução correspondente antes de declarar
um gate aprovado.

Os dois workflows executam a comparação de métodos e caminhos do roteador Go
com o OpenAPI e os testes do verificador. A comparação usa a cobertura
existente como base para detectar desvios novos.

**[Estado] Fora dos gates gerais:** suíte completa `npm run test:e2e`, todos os
testes SQL do repositório, todos os cenários Go que exigem banco, lint geral de
fronteira e lint Go dedicado. Os jobs isolados verificam cenários específicos.

**[Meta] Gates adicionais, em ordem**

1. Lint de fronteira com baseline congelado (seção 5).
2. Ampliar os jobs isolados já existentes para os testes de integração e SQL
   ainda fora da CI.
3. Lint Go (`golangci-lint`) com configuração versionada.
4. Limite de tamanho de arquivo com allowlist dos existentes.
5. E2E dos fluxos críticos em ambiente isolado.
6. Validação de variáveis de ambiente obrigatórias (ver 14).

Esses gates provam o estado do código. Deploy, migração remota, dados reais,
integrações externas e capacidade continuam sendo evidências separadas.

---

## 14. Ambientes e configuração

**[Registro de 08/10 para as contagens e lacunas abaixo, não refeito em 18/11]**

- Há `.env.example` **só na raiz** (141 chaves na medição original). Não há `.env.example` por app.
- Front lê 18 nomes diretos; API Go, 132; scripts, 53 (sobrepostos).
- `config/env.ts` declara as variáveis públicas obrigatórias, mas **nenhum
  import dele foi encontrado**; não valida nada de fato hoje.
- **Fallback silencioso:** a URL da API cai em `http://localhost:8081` no front
  (`lib/api/vimob-client.ts`, `vimob-server-url.ts`) e na API Go
  (`config.go`).
- Parsers de configuração da API retornam o padrão quando o valor é vazio ou
  inválido em várias flags e durações.
- **20 variáveis lidas pelo Go não estão no `.env.example`**; a presença delas
  em outros documentos não foi verificada de forma exaustiva:

```text
API_IDLE_TIMEOUT, API_READ_HEADER_TIMEOUT, API_READ_TIMEOUT, API_WRITE_TIMEOUT,
AUTOMATION_INACTIVITY_WORKER_INTERVAL, AUTOMATION_RUNTIME_WORKER_INTERVAL,
AUTOMATION_WORKER_LOCK_TIMEOUT, AUTOMATION_WORKER_RUN_TIMEOUT,
DATABASE_FORCE_READ_ONLY, FCM_SERVER_KEY, FINANCIAL_ORGANIZATION_IDS,
FIREBASE_PROJECT_ID, FIREBASE_SERVER_KEY, FIREBASE_SERVICE_ACCOUNT_JSON,
GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_CLOUD_PROJECT, INTERNAL_WEBHOOK_TOKEN,
SUPABASE_URL, VAPID_PRIVATE_KEY, WEB_PUSH_PRIVATE_KEY
```

**[Regra]**

1. Variável obrigatória faltando **impede a inicialização** (front no build, API
   no start). Proibido fallback para `localhost` em ambiente de produção.
2. Toda variável nova entra no `.env.example` da raiz enquanto não houver um
   por app, com nome, tipo, obrigatoriedade, padrão e consumidor documentados
   no PR ou neste guia. **[Meta]** Mover o catálogo para `.env.example` por app
   e `docs/configuration.md` quando esses arquivos existirem.
3. Credencial de infraestrutura nunca em log, URL, telemetria nem armazenamento
   do navegador. Tokens de fluxo e dados pessoais seguem a seção 17.
4. Script com efeito colateral exige confirmação explícita e verificação de host.
   **[Estado]** os scripts de carga com escrita e de limpeza já fazem isso; um
   script de leitura (`api-read-smoke.mjs`) tem a URL de produção como padrão.
   **[Regra]** nenhum script usa produção como padrão.

**Ambientes.** Local (documentado no README, com script que desliga workers e
integrações), E2E isolado (bloqueia hosts de produção conhecidos),
produção (`deploy/portainer-stack.yml`). **Staging permanente: não
comprovado.** **[Meta]** staging com cópia dos dados anonimizada, mesma imagem
e mesmas migrações que a produção.

---

## 15. Release e rollback

**[Regra]**

1. **Ordem**: cada release documenta sua sequência, pré-requisitos, estados
   intermediários aceitos, canário e ponto de abortar. O preparo de índices do
   WhatsApp exige banco antes da API; o corte das credenciais em URL exige API
   e convergência das sessões antes do SQL (`docs/deploy-portainer.md`).
2. Imagens por SHA (já no GHCR); registrar tags e digests em uso **antes** de
   alterar a stack e manter o par Web/API anterior compatível para reversão.
3. Todo release tem: lista de migrações, funções Edge, flags, plano de reversão
   e quem faz.
4. Mudança de comportamento grande entra **atrás de flag**, desligada, e é
   ligada por organização piloto.
5. Reversão escrita em `docs/runbooks/`; `whatsapp-inbox.md` descreve o contrato
   da fila e não substitui o roteiro de release e rollback do WhatsApp.
6. Pacotes grandes são divididos (um release por assunto), como no plano do
   WhatsApp.

---

## 16. Observabilidade e capacidade (meta de 5 mil usuários)

**[Estado]** Não foi comprovada no repositório uma configuração de Prometheus,
Grafana ou alertas; a existência deles em produção não foi verificada. `/readyz`
retorna 503 quando o banco falha e 200 quando o banco responde; estatísticas de
workers aparecem no payload, mas filas e supervisor não alteram esse status.
Os scripts de carga versionados não certificam a meta de 5 mil usuários;
testes externos ou históricos não foram verificados.

**[Regra] O que medir**

- API: latência p50/p95/p99 e taxa de erro por rota e por organização.
- Filas: pendentes, idade do mais antigo, mortos, tentativas, por fila.
- Banco: conexões (usadas, ociosas em transação), consultas lentas, IO, tamanho
  das tabelas grandes (inbox e mensagens do WhatsApp).
- WhatsApp: sessões conectadas/desconectadas, tempo de envio e recebimento.
- `/readyz` reflete dependências necessárias para atender requisições. Para
  filas e workers, definir criticidade por configuração e alertas próprios;
  worker opcional desligado não torna a API inteira indisponível.

**[Regra] Capacidade**

- Consulta periódica no front (15–90 s por usuário) multiplica com usuários
  simultâneos: tem orçamento e passa por Realtime quando possível.
- Listas e endpoints com conjuntos crescentes exigem paginação, limite ou
  orçamento explícito de resposta.
- Tabela que cresce sem fim tem **política de retenção** escrita.
- Pool de conexões dimensionado por réplica, com jobs contando.

**[Meta]** Teste de carga com perfil de uso real (rotas de leitura + escrita de
lead + WhatsApp) em staging, com critério de aprovação numérico antes de janeiro.

---

## 17. Segurança e dados pessoais

**[Estado] Exceções e lacunas no código do commit `ef1cefca`** (sem leitura da
produção):

- Convite, checkout e comprovantes usam token no caminho da URL. As páginas
  declaram `noindex` e `no-referrer`; isso não comprova que logs e telemetria
  nunca recebam o token.
- O checkout guarda temporariamente perfil e rascunho de cobrança (nome,
  contato, CPF/CNPJ e endereço) em `sessionStorage`; o cadastro guarda dados de
  retomada, incluindo e-mail, token de checkout e, quando fornecida, capability
  de recuperação.
  A validade é conferida na leitura, não há exclusão automática comprovada no
  instante do prazo. Os tipos revisados não incluem dados de cartão.
- `app/error.tsx` passa URL, caminho e query string atuais para
  `reportErrorEvent`; `lib/auth/telemetry-location.ts` mascara o token no
  caminho de convite e filtra a query, mas não mascara os caminhos de checkout
  e comprovantes. Há um caminho de código que pode levar esses tokens à
  telemetria; envio ou exposição em produção **não verificados**.
- O Financeiro é habilitado por `FINANCIAL_ORGANIZATION_IDS` ou pelo fallback
  do nome normalizado `vetter co` no servidor; o front repete esse gate. As
  operações também verificam papel/permissão no servidor.

**[Regra]** (sem enforcement geral)

1. Dados pessoais, tokens e credenciais não entram em logs nem telemetria.
   Novos links com token exigem finalidade, validade, escopo e proteções de
   indexação, referrer e redaction documentados; não incluir telefone, e-mail
   ou documento no caminho ou na query. As exceções atuais seguem inventariadas
   até uma substituição compatível.
2. Novo uso de `sessionStorage` para dados pessoais ou capabilities exige
   justificativa, escopo, validade e limpeza definidos. Preservar os fluxos
   atuais até haver substituição testada.
3. Habilitação de módulo por ID ou configuração auditável da organização;
   ações autorizadas por papel/permissão verificados no servidor. Não retirar
   o fallback atual do Financeiro antes de configurar e testar seu substituto.
4. Rota pública tem limite de uso e motivo registrado.
5. Segredos em variável de ambiente de stack hoje; **[Meta]** Docker secrets e
   rotação periódica com data registrada.
6. Endpoint público sem login tem finalidade, dados expostos, validação e limite
   de uso definidos. Webhook ou integração entre servidores exige assinatura,
   segredo ou outra credencial apropriada.
7. Trilha de auditoria: leitura restrita a quem tem permissão; ação gravada pelo
   servidor, não declarada pelo cliente.

**[Estado local em 2026-10-09; não implantado]** `GET /v1/audit-logs` exige
sessão ativa e papel de proprietário, administrador ou SuperAdmin. O `POST`
genérico responde `410` e não grava eventos; clientes `anon` e `authenticated`
não recebem acesso direto a `public.audit_logs` após a migration local
`20261009054807_restrict_audit_logs_to_server.sql`. Os eventos emitidos pelos
fluxos do servidor e pelos gatilhos do banco continuam separados desse POST.
Tentativas de login, logout, recuperação e impersonação antes enviadas pelo
navegador deixam de alimentar essa trilha; sua futura substituição deve usar
eventos verificados no servidor. O `source='app'` histórico não comprova que
um evento antigo foi criado pelo servidor.
O feed Realtime de auditoria passa a enviar só o ID da organização como sinal
de atualização e confere a sessão ao entrar no canal; uma conexão já aberta
mantém o cache de autorização do Realtime até renovar ou expirar o JWT.
Os históricos de lead, equipe e distribuição que consultam essa tabela também
exigem sessão ativa na API Go, mantendo seus filtros e permissões próprios.
8. `docs/security.md` descreve: modelo de tenant, papéis, rotas públicas e
   motivo, política de logs.

**[Meta]** Substituir o fallback do Financeiro por habilitação explícita sem
bloquear a organização atual; uniformizar a redaction das rotas com token;
reduzir os dados em URLs e `sessionStorage` sem interromper convite, cadastro,
checkout ou comprovantes.

---

## 18. Dívida técnica e limites de tamanho

**[Estado na base `05ff562c`]** Arquivos acima de 400 / 800 / 1.500 linhas:
364 / 147 / 48 no recorte de TS/JS/Go sem testes identificados, declarações
`.d.ts` e o arquivo gerado `integrations/supabase/types.ts`. O total inclui
scripts e funções Edge legadas, não apenas runtime publicado. Dentro desse
recorte: API Go não teste 139/70/24; `components` 130/42/13. Contagem de linhas
e nomes de testes não mede acoplamento, cobertura ou desempenho.

**[Regra]** Arquivo novo ≤ 400 linhas (alvo) e ≤ 800 (limite). Crescimento de
arquivo legado acima de 800 linhas exige justificativa e plano de divisão.
**[Meta]** Registrar esses arquivos em baseline e impedir crescimento sem
justificativa por um gate futuro da CI.

**Exemplos para divisão por responsabilidade (tamanhos aproximados na baseline):**

| Arquivo | Linhas |
|---|---:|
| `components/features/leads/LeadDetailDialog.tsx` | 2.400 |
| `components/features/auth/screens/CheckoutScreen.tsx` | 2.150 |
| `components/features/chat/FloatingChat.tsx` | 2.700 |
| `components/features/pipelines/PipelinesScreen.tsx` | 2.100 |
| `components/features/properties/PropertyFormScreen.tsx` | 2.000 |
| `hooks/use-whatsapp-conversations.ts` | 2.150 |

**Arquivos de validação que misturam assuntos:** `lib/validation/auxiliary.ts`
(auditoria, anexos, pagamento, imóveis, site, Realtime), `final-domains.ts`
(admin, IA, gamificação, dashboard), `schemas.ts` (auth, planos, leads, Meta).
**[Regra]** um arquivo de validação por domínio.

**Método de divisão (sem redesign):** testes antes → extrair sem mudar
comportamento → um PR por extração → barrel só exporta consumidor real → código
morto removido em lote pequeno depois de confirmar o grafo de imports.

**Duplicações a consolidar:** 30 `Envelope<T>` no front e 21 `Envelope[T]` no Go
(variantes com `meta` e com `data` opcional); DTOs de sessão, acesso, conversa e
mensagem do WhatsApp escritos em `lib/api/whatsapp.ts` e nos hooks.

---

## 19. Documentação e arquivos essenciais

**[Estado]** Não existem: `CONTRIBUTING.md`, `CODEOWNERS`, template de PR,
`docs/adr/`, `docs/security.md`, `LICENSE`, `.editorconfig`, `Makefile`/`justfile`,
Compose local do app, configuração dedicada de lint Go, `.env.example` por app.
Existem scripts equivalentes em `package.json` e `scripts/local/start-local.ps1`,
além de runbooks em `docs/runbooks/`, README, QUICK_REFERENCE, INDEX e AGENTS.

**Divergências ainda pendentes em outros documentos**

| Onde | Problema |
|---|---|
| README | `lib/api` descrito só como cliente Go; há Supabase Auth e escrita direta em `user-activity` |
| README | Completude do catálogo de variáveis exige recontagem; a medição de 20 ausências é histórica |
| Catálogo de contratos | Inventário datado; não representa automaticamente o router ou o OpenAPI atuais |

**Arquivos a criar (ordem)**

1. `docs/domains.md` (seção 4).
2. `.env.example` por app + `docs/configuration.md`.
3. `docs/adr/` com os primeiros registros (por que API Go, por que sem Zustand,
   por que migrações append-only, por que workers na API por ora).
4. `CODEOWNERS` e template de PR (seção 20).
5. `CONTRIBUTING.md`.
6. `docs/security.md` e `docs/observability.md`.
7. `docs/runbooks/`: backup e restauração, rollback, WhatsApp parado, fila
   morta, rotação de segredos.
8. `.editorconfig` e `.golangci.yml`.
9. Um `Makefile` ou `justfile` com `dev`, `test`, `lint`, `verify`.

---

## 20. Checklist de pull request

- [ ] Muda **um** domínio (ou explica por que mais de um).
- [ ] Imports novos entre domínios revisados e justificados manualmente; o gate
      automático de fronteira ainda é meta (seção 5.3).
- [ ] Teste novo cobrindo a mudança; bug corrigido tem teste que falhava antes.
- [ ] Regra de tenant/autorização com teste de duas organizações quando aplicável.
- [ ] Rota nova ou alterada está no OpenAPI.
- [ ] Migração nova: arquivo novo, plano de volta e compatibilidade verificados;
      `lock_timeout` definido quando a operação puder segurar locks relevantes.
- [ ] Tabela nova de tenant: exposição à Data API, grants, RLS e isolamento entre
      duas organizações revisados conforme a seção 11.
- [ ] Variável nova no `.env.example` e em `docs/configuration.md` quando existir;
      até lá, contrato documentado no PR ou neste guia.
- [ ] Worker novo respeita o contrato da seção 9 e entra no inventário.
- [ ] Dados pessoais e tokens fora de logs e telemetria; novos links por token
      seguem as condições da seção 17 e as exceções existentes foram revisadas.
- [ ] Arquivo novo respeita o limite da seção 18; crescimento de legado grande
      foi justificado e tem plano de divisão.
- [ ] Plano de reversão escrito.
- [ ] Documentação atualizada se a mudança altera estrutura, rota, variável ou
      fluxo.

---

## 21. Regras para agentes de IA (Codex e outros)

O `AGENTS.md` operacionaliza estas regras e acrescenta cuidados de segurança e
entrega. Elas existem porque uma correção pontual pode afetar fluxos vizinhos.

1. **Antes de editar:** identificar o domínio no código e neste guia; quando
   `docs/domains.md` existir, consultá-lo também. Editar fora do domínio só
   com justificativa explícita no resumo.
2. **Escopo mínimo.** Sem refatoração, renomeação ou formatação fora do pedido.
3. **Nunca editar** migração já aplicada nem `integrations/supabase/types.ts`
   (gerado). Justificar crescimento de arquivo legado acima de 800 linhas e
   registrar plano de divisão (seção 18).
4. **Em bug**, obter reprodução segura ou evidência concreta; criar teste de
   regressão quando o comportamento e o risco o justificarem, corrigir e
   verificar o resultado.
5. **Em mudança de código**, rodar `typecheck`, `lint` e testes pertinentes ao
   domínio tocado; relatar resultados, falhas preexistentes e testes pulados.
   Edição apenas documental não exige a suíte de código inteira.
6. **Não rodar** script com efeito colateral, migração, limpeza ou carga contra
   host remoto sem autorização da tarefa e verificação do alvo.
7. **Nunca** usar produção como alvo padrão; nunca imprimir segredos.
8. **Fronteiras:** dependência entre domínios só pela API pública; se parecer
   precisar de import interno, propor a interface. Até existir o gate da seção
   5.3, conferir novos imports manualmente.
9. **Tenant:** toda query, chave de cache, job e evento de tenant leva
   `organization_id`. Se o navegador acessa a Data API, revisar grants e RLS;
   o middleware da API Go não protege esse caminho direto.
10. **Relatório final** sempre separa "comprovado no repositório", "comprovado em
    produção" e "não verificado". Estado de produção não se afirma sem leitura
    da produção.
11. **Mudança grande** em pacote pequeno e reversível, atrás de flag, com plano de
    reversão.
12. Se a tarefa exige mexer em dois domínios críticos (pipeline, WhatsApp,
    distribuição, dashboard, financeiro ou autorização), justificar a
    dependência, testar os dois lados e planejar reversão. Dividir quando as
    mudanças forem separáveis; não deixar uma correção integrada pela metade.

---

## 22. Critérios de prontidão para a meta (5 mil usuários)

Cada item tem um estado. Só "provado" conta.

| Critério | Estado |
|---|---|
| Backup externo completo com restauração testada e tempo medido | não provado |
| Staging permanente com mesma versão da produção | não comprovado |
| Teste de carga com perfil real e critério numérico | não comprovado no repositório |
| Alertas (fila, banco, erro, sessão WhatsApp) | não verificados em produção |
| `/readyz` reflete fila e supervisor | não; verifica banco e retorna 503 se o ping falhar |
| Panic de worker não derruba a API | sem recover local nos starters; efeito em produção não verificado |
| Worker separado da API | não (README apenas) |
| Contrato OpenAPI | 37% das rotas |
| Lint de fronteira na CI | não |
| E2E, testes SQL e integração com banco na CI | não |
| Política de retenção das tabelas grandes | parcial (WhatsApp em definição) |
| Rotação confirmada de segredos | não comprovado |
| Pool de conexões dimensionado com jobs e réplicas | não verificado |

---

## 23. Ordem de adoção até janeiro

1. **Resiliência (primeiro):** backup restaurável, definir quais filas são
   críticas para readiness e criar alertas próprios, recover de panic nos
   workers.
2. **Proteção do que existe (baratas e de alto retorno):** `docs/domains.md`,
   lint de fronteira com baseline, `.env.example` por app e
   validação de configuração, remover fallback para `localhost`.
3. **Prova:** Postgres de teste na CI, testes SQL e de integração, teste de
   isolamento entre organizações, comparação router × OpenAPI.
4. **Escala:** staging, teste de carga, política de retenção, orçamento de consultas
   periódicas, pool de conexões.
5. **Estrutura:** dividir `PipelinesScreen` (piloto), depois Dashboard, chat e
   detalhe do lead; separar o worker da API passo a passo.
6. **Documentação viva:** ADRs, runbooks, CONTRIBUTING, CODEOWNERS.

O que se faz primeiro depende de risco, não de elegância: item 1 antes de
estrutura, porque estrutura limpa não restaura um banco perdido.

---

## 24. O que este guia não comprova

- Estado de produção: workers ativos, réplicas, Portainer, backup, alertas.
- Ler `docs/deploy-portainer.md` e outros runbooks versionados não comprova
  flags, cutovers, migrações, imagens ou comportamento ativos em produção.
- Resultado de testes e migrações (nada foi executado na auditoria).
- Isolamento completo das 82 Edge Functions e de todos os jobs.
- Variáveis montadas dinamicamente em runtime.
- Comportamento real após panic de worker e timeouts integrais.

Atualize este arquivo no mesmo PR de qualquer mudança que altere estrutura,
rota, variável de ambiente, fila ou regra de dependência.
