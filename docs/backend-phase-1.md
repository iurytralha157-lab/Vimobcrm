# Backend Fase 1

## Decisao

O Vimob CRM passa a ter um backend proprio em Go. O Supabase continua como Auth e Postgres gerenciado, mas o frontend deve caminhar para falar apenas com a Vimob API.

## Estrutura criada

```txt
apps/
  api/        backend Go
  worker/     workers futuros

packages/
  auth/       validacao server-side do Supabase Auth
  db/         pool Postgres com pgx
  contracts/  contratos futuros da API
  config/     configuracoes compartilhadas futuras
```

## Frontend

O frontend usa `NEXT_PUBLIC_VIMOB_API_URL` para falar com a Vimob API.

```txt
NEXT_PUBLIC_VIMOB_API_URL=http://localhost:8081
```

`lib/api/vimob-client.ts` pega a sessao atual pelo Supabase Auth e envia `Authorization: Bearer <access_token>` para a API.

## Endpoints da API

```txt
GET /healthz
GET /readyz
GET /v1/me
GET /v1/dashboard/stats
GET /v1/dashboard/funnel
GET /v1/dashboard/sources
GET /v1/dashboard/top-brokers
GET /v1/dashboard/upcoming-tasks
GET /v1/dashboard/deals-evolution
GET /v1/leads
GET /v1/leads/{id}
POST /v1/leads
PATCH /v1/leads/{id}
DELETE /v1/leads/{id}
POST /v1/leads/{id}/move-stage
POST /v1/leads/{id}/assign
POST /v1/leads/{id}/redistribute
POST /v1/leads/{id}/tags
DELETE /v1/leads/{id}/tags/{tagId}
GET /v1/lead-enrichments
GET /v1/pipeline-board
GET /v1/pipeline-stage-leads
GET /v1/pipeline-stage-counts
GET /v1/lead-meta-filters
GET /v1/properties
GET /v1/properties/{id}
POST /v1/properties
PATCH /v1/properties/{id}
DELETE /v1/properties/{id}
POST /v1/property-images
GET /v1/property-captors/{id}
GET /v1/property-site-info
GET /v1/property-summaries
GET /v1/user-summaries
GET /v1/property-types
POST /v1/property-types
GET /v1/property-features
POST /v1/property-features
POST /v1/property-features/seed-defaults
GET /v1/property-proximities
POST /v1/property-proximities
POST /v1/property-proximities/seed-defaults
GET /v1/property-cities
POST /v1/property-cities
DELETE /v1/property-cities/{id}
GET /v1/property-neighborhoods
POST /v1/property-neighborhoods
DELETE /v1/property-neighborhoods/{id}
GET /v1/property-condominiums
POST /v1/property-condominiums
DELETE /v1/property-condominiums/{id}
GET /v1/pipelines
POST /v1/pipelines
PATCH /v1/pipelines/{id}
DELETE /v1/pipelines/{id}
GET /v1/stages
POST /v1/pipelines/{id}/stages
POST /v1/pipelines/{id}/stages/reorder
PATCH /v1/stages/{id}
DELETE /v1/stages/{id}
POST /v1/pipelines/{id}/round-robin
GET /v1/round-robins
POST /v1/round-robins
PATCH /v1/round-robins/{id}
DELETE /v1/round-robins/{id}
GET /v1/round-robins/{id}/rules
POST /v1/round-robins/{id}/rules
GET /v1/round-robin-rules
PATCH /v1/round-robin-rules/{id}
DELETE /v1/round-robin-rules/{id}
POST /v1/round-robins/{id}/members
PATCH /v1/round-robin-members/{id}
DELETE /v1/round-robin-members/{id}
```

`/v1/me` exige:

```txt
Authorization: Bearer <supabase_access_token>
```

Quando o usuario participa de mais de uma organizacao, envie:

```txt
X-Organization-ID: <organization_id>
```

## Comandos

```bash
npm run api:dev
npm run api:fmt
npm run api:test
```

## Variaveis principais

```txt
SUPABASE_PROJECT_URL=
SUPABASE_JWKS_URL=
SUPABASE_JWT_ISSUER=
SUPABASE_JWT_AUDIENCE=authenticated
SUPABASE_JWT_SECRET=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
```

Preferir validacao por JWKS/asymmetric keys. `SUPABASE_JWT_SECRET` existe apenas como compatibilidade para projeto legado e nunca deve ir para o browser.

## Regras

