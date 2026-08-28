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
- `GET|POST /v1/public/integrations/meta/webhook` - recebe webhooks da Meta, valida `X-Hub-Signature-256`, registra o evento e cria/reentra leads no banco.
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
- `GET /v1/properties/{id}/workspace` - carrega imovel e dados normalizados no mesmo snapshot com o predicado canonico own/team/all, em uma projecao allowlist por papel; leitores recebem apenas ofertas ativas, sem chaves, movimentos ou dados internos, e os contatos seguem a politica da organizacao.
- `PUT /v1/properties/{id}/offers/{sale|rent|seasonal}` - cria oferta sem versao ou altera com `expected_updated_at`; retry identico nao avanca a versao e precondicao ausente/obsoleta retorna `409`. A projecao legada mantem `preco` para venda e prioriza aluguel sobre temporada em `valor_locacao`.
- `POST /v1/properties/{id}/ownerships`, `PATCH /v1/properties/{id}/ownerships/{ownershipId}` e `POST /v1/properties/{id}/ownerships/{ownershipId}/end` - gerenciam proprietarios e coproprietarios com versao otimista e vigencia temporal semiaberta `[valid_from, valid_to)`; trocar o principal preserva o historico e a participacao vigente do anterior.
- `POST|PATCH|DELETE /v1/properties/{id}/assets[...]`, `PUT /v1/properties/{id}/assets/order` e `PUT /v1/properties/{id}/assets/{assetId}/primary` - gerenciam midias e documentos, ordem e capa de forma atomica com `expected_updated_at`.
- `POST /v1/properties/{id}/assets/upload-intents` - autoriza o imovel e gera URL/token de upload por duas horas no bucket privado `property-private`; o cliente envia o binario direto ao Storage e depois cadastra o `storage_path`. Leituras recebem `access_url` assinada de curta duracao sem persistir a URL.
- `POST /v1/properties/{id}/keys` - cadastra uma chave fisica e o movimento inicial de registro na mesma transacao.
- `POST /v1/properties/{id}/keys/{keyId}/movements` - registra transicoes de custodia atomicamente; exige `Idempotency-Key` opaca (1-200 caracteres), repete com seguranca o mesmo payload e retorna `409` se a chave for reutilizada com outro conteudo.
- Todos os endpoints do workspace de imoveis respondem com `Cache-Control: private, no-store` e variam por `Authorization` e `X-Organization-ID` para impedir cache compartilhado entre papeis ou organizacoes.
- `POST /v1/property-images` - envia imagens de imoveis para o Supabase Storage pelo backend, com validacao de tipo/tamanho e escopo de organizacao.
- `GET /v1/property-captors/{id}` - busca dados minimos do captador no escopo da organizacao.
- `GET /v1/property-site-info` - busca dominio/subdominio ativo da organizacao para links de imoveis.
- `GET /v1/property-summaries?ids=...` - busca resumos de imoveis por id para funil e analytics.
- `GET|POST /v1/property-developments` - lista e cria empreendimentos no escopo da organizacao.
- `GET /v1/property-developments/{id}/workspace` e `GET /v1/property-developments/{id}/units` - carregam o workspace e o estoque paginado do empreendimento.
- `PUT /v1/property-developments/{id}/units/{unitId}/price` - edita o preco da unidade em uma tabela draft versionada, com precondicao otimista.
- `GET /v1/property-developments/{id}/reservations` - lista reservas com filtros, paginacao e indicadores globais do empreendimento.
- `POST /v1/property-developments/{id}/units/{unitId}/reservations` - cria uma reserva idempotente com snapshot da tabela ativa; exige `Idempotency-Key` UUID.
- `POST /v1/property-developments/{id}/reservations/{reservationId}/cancel` - cancela e libera a unidade com controle otimista.
- `POST /v1/property-developments/{id}/reservations/{reservationId}/convert` - converte a reserva ativa em venda e retira a unidade da publicacao.
- `POST /v1/property-developments/{id}/reservations/{reservationId}/extend` - prorroga uma reserva ativa dentro da janela maxima de 30 dias.
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

## Variaveis operacionais opcionais

- `NOTIFICATION_DISPATCH_WORKER_ENABLED` - inicia o consumidor da fila duravel de notificacoes e os lembretes de agenda. Padrao seguro: `false`; habilite explicitamente apenas depois de validar o backlog e os provedores do ambiente.
- `AUTOMATION_RUNTIME_WORKER_ENABLED` - liga/desliga o coordenador backend de automacoes. Padrao: `true`.
- `AUTOMATION_RUNTIME_WORKER_INTERVAL` - intervalo do runner de eventos/execucoes. Padrao: `30s`.
- `AUTOMATION_INACTIVITY_WORKER_INTERVAL` - intervalo do scanner de inatividade. Padrao: `5m`.
- `AUTOMATION_WORKER_RUN_TIMEOUT` - timeout maximo de cada ciclo. Padrao: `25s`.
- `AUTOMATION_WORKER_LOCK_TIMEOUT` - timeout para obter a trava distribuida no Postgres. Padrao: `2s`.
- `PROPERTY_DEVELOPMENT_RESERVATION_WORKER_ENABLED` - liga/desliga a expiracao automatica de reservas. Padrao: `true`.
- `PROPERTY_DEVELOPMENT_RESERVATION_WORKER_INTERVAL` - intervalo entre ciclos; cada ciclo drena o backlog em lotes curtos. Padrao: `1m`.
- `PROPERTY_DEVELOPMENT_RESERVATION_WORKER_BATCH` - quantidade maxima por transacao concorrente com `SKIP LOCKED`. Padrao: `100`.

## Meta (backend Go)

OAuth, Lead Ads, formulários, sincronização de Marketing e mensagens usam o mesmo aplicativo Meta e passam exclusivamente pela API Go. O banco persiste fatos e guarda credenciais no Vault; ele não chama a Meta.

O backend usa:

- `META_APP_ID` e `META_APP_SECRET` para OAuth e chamadas autenticadas.
- `META_LOGIN_CONFIG_ID` opcional para Facebook Login for Business. Vazio preserva o fluxo OAuth atual; preenchido adiciona `config_id` e força o code grant com `override_default_response_type=true`.
- `META_APP_SECRET` para validar `X-Hub-Signature-256`.
- `META_WEBHOOK_VERIFY_TOKEN` para o challenge de verificacao da Meta.
- `META_GRAPH_VERSION` opcional, padrao `v25.0`.
- `META_GRAPH_BASE_URL` opcional, padrao `https://graph.facebook.com`.
- `META_OAUTH_CALLBACK_URL` para o callback público exato da API.
- `META_OAUTH_ALLOWED_ORIGINS` para as origens exatas que podem iniciar o fluxo.

URLs públicas esperadas no deploy:

- Webhook: `https://api.vimobcrm.com.br/v1/public/integrations/meta/webhook`.
- OAuth: `https://api.vimobcrm.com.br/v1/public/integrations/meta/oauth/callback`.

## Desenvolvimento

```bash
go run ./apps/api/cmd/api
```

O projeto usa `go.work` na raiz para resolver os pacotes compartilhados em `packages/auth` e `packages/db`.

## Contratos

O contrato HTTP versionado fica em `packages/contracts/openapi/v1.yaml`.
