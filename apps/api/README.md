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
- `POST /v1/leads/{id}/move-stage` - move lead no funil com permissao, auditoria e atividade de mudanca de etapa. `expectedStageId` e `expectedUpdatedAt` comparam o snapshot original sob o lock, antes dos efeitos; conflito retorna `409 lead_stage_changed` ou `409 lead_changed`, sem repeticao automatica. A revisao preserva microssegundos e e obrigatoria para mover um lead ganho/perdido entre etapas; clientes antigos ainda podem mover leads abertos ou reordenar na mesma etapa sem revisao.
- `POST /v1/leads/{id}/assign` - transfere ou limpa responsavel do lead, registrando `assignments_log`. Exige `expectedUpdatedAt` exato do gesto original; ausencia ou mudanca retorna `409 lead_changed`, sem efeitos/retry automatico. O alvo precisa pertencer a geracao ativa da equipe vinculada, conforme o PATCH. `conversation-detail` inclui `updated_at` exato para esse consumidor.
- `POST /v1/internal/automations/stage-command` - executa `move_lead` visual pelo mesmo kernel comercial do movimento manual, com lease, versao imutavel, permissao vigente do autor e ledger atomico. Exige segredo dedicado `AUTOMATION_COMMAND_TOKEN`. Configuracao, rollout coordenado e reversao em [pipeline-stage-command](../../docs/runbooks/pipeline-stage-command.md); preparado localmente, sem ativacao remota.
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
- `PATCH /v1/properties/{id}` - exige `expected_updated_at` e retorna `409` quando outra edicao alterou o imovel desde a ultima leitura, impedindo sobrescrita silenciosa inclusive por clientes diretos.
- `POST /v1/properties/{id}/ownerships`, `PATCH /v1/properties/{id}/ownerships/{ownershipId}` e `POST /v1/properties/{id}/ownerships/{ownershipId}/end` - gerenciam proprietarios e coproprietarios com versao otimista e vigencia temporal semiaberta `[valid_from, valid_to)`; trocar o principal preserva o historico e a participacao vigente do anterior.
- `POST|PATCH|DELETE /v1/properties/{id}/assets[...]`, `PUT /v1/properties/{id}/assets/order` e `PUT /v1/properties/{id}/assets/{assetId}/primary` - gerenciam midias e documentos, ordem e capa de forma atomica com `expected_updated_at`.
- `POST /v1/properties/{id}/assets/upload-intents` - autoriza o imovel e gera URL/token de upload por duas horas no bucket privado `property-private`; o cliente envia o binario direto ao Storage e depois cadastra o `storage_path`. A reserva permanece como tombstone ate o vencimento do token mais cinco minutos, e descarte/exclusao fisica aguardam esse prazo para impedir replay no path. Leituras recebem `access_url` assinada de curta duracao sem persistir a URL.
- `POST /v1/properties/{id}/keys` - cadastra uma chave fisica e o movimento inicial de registro na mesma transacao.
- `POST /v1/properties/{id}/keys/{keyId}/movements` - registra transicoes de custodia atomicamente; exige `Idempotency-Key` opaca (1-200 caracteres), repete com seguranca o mesmo payload e retorna `409` se a chave for reutilizada com outro conteudo.
- Todos os endpoints do workspace de imoveis respondem com `Cache-Control: private, no-store` e variam por `Authorization` e `X-Organization-ID` para impedir cache compartilhado entre papeis ou organizacoes.
- `POST /v1/property-images` - endpoint legado desativado (`410 Gone`); novos uploads usam intent no bucket privado e cadastro canonico em `property_assets`.
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
- `PATCH /v1/stages/{id}` / `DELETE /v1/stages/{id}` - edita ou remove coluna sem leads vinculados. PATCH exige a revisao exata `expectedUpdatedAt`; ausencia/obsolescencia retorna `409 pipeline_stages_changed` antes de efeitos de qualificacao/arquivo. Arquivar/excluir etapa ou excluir funil referenciado por fluxo efetivo/execucao pendente retorna `409 stage_has_automation_dependencies`, com nomes limitados depois da permissao. Publicar/ativar fluxo com destino inativo ou indisponivel retorna `400 automation_stage_unavailable` sem revelar tenant de referencia inexistente.
- `GET /v1/round-robins` / `POST /v1/round-robins` - lista e cria filas de distribuicao com regras e membros.
- `PATCH /v1/round-robins/{id}` / `DELETE /v1/round-robins/{id}` - edita ou remove fila de distribuicao.
- `GET|POST /v1/round-robins/{id}/rules` e `PATCH|DELETE /v1/round-robin-rules/{id}` - gerencia regras da fila.
- `POST /v1/round-robins/{id}/members` e `PATCH|DELETE /v1/round-robin-members/{id}` - gerencia membros da fila.
- `POST /v1/pipelines/{id}/round-robin` - vincula uma fila ativa como round-robin padrao da pipeline.

