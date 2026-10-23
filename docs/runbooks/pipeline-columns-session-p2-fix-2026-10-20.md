# Colunas da Pipeline — sessao ativa nas configuracoes (P2)

Correcao local de 20/10/2026 do COL-01 da auditoria das colunas. Checkout
principal, sem deploy, migration, configuracao remota ou alteracao de dados.

## Problema e comportamento

Um JWT de usuario pode continuar assinado e dentro do prazo depois de sua
sessao ser revogada. As rotas abaixo verificavam JWT, organizacao e permissao,
mas nao consultavam a sessao ativa antes do handler.

Foram trocados somente 17 registros em `apps/api/internal/app/routes.go` para
os wrappers ativos existentes. Nao houve mudanca nos wrappers compartilhados,
handlers, payloads, revisoes CAS, repositorios, regras de negocio ou frontend.

| Rotas | Controle mantido, agora com sessao ativa |
|---|---|
| POST /v1/pipelines; PATCH/DELETE /v1/pipelines/{id} | pipeline_manage |
| POST /v1/pipelines/{id}/stages; POST /v1/pipelines/{id}/stages/reorder | pipeline_manage |
| POST /v1/pipelines/{id}/round-robin; PATCH/DELETE /v1/stages/{id} | pipeline_manage |
| GET /v1/stage-automations | modulo automations + automations_view |
| POST /v1/stage-automations; PATCH/DELETE /v1/stage-automations/{id}; PATCH /v1/stage-automations/{id}/status | modulo automations + automations_manage |
| GET/PUT /v1/stage-operational-configs; GET/PUT /v1/pipeline-sla-settings | pipeline_manage |

GET pipelines/stages, regras operacionais canonicas e inatividade dedicada ja
tinham verificacao de sessao ativa e permaneceram iguais. O comando interno
de automacao visual tambem nao foi alterado.

Ordem preservada: JWT/restricao de recovery, sessao ativa, tenant/billing,
organizacao, modulo quando exigido, permissao e handler. A sessao e consultada
pelo par SID/usuario do JWT verificado, usando o checker Postgres existente.

- SID ausente ou sessao revogada/de outro usuario: 401, antes do tenant.
- Checker ausente/indisponivel: 503 session_check_unavailable, sem fallback.
- Recovery: 403 antes de consultar a sessao; JWT expirado/anonimo: 401.
- Sessao valida continua sujeita aos mesmos gates de tenant/modulo/permissao.

Ha uma consulta adicional de sessao por pedido dessas rotas, limitada pelo
timeout existente de tres segundos. A verificacao nao desfaz operacao que ja
tenha sido autorizada antes da revogacao. Nao ha promessa de latencia do banco
operacional nesta validacao local.

## Regressao

Teste duravel: `apps/api/internal/app/pipeline_configuration_session_routes_test.go`.
Usa registrador de rotas, verificador JWT e handlers reais; apenas checker e
resolver de tenant sao sinteticos. JSON/IDs invalidos fazem controles ativos
pararem com 400 antes do banco. Nenhuma escrita comercial e exercitada.

Antes do patch: 340 casos, 34 aprovados e 306 falhas esperadas. Apos o patch,
mais controles de expiracao e revogacao entre pedidos: 374/374 aprovados, sem
falhas ou pulos. A composicao final e 136 negacoes, 204 casos de
tenant/permissao/modulo, 17 contratos de registro e 17 revogacoes mantendo o
mesmo JWT. As contagens sao folhas; nao somam cenarios/pais novamente.

Regressao completa dos cinco pacotes abaixo: 2.453 folhas aprovadas, zero
falhas e 33 pulos de integracao sem opt-in/banco. Esses resultados ja incluem
os 374 casos novos; nao somar novamente. `audit:check` passou com quatro
contratos, `gofmt -l` nao apontou arquivos e `git diff --check` passou.

```powershell
go test -count=1 ./apps/api/internal/app -run TestPipelineConfiguration
go test -count=1 ./apps/api/internal/app ./apps/api/internal/httpserver ./apps/api/internal/tenant ./apps/api/internal/pipelines ./apps/api/internal/stageconfig
npm run audit:check
```

Executar com opt-ins e DSNs de integracao desabilitados quando o escopo for
somente a regressao isolada. O recibo da rodada registra separadamente os
skips de fixtures PostgreSQL; skip nao e aprovacao. A ausencia de mudanca no
frontend dispensa repetir a suite visual para esta substituicao de wrappers.

## Compatibilidade e reversao

As rotas sao de usuario autenticado com SID. Integracao externa que usava token
sem SID ou service role deve usar o contrato correto; nao remover o gate para
aceitar esse chamador. Nenhum consumidor local com esse padrao foi identificado.

O catalogo geral de contratos e um snapshot historico com aviso de defasagem;
nao foi regenerado junto desta correcao para preservar alteracoes simultaneas.
O README da API documenta a fronteira atual. Nenhum payload foi alterado.

Em reversao local, desfazer seletivamente os 17 hunks e os arquivos desta
correcao, preservando todas as alteracoes preexistentes. Restaurar os wrappers
anteriores reabre o P2; nao publicar esse retorno como correcao de seguranca.
Nao usar reset/checkout de arquivos completos nem alterar Auth compartilhado.

O COL-01 pode ser fechado no codigo apos regressao e revisao independente.
Instalacao no ambiente, auth.sessions real, carga/latencia e operacoes com banco
continuam gates de homologacao. Esta rodada nao incluiu deploy nem reinicio do
CRM e nao corrige os outros seis pontos da auditoria.
