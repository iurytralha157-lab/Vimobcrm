# Vimob API

Backend principal do Vimob CRM.

## Responsabilidade

- Validar o JWT emitido pelo Supabase Auth.
- Resolver usuario, organizacao, papel e permissao antes de qualquer acao de dominio.
- Acessar o Supabase Postgres por conexao direta/pooler, nunca pelo client browser.
- Usar simple protocol no `pgx` para compatibilidade com o pooler Supabase/PgBouncer em modo transacional.
- Padronizar erros, logs, CORS, health checks e readiness checks.

## Endpoints iniciais

- `GET /healthz` - processo da API esta vivo.
- `GET /readyz` - API consegue falar com o Postgres.
- `GET /v1/me` - rota protegida que valida `Authorization: Bearer <supabase_access_token>`.
  Pode receber `X-Organization-ID` para escolher a organizacao ativa.
- `GET /v1/dashboard/stats` - calcula KPIs do dashboard com filtros e visibilidade de leads no backend.
- `GET /v1/dashboard/funnel` - agrega leads visiveis por coluna do funil para o dashboard.
- `GET /v1/dashboard/sources` - agrega leads visiveis por origem para o dashboard.
- `GET /v1/dashboard/top-brokers` - lista ranking de corretores com fallback quando nao ha vendas fechadas.
- `GET /v1/dashboard/upcoming-tasks` - lista proximas tarefas abertas dos leads visiveis.
- `GET /v1/dashboard/deals-evolution` - entrega serie temporal de ganhos, perdas e abertos.
- `GET /v1/leads` - lista leads visiveis no contexto atual.
- `GET /v1/leads/{id}` - busca um lead visivel no contexto atual.
- `POST /v1/leads` - cria lead ou registra reentrada com validacao de organizacao, destino, tags, notificacoes, auditoria e vinculo WhatsApp.
- `PATCH /v1/leads/{id}` - atualiza lead com validacao de escopo, referencias e auditoria.
- `DELETE /v1/leads/{id}` - exclui lead com permissao de delete e auditoria.
- `POST /v1/leads/{id}/move-stage` - move lead no funil com permissao compatível com o RPC legado, auditoria e atividade de mudanca de etapa.
- `POST /v1/leads/{id}/assign` - transfere ou limpa responsavel do lead, registrando `assignments_log`.
- `POST /v1/leads/{id}/redistribute` - atribui lead via round-robin ativo, registrando `assignments_log` e `round_robin_logs`.
- `POST /v1/leads/{id}/tags` - adiciona tag ao lead com validacao de escopo e atividade.
- `DELETE /v1/leads/{id}/tags/{tagId}` - remove tag do lead com validacao de escopo e atividade.
- `GET /v1/lead-enrichments?ids=...` - busca tags, tarefas, meta ads, usuario e imovel resumidos para cards visiveis.
- `GET /v1/pipeline-board` - carrega colunas, leads visiveis, filtros e contagens do funil pelo backend.
- `GET /v1/pipeline-stage-leads` - pagina leads de uma coluna do funil.
- `GET /v1/pipeline-stage-counts` - conta leads por coluna usando os mesmos filtros do funil.
- `GET /v1/lead-meta-filters` - lista campanhas/conjuntos/anuncios disponiveis para filtros.
- `GET /v1/properties` - lista imoveis da organizacao com paginacao, busca e filtros comerciais.
- `GET /v1/properties/{id}` - busca um imovel visivel no contexto atual.
- `POST /v1/properties` - cria imovel com validacao, geracao transacional de codigo, activity de captacao e limpeza de imoveis demo da organizacao.
- `PATCH /v1/properties/{id}` - atualiza imovel, regenerando codigo quando o tipo muda.
- `DELETE /v1/properties/{id}` - exclui imovel com permissao de delete.
- `POST /v1/property-images` - envia imagens de imoveis para o Supabase Storage pelo backend, com validacao de tipo/tamanho e escopo de organizacao.
- `GET /v1/property-captors/{id}` - busca dados minimos do captador no escopo da organizacao.
- `GET /v1/property-site-info` - busca dominio/subdominio ativo da organizacao para links de imoveis.
- `GET /v1/property-summaries?ids=...` - busca resumos de imoveis por id para funil e analytics.
- `GET /v1/user-summaries?ids=...` - busca resumos minimos de usuarios visiveis na organizacao.
- `GET|POST /v1/property-types` - lista e cria tipos de imovel da organizacao.
- `GET|POST /v1/property-features` e `POST /v1/property-features/seed-defaults` - lista/cria/seed de caracteristicas.
- `GET|POST /v1/property-proximities` e `POST /v1/property-proximities/seed-defaults` - lista/cria/seed de proximidades.
- `GET|POST|DELETE /v1/property-cities` - lista, cria e remove cidades da organizacao.
- `GET|POST|DELETE /v1/property-neighborhoods` - lista, cria e remove bairros por organizacao/cidade.
- `GET|POST|DELETE /v1/property-condominiums` - lista, cria e remove condominios por organizacao/bairro.
- `GET /v1/pipelines` / `POST /v1/pipelines` - lista e cria pipelines da organizacao, criando colunas padrao no backend.
- `PATCH /v1/pipelines/{id}` / `DELETE /v1/pipelines/{id}` - edita ou remove pipeline sem leads vinculados.
- `GET /v1/stages` - lista colunas, opcionalmente por `pipelineId`.
- `POST /v1/pipelines/{id}/stages` - cria coluna na pipeline.
- `POST /v1/pipelines/{id}/stages/reorder` - reordena/renomeia colunas em transacao.
- `PATCH /v1/stages/{id}` / `DELETE /v1/stages/{id}` - edita ou remove coluna sem leads vinculados.
- `GET /v1/round-robins` / `POST /v1/round-robins` - lista e cria filas de distribuicao com regras e membros.
- `PATCH /v1/round-robins/{id}` / `DELETE /v1/round-robins/{id}` - edita ou remove fila de distribuicao.
- `GET|POST /v1/round-robins/{id}/rules` e `PATCH|DELETE /v1/round-robin-rules/{id}` - gerencia regras da fila.
- `POST /v1/round-robins/{id}/members` e `PATCH|DELETE /v1/round-robin-members/{id}` - gerencia membros da fila.
- `POST /v1/pipelines/{id}/round-robin` - vincula uma fila ativa como round-robin padrao da pipeline.

## Variaveis obrigatorias

- `SUPABASE_PROJECT_URL`
- `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_SECRET_KEY` para uploads no Storage
- `DATABASE_URL`

## Desenvolvimento

```bash
go run ./apps/api/cmd/api
```

O projeto usa `go.work` na raiz para resolver os pacotes compartilhados em `packages/auth` e `packages/db`.

## Contratos

O contrato HTTP versionado fica em `packages/contracts/openapi/v1.yaml`.