### Sessao ativa nas configuracoes da Pipeline

As escritas de pipelines/colunas (incluindo reordenacao e round-robin padrao),
as leituras/escritas de automacoes de coluna e os contratos legados de
`stage-operational-configs` e `pipeline-sla-settings` exigem uma sessao ativa.
O JWT precisa conter `session_id` ainda vinculado ao seu usuario em
`auth.sessions`; assinatura e prazo do token sozinhos nao bastam. As leituras
de pipelines/colunas, regras operacionais e inatividade ja usam essa fronteira.

A verificacao ocorre antes de resolver tenant ou processar o pedido. SID ausente
ou sessao revogada retorna `401`; falha/indisponibilidade da checagem retorna
`503 session_check_unavailable`, sem aceitar a operacao. Permanecem as permissoes
de pipeline ou automacoes, o modulo quando exigido, billing, escopo de organizacao
e revisoes de concorrencia. Tokens de recovery continuam restritos; integracoes
nao devem chamar essas rotas de usuario com token sem SID ou service role.

Escopo, regressao e reversao estao no
[runbook P2 das colunas](../../docs/runbooks/pipeline-columns-session-p2-fix-2026-10-20.md).

### Sessao ativa no catalogo de equipes

`GET /v1/teams`, usado pelo catalogo de filtros e pela lista de equipes,
tambem exige sessao ativa antes de tenant/billing, organizacao e `team_view`.
A mesma protecao vale para HEAD e para os parametros `includeInactive`.
SID ausente/revogado retorna401; checker indisponivel retorna503. As permissoes,
o escopo organizacional/de lideranca e o payload permanecem iguais.
Somente o registro desse GET foi alterado; as rotas adjacentes de equipes
nao fazem parte desta correcao. Regressao e limites:
[Pipeline filtros P3](../../docs/runbooks/pipeline-filters-session-p3-fix-2026-10-20.md).

### Continuacao da pagina da Pipeline

`GET /v1/pipeline-stage-leads` emite `hasMore` booleano, inclusive `false`.
A consulta le no maximo `limit + 1` linhas visiveis sob os mesmos filtros;
retorna ate `limit` e usa a linha adicional apenas para confirmar continuacao.
O proximo cursor continua sendo o ultimo card retornado, sem pular a sentinela.
Nao ha contagem integral extra, migration ou alteracao do snapshot inicial.

O frontend novo tolera a ausencia desse campo em APIs anteriores: pagina cheia
com progresso mantem a continuacao ate uma pagina final de confirmacao. O total
do primeiro quadro nao pode encerrar paginas posteriores. Um piso de contagem
local recebe `+` no contador, sem quantidade restante exata, ate novo snapshot.
Regressao, compatibilidade e reversao estao no
[runbook P5 da paginacao](../../docs/runbooks/pipeline-pagination-p5-fix-2026-10-20.md).

## Variaveis obrigatorias

- `SUPABASE_PROJECT_URL`
- `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_SECRET_KEY` para uploads no Storage
- `DATABASE_URL`

## Variaveis operacionais opcionais

- `NOTIFICATION_DISPATCH_WORKER_ENABLED` - inicia o consumidor da fila duravel de notificacoes e os lembretes de agenda. Padrao seguro: `false`; habilite explicitamente apenas depois de validar o backlog e os provedores do ambiente.
- `AUTOMATION_RUNTIME_WORKER_ENABLED` - liga/desliga o coordenador backend de automacoes. Padrao: `true`.
- `STAGE_INACTIVITY_WORKER_ENABLED` - executor dos alertas simples de inatividade das etapas. Padrao: `false`; exige tambem o gate global, schema/indice preparados e ativacao explicita da regra. Usa ultima interacao humana e comeca na ativacao, sem backlog automatico; nao habilita regras legadas. Ciclo a cada 30s, limitado a 45s. `App.Close` cancela e aguarda esse executor antes de fechar o pool.
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

### Revisao concorrente de equipes