- Browser nao acessa tabelas de dominio direto.
- API valida JWT antes de qualquer rota privada.
- Fase 1 resolve user -> membership -> organization -> role -> permission em `apps/api/internal/tenant`.
- Query de dominio sempre deve carregar `organization_id`.
- Leads usa `apps/api/internal/leads` e contrato em `packages/contracts/openapi/v1.yaml`.
- O pacote `packages/db` usa `pgx.QueryExecModeSimpleProtocol` para operar com o pooler Supabase/PgBouncer em modo transacional sem conflitos de prepared statements.
- Frontend ja usa a Vimob API para leitura de leads via `useLeads` e `useLead`.
- Criacao de lead tambem passa pela Vimob API via `useCreateLead`.
- Criacao de lead registra `audit_logs`, `activities`, tags, notificacoes in-app e vinculos WhatsApp na mesma transacao.
- Reentrada por telefone e registrada no backend, preservando o responsavel atual do lead.
- Atualizacao de lead passa pela Vimob API via `useUpdateLead`, com validacao de referencias, permissoes por escopo e auditoria no backend.
- Mudanca de deal status usa `PATCH /v1/leads/{id}` e registra atividades de status/venda no backend.
- Delete de lead passa pela Vimob API via `useDeleteLead`, com permissao `lead_delete`/admin e auditoria no backend.
- Adicionar/remover tags passa pela Vimob API via `useAddLeadTag`/`useRemoveLeadTag`, com validacao de escopo e atividades no backend.
- Movimento de funil passa por `POST /v1/leads/{id}/move-stage`, preservando a permissao do RPC legado e registrando auditoria/atividade quando muda de etapa.
- Transferencia manual de responsavel passa por `POST /v1/leads/{id}/assign`, registrando `assignments_log`.
- Distribuicao round-robin passa por `POST /v1/leads/{id}/redistribute`, registrando `assignments_log` e `round_robin_logs`.
- Board do funil passa por `GET /v1/pipeline-board`, `GET /v1/pipeline-stage-leads`, `GET /v1/pipeline-stage-counts`, `GET /v1/lead-enrichments` e `GET /v1/lead-meta-filters`, concentrando filtros, visibilidade, tags, tarefas e meta ads no backend.
- CRUD de imoveis passa pela Vimob API em `apps/api/internal/properties`, com filtro paginado, validacao de campos gravaveis, escopo por organizacao, permissao de criacao/edicao/delete, geracao transacional de `code`, registro de activity de captacao e limpeza server-side de imoveis demo da organizacao ao criar um imovel real.
- Frontend usa `lib/api/properties.ts` e `hooks/use-properties.ts` para listagem, busca, cadastro, edicao e exclusao de imoveis.
- Upload de imagens de imoveis passa por `POST /v1/property-images`; o frontend usa `lib/api/property-images.ts` e o backend envia para o bucket `properties` do Supabase Storage com credencial server-side.
- Dados auxiliares de preview/picker/funil/analytics de imoveis (`property-captors`, `property-site-info` e `property-summaries`) passam pela Vimob API via `lib/api/property-support.ts`.
- Resumos de usuarios usados no funil passam por `GET /v1/user-summaries`, filtrados pela organizacao ativa.
- Catalogos auxiliares de imoveis (`property_types`, `property_feature_catalog`, `property_proximity_catalog`) passam pela Vimob API via `lib/api/property-catalog.ts`, `use-property-types`, `use-property-features` e `use-property-proximities`.
- Localidades de imoveis (`property_cities`, `property_neighborhoods`, `property_condominiums`) passam pela Vimob API via `lib/api/property-locations.ts` e `use-property-locations`.
- CRUD de pipelines e colunas passa pela Vimob API em `apps/api/internal/pipelines`, com validacao de permissao, organizacao e bloqueio de delete quando existem leads.
- Gerenciamento de filas round-robin passa pela Vimob API em `apps/api/internal/roundrobin`; o backend adapta o schema real atual usando `round_robins.pipeline_id`, `round_robins.rules` JSONB e `round_robin_rules.conditions` JSONB.
- Frontend usa `lib/api/pipelines.ts`, `lib/api/round-robins.ts`, `use-stages`, `use-round-robins`, `use-create-queue-advanced`, `use-round-robin-rules` e `use-pipeline-round-robin` para esses fluxos.
- Dashboard principal passa pela Vimob API via `lib/api/dashboard.ts` e `use-dashboard-stats`, concentrando KPIs, funil, fontes, ranking, tarefas e evolucao temporal no backend.
- Integracoes externas devem ir para worker/fila, nao para request HTTP longo.

## Verificacao local

Nesta maquina, a verificacao foi feita com runtime Go portatil em `%TEMP%`.

```bash
go work sync
go mod tidy
npm run api:fmt
npm run api:test
```

Os arquivos `go.sum` dos modulos Go devem ser commitados junto com a API.