`GET /v1/teams` e `GET /v1/teams/{id}` devolvem `revision` em cada equipe.
`POST /v1/teams` comeca em `revision: 1`. Para editar nome, logo, status,
membros ou escala pelo `PATCH /v1/teams/{id}`, envie `expected_revision` com o
numero recebido na ultima leitura ou gravacao bem-sucedida. O backend compara a
revisao enquanto mantem a equipe travada na transacao. Uma alteracao efetiva
avanca a revisao; repetir um payload identico com a revisao atual nao a avanca.
Quando o pedido substitui `members` ou `memberIds`, envie tambem
`expected_member_ids` com os IDs de `Team.members[].id` visiveis na mesma
leitura. Para uma equipe sem membros visiveis, envie `[]` explicitamente.
Essa segunda precondicao cobre a remocao e o reconvite de um usuario na
organizacao: o vinculo antigo pode deixar de ser visivel sem alterar a revisao
da equipe. A API compara os IDs antes de aplicar qualquer mudanca.
Ao substituir a lista, o `PATCH` substitui apenas os membros visiveis:
vinculos, escalas e entradas de fila de membros temporariamente suspensos
permanecem guardados e voltam a aparecer quando a organizacao os reativa
na mesma geracao. Um membro removido e depois reconvidado inicia outra
geracao e exige selecao explicita no editor para voltar a equipe e a fila.
Em `POST` e `PATCH`, envie somente um formato de lista: `members` ou o legado
`memberIds`. Mesmo uma lista vazia conta como presente; usar ambos retorna `400`.

Se outro escritor alterou a equipe, o `PATCH` responde `409` com
`error.code = team_revision_conflict` e nao grava nenhuma parte do pedido.
O cliente deve manter o rascunho visivel e pedir que a pessoa recarregue a
versao atual antes de tentar novamente. Uma chamada sem `expected_revision`
ou sem `expected_member_ids` ao substituir membros recebe
`400 invalid_team_input` sem gravar. Rotas auxiliares de status, lideranca e
disponibilidade continuam com seus payloads atuais, mas atualizam a revisao
da equipe quando mudam dados, invalidando um editor que ficou aberto com uma
versao antiga.

### Publicacao das correcoes de equipes

Na base de destino, confira o historico de migracoes e aplique as pendentes na
ordem dos arquivos. Para estas correcoes, a sequencia relevante e:

1. `20261009030225_membership_access_generation.sql` cria a geracao do vinculo
   organizacional e dos participantes de equipes e filas.
2. `20261009060500` ate `20261009061000` limitam as leituras e os efeitos
   legados a vinculos vigentes e bloqueiam escritas de grants e RPCs antigos.
3. `20261009061902_lock_team_pipeline_writes_to_backend_gateway.sql` revoga a
   escrita direta de `authenticated` em `team_pipelines`; o cliente passa pelo
   gateway Go, que confere `pipeline_manage` e o escopo da equipe.
4. `20261009114207_team_revision_optimistic_concurrency.sql` cria
   `teams.revision` e atualiza a limpeza de membros orfaos para avancar a
   revisao das equipes alteradas. A API tambem avanca a revisao quando a
   exclusao de um usuario remove seus vinculos de equipe.
5. `20261009140731_fence_membership_grants_after_reinvite.sql` e a correcao
   forward da `20261009030225`: impede trocar a identidade do vinculo e limpa
   grants de roles e overrides em remocao, reconvite ou exclusao fisica.
   A migracao original pode ja estar aplicada e deve permanecer intacta.

Coordene banco, API e cliente em uma janela de corte. Depois das migracoes,
atualize todas as replicas da API Go e publique o cliente que usa o gateway e
envia as precondicoes de revisao e membros. Suspenda escritas de equipes e
pipelines durante a mistura de versoes: o cliente antigo perde a escrita direta
em `team_pipelines` assim que a `20261009061902` entra, e uma replica antiga da
API pode aceitar um `PATCH` sem comparar `expected_revision`. Reabra as escritas
somente apos confirmar que todas as replicas usam a nova versao e que os
usuarios carregaram o cliente novo, inclusive em abas que estavam abertas.

Antes do corte, exercite em homologacao, com contas de teste e papeis
distintos: escrita autorizada e negada de equipe/pipeline, suspensao e reconvite
de membro, escala de distribuicao, `GET` com `revision`, `PATCH` sem precondicao
rejeitado sem gravacao e `PATCH` concorrente com `409` sem alteracao parcial.
Depois do corte, repita canarios autenticados e confira erros e saude das
replicas. Testes locais e contrato HTTP nao substituem essa verificacao.

Nao trate rollback de binario como rollback completo: a `20261009061902`
mantem a escrita direta bloqueada, e uma API antiga pode aceitar alteracoes sem
precondicao. Preserve as migracoes aplicadas e planeje uma correcao forward;
nao remova `teams.revision` nem restaure grants antigos sem plano de dados e
seguranca.
