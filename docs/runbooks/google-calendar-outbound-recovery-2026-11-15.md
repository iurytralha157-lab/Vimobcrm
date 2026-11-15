# F02: recuperação outbound Google Agenda no self-hosted

Roteiro preparado em 15/11/2026 após autorização para concluir F02. O operador
raiz controla produção; os scripts deste pacote só preparam fontes, consultam
catálogo/fila ou ensaiam em banco descartável. F12 fica fora deste corte.
Nenhuma etapa deste documento, sozinha, comprova execução remota.

## Estado observado e objetivo

A leitura de produção confirmou cinco jobs QA da Vetter criados entre
13:51–13:53 UTC em 15/11: quatro `push_upsert` e um `push_delete`. Às 16:20 UTC
estavam `queued`, vencidos, sem tentativa ou lock. Separadamente, existem
24 `pull_incremental` mortos de agosto e uma conexão habilitada em erro,
`calendar_kind=primary`, `last_synced_at=null`, atualizada em 14/08 às 18:12 UTC.
O texto histórico `Google Calendar sync error 404` não demonstra falha dos
cinco pushes atuais; eles ainda não foram executados.

`pg_cron`, `pg_net` e catálogos Cron existem. Nenhum nome Google/calendar nem
comando referenciando `google-calendar-sync`/`invoke_google_calendar_worker`
foi encontrado. O helper privado, `verify_cron_secret(text)` e a coluna
`token_secret_ref` existem. Faltam `disconnecting_at`, claim v2, heartbeat e
finish fenced. O registro de migrations também não existe no alvo self-hosted.
O ledger cloud do README não deve ser copiado para esse ambiente.

Objetivo: reconciliar contratos, carregar runtime compatível, provar o estado
final dos compromissos QA no Google e reativar somente consumo outbound.
Preservar `GOOGLE_CALENDAR_CONNECT_MODE`, allowlists e despacho imediato atuais;
não habilitar novas conexões, inbound, pulls/watches, replay morto ou atalho
de envio direto. A mensagem neutra da UI continua válida durante diagnóstico.

## Fontes e dependências

| Fonte canônica | Papel e condição |
| --- | --- |
| `20260726235820_google_calendar_bidirectional_sync.sql` | Base de cinco tabelas Google, Vault, invoker e antigos Crons. Somente mapa de dependências; contém efeitos históricos e inbound, não reaplicar inteira. |
| `20261006150000_claim_google_calendar_outbound_jobs.sql` | Assinatura claim antiga precisa existir antes do revoke explícito no hardening. Conferir objeto real; não conceder acesso novamente. |
| `20261012212128_harden_google_calendar_outbound_protocol.sql` | `disconnecting_at`, `terminal_reason`, guard de INSERT, rebinding de jobs sem conexão, claim v2, heartbeat/finish, desconexão e ACL. Não contém BEGIN; aplicar em transação única explícita. |
| `20261013000127_harden_google_calendar_activation_status_and_export.sql` | `credential_revision`, CAS de refresh/ativação, estado agregado e exportação de lead autorizada. Possui transação e timeouts. Depende do hardening. |

As duas últimas ficam em `supabase/migrations/`. Não são novas migrations e não
foram alteradas. Não usar `db push` nem o reliability sweep/reconciler histórico.
O segundo arquivo adiciona coluna/trigger sem `IF NOT EXISTS`: se houver estado
parcial, comparar definições reais e preparar reconciliação específica antes de
executar; não mascarar divergência com edição dos arquivos canônicos.

Base necessária: `google_calendar_tokens`, `google_calendar_sync_jobs`,
`google_calendar_event_links`, `google_calendar_channels`,
`google_calendar_oauth_states`, `schedule_events`, users/membership,
leads/teams e tabelas de permissões. A exportação consulta
`organization_members.membership_generation`,
`team_members.membership_generation` e `schedule_events.lead_id`.
Conferir definições/colunas contra o arquivo completo, Vault e papéis
`anon`, `authenticated`, `service_role`; o pequeno relatório de catálogo
é uma verificação de contrato, não um comparador integral de schema.

## 1. Alvo, recuperação e janela coordenada

1. Registrar identidade do servidor/DB, versão, release Go publicado, mounts
   das Functions, imagem/digest, router, manifesto e inventário de slugs.
   Não imprimir URLs internas, env, comandos Cron, payloads ou segredos.
2. Criar backup privado no host, com permissões restritas, do schema/ACL e dados
   Google/Vault relacionados, eventos/links/jobs e artefatos runtime atuais.
   Incluir um backup restaurável do DB ou snapshot consistente que preserve
   as chaves necessárias ao Vault; só exportar refs não é recuperação de tokens.
   Verificar restauração em destino isolado antes de mutar. Não publicar dumps.
3. Guardar hashes dos bytes antigos e novos e o estado dos cinco jobs, links,
   versões finais dos eventos e contagens dos 24 pulls. Evidência compartilhada
   deve conter só contagens, booleans, horários e IDs internos QA necessários.
4. Confirmar ausência de consumidores ocultos: Cron, Edge antigo, chamadas de
   refresh/OAuth em voo, despacho imediato e invocadores externos. Bloquear e
   drenar seletivamente rotas Google mutáveis durante troca; preservar outros
   domínios. Gate de novas conexões desativado não drena contas existentes.
5. Não reverter dados CRM para snapshot anterior após usuários criarem novos
   eventos. Em falha, pausar consumidor e preferir correção progressiva; uma
   restauração integral é incidente separado com reconciliação de dados novos.

## 2. Preflight somente leitura e alcance global

Executar `scripts/maintenance/google-calendar-runtime-contracts.sql` numa
transação `READ ONLY`, com timeout. Retorna presença/ACL/guards, sem invocar RPCs.
Todas as RPCs atuais devem existir, serviço autorizado, anon/auth negados,
`SECURITY DEFINER` e `search_path=pg_catalog`; claims legados devem negar serviço.
Revisar owner, ACL PUBLIC e políticas/grants das cinco tabelas separadamente.

Executar `scripts/maintenance/google-calendar-outbound-preflight.sql` com `$1`
parametrizado para a organização Vetter já conferida. Saída global agregada
por `is_target_organization`, ação, status e idade. Sem org IDs, payloads,
Google IDs, refs ou tokens. O arquivo executa só SELECT; pode rodar antes do
hardening, mas a ausência de `disconnecting_at` não equivale a readiness.

Revisar todos `eligible_event_heads` e `obsolete_upserts` fora da Vetter,
além de `would_bind_during_hardening`/`ambiguous_hardening_binding`: o hardening
liga jobs sem conexão por tenant/owner, e o claim atual terminaliza upserts
obsoletos globalmente antes de selecionar. Ambiguidade de binding exige
reconciliação específica. Repetir a consulta depois do schema e antes do claim.

**Não existe executor canônico por ID de job neste release.** `enqueue_event`
apenas cria intenção; `run_due_jobs` chama claim v2 global, com fencing, e seu
`limit` de 1–20 não isola uma organização. Não chamar `executeSyncJob` fora do
protocolo, não alterar fila para forçar seleção e não usar `limit=5` como canário
isolado. Se houver candidatos de outras organizações, o operador precisa
avaliar explicitamente o alcance real antes de iniciar o consumidor previsto.

Elegibilidade atual: outbound, tentativas disponíveis, queued/failed vencido ou
running com lease >2 min, conexão do mesmo tenant/owner com credencial,
sem desconexão iniciada/concluída e sem irmão ativo do mesmo evento. Apenas a
cabeça por tenant/evento é escolhida. `sync_status=error` não bloqueia o claim.
Dead pulls nunca são escolhidos; nenhuma etapa os reativa.

## 3. Ensaio e aplicação do delta

Ensaio nativo já executado em PostgreSQL 17.11 loopback, em DB aleatório próprio:

```powershell
node scripts/supabase/test-google-calendar-native-recovery.mjs D:/Vimob/outputs/vetter-production-closure-20261115/vimob-whatsapp-ci
```

O runner confere marcador, endereço/porta, system identifier e diretório do
cluster autorizado; usa senha sintética somente em env do subprocesso. Cria e
remove DB próprio, nunca aceita URL remota. Passaram: falha injetada depois do
hardening com rollback integral; 12→13Out; testes SQL de protocolo e
ativação/status/export. Foram zero chamadas ao provedor. Esse ensaio usa schema
sintético; restaurar o backup real isoladamente e repetir é a prova do alvo.

No alvo, só após comparação e backup restaurável, usar psql com
`ON_ERROR_STOP=1`, sem segredo em linha de comando. Aplicar 12Out em UMA sessão:

```sql
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';
-- \ir <caminho privado conferido>/20261012212128_harden_google_calendar_outbound_protocol.sql
commit;
```

Substituir a linha comentada por `\ir` real dentro da sessão/script revisado.
13Out já contém `BEGIN/COMMIT` e timeouts: executar arquivo com erro fatal,
após o commit bem-sucedido de 12Out. Não combinar cegamente transações aninhadas.
Conferir catálogo/ACL após ambos, recarregar schema cache da Data API pelo
procedimento canônico do host e comprovar resolução das RPCs novas sem
executá-las como probe. Registrar hashes/aplicação no ledger operacional real;
se reconciliar o sistema de migrations, usar catálogo e backups do self-hosted.

O produtor Go existente usa outbox transacional e as migrations são aditivas.
Mesmo assim, conferir a versão efetivamente publicada: `google_sync.go` precisa
preservar o INSERT RETURNING/pending, o erro de desconexão e despertar só após
commit. Não publicar frontend/API incidentalmente. Gate local de contrato não
substitui essa leitura da imagem publicada.

## 4. Runtime Functions sem ampliar OAuth/inbound

Gerar pacote offline novo, fora do worktree:

```powershell
node scripts/supabase/package-google-calendar-recovery.mjs D:/Vimob/outputs/vetter-production-closure-20261115/google-calendar-recovery-source
```

O diretório precisa não existir. `inventory.json` e `SHA256SUMS` descrevem nove
arquivos runtime: `google-calendar-oauth/index.ts`,
`google-calendar-sync/index.ts` e sete módulos `_shared/google-calendar*.ts`.
Inclui também os dois SQLs canônicos e preflights/runbook. Não contém env,
router global ou manifesto global. O planner existente é usado só para fechar
imports; suas sugestões históricas de modo pilot NÃO se aplicam a este corte.

No host, após inspeção do mount real, copiar somente esses caminhos runtime
para staging privado e comparar SHA256. Fazer backup e troca coordenada dos
nove arquivos preservando outros `_shared` e slugs. OAuth e sync precisam ser
compatíveis com CAS/revision do mesmo release, mesmo mantendo novas conexões
desativadas. Manter rotas do manifesto atual; se faltarem, reconciliar apenas
essas duas entradas como `ACTIVE/LIVE`, `verify_jwt=false`, com auth no handler.
Não substituir o manifesto inteiro pelo local; o source_project_ref histórico
não identifica este alvo.

O router versionado usa `/home/deno/functions`, lê manifesto na inicialização
e cria workers com `noModuleCache=false`. Só copiar bytes não prova reload.
Após drenar, recriar/reiniciar o serviço Functions de forma coordenada conforme
o mount/imagem real, com janela dos outros consumidores preservada, e comparar
hashes efetivamente montados. Não alterar router global como atalho.

Presença de env apenas: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. OAuth existente usa ainda redirect
URIs e gate atuais. Não imprimir valores ou despejar env do container.
Validar imports com `deno check` dentro do runtime se disponível; o gate local
TypeScript usa ambient Deno e não é uma execução do runtime remoto.

Probes sem escrita: GET de sync deve retornar 405, não 404/500. Conferir status
OAuth autenticado pela UI preservando a conexão, sem chamar connect/callback.
GET 405 sozinho só comprova roteamento. Confirmar auth de cron por contrato e
helper, sem chamar claim como probe. Manter Edge notification sender aposentado
e todas as rotas/flags de outros domínios inalteradas.

## 5. Invoker, canário e scheduler

Revisar privadamente a definição REAL de
`private.invoke_google_calendar_worker(text,integer)` e a rota que resolve.
O objeto histórico observado usa URL literal; o arquivo-base lê Vault.
Não trocar helper nem criar chave por suposição. Conferir destino/host correto,
cron secret existente, acesso do pg_net ao endpoint e autenticação handler.
As saídas de conferência são booleans/status HTTP; nunca secret/URL/comando real.

Depois de todos os gates e do preflight global aprovado, uma execução manual
canônica é `select private.invoke_google_calendar_worker('run_due_jobs',20)`.
Ela é GLOBAL e pode executar até uma cabeça por evento. O número retornado é
request ID do pg_net, não recibo Google. Monitorar resultado HTTP saneado e
jobs/versões/links; evitar guardar corpo bruto com IDs do provedor.

Os cinco jobs podem incluir versões superadas e delete; expectativa é o estado
FINAL canônico, sem duplicata ou ressurreição. Repetir o consumidor em lotes
limitados só após verificar resultado e a fila global; cabeças do mesmo evento
podem exigir rodada posterior. Manter os 24 pulls mortos e histórico de agosto.
Comprovar no Google controlado horários/título finais e ausência do evento
cancelado; conciliar links e recibos CRM. `succeeded` ou aceite HTTP isolado não
prova estado externo. Sem acesso à conta, registrar essa prova pendente.

Após canário satisfatório, criar SOMENTE o scheduler outbound canônico:

```sql
select cron.schedule(
  'google-calendar-sync-jobs', '* * * * *',
  $cron$select private.invoke_google_calendar_worker('run_due_jobs',20);$cron$
);
```

Inspecionar conflitos pelo nome e por referências booleanas antes de agendar.
Usar o proprietário/DB apropriado já autorizado, observar pelo menos dois
ciclos com `cron.job_run_details` + HTTP + fila. Cron succeeded pode significar
somente enqueue HTTP; não equivale ao consumidor ou Google concluído.
Não agendar watch/pull. Não alterar despacho imediato para contornar Cron.
Novo erro 401/403/404/429/5xx exige correlação da chamada atual saneada, versão,
lease e recurso; o 404 de agosto não determina a causa de uma tentativa nova.

## Reversão e provas locais

Em falha de schema, erro fatal/timeout deve abortar a transação; não prosseguir
para runtime. Entre migrations, manter consumidor parado e corrigir à frente.
Após ativação, suspender somente o novo Cron e drenar consumidor antes de
intervir. Preservar schema aditivo/ACL restrita; nunca restaurar claim antigo,
grants públicos, worker sem fencing ou replay de pulls. Google write aceito não
é desfeito por rollback SQL: reconciliar estado canônico antes de qualquer retry.

Provas locais desta preparação:

- PostgreSQL 17.11: rollback injetado + ordem canônica + duas suítes SQL passaram.
- PGlite 18.6: lifecycle SQL e quatro grupos de preflight agregado passaram.
- Event/delivery/lifecycle TypeScript: 73 testes passaram, provedor simulado.
- Semantic Edge check: quatro entrypoints, zero diagnóstico; não é `deno check`.
- Planner e manifesto: passaram; três testes do planner passaram.

Runtime remoto, backup real, migrations, canário, scheduler e recebimento no
Google só podem ser marcados concluídos após o operador registrar sua execução.

## Apêndice: execução em produção em 15/11/2026

Registro posterior à preparação acima, com resultados fornecidos pelo operador
raiz que executou o corte. O texto anterior preserva o estado e os critérios
da etapa de planejamento; este apêndice registra o alcance efetivamente
executado e o bloqueio restante. Não representa conclusão do fluxo no Google.

### Recuperação e ensaio realizados

Foram criados no host backups privados, acessíveis somente a root, de schema,
Functions, dados Google e chave necessária ao Vault. O ensaio de restauração
foi reduzido: DDL das cinco tabelas Google, dependências builtins necessárias
e Vault, com 61/61 segredos descriptografáveis. Os fingerprints das cinco
tabelas restauradas coincidiram com produção antes do corte.

Essa prova não foi uma restauração integral do CRM, de suas FKs ou do dump
completo de funções. Não deve ser apresentada como recuperação integral
validada. Sobre o clone reduzido, foi carregado o claim legado real extraído
de produção e foram ensaiadas, com sucesso, as duas migrations canônicas
de 12 e 13 de outubro, na ordem prevista.

### Schema, runtime e transporte aplicados

O serviço Functions foi parado com 75 segundos de grace para drenar o runtime,
cujo limite de worker era de 60 segundos. Foram aplicadas em produção
`20261012212128_harden_google_calendar_outbound_protocol.sql`, em transação
única, e `20261013000127_harden_google_calendar_activation_status_and_export.sql`.
Em seguida, foram copiados seletivamente os nove arquivos Google do pacote.
O hash do router permaneceu igual. O serviço Docker voltou saudável e o GET
do endpoint sync retornou 405, confirmando roteamento sem escrita.
Os timestamps registraram 15 segundos entre início da parada e serviço iniciado.
A comparação final comprovou os demais arquivos, políticas, imagem, ambiente
e mounts iguais ao backup; os nove destinos Google coincidiam com o pacote.

O invoker instalado ainda usava o endpoint público original, inacessível
a partir do DB: a requisição pg_net 3933 falhou por impossibilidade de conexão;
o probe curl do DB apresentou código 000, enquanto o endpoint interno
respondeu 405. Após backup privado da definição e ensaio no clone, foi
substituído somente o literal do destino do helper por
`http://functions:9000/google-calendar-sync`. A autenticação existente via
segredo no Vault foi preservada. Não houve troca do protocolo de claim,
do router ou da política OAuth para contornar o transporte.

### Canário executado e bloqueio OAuth

A invocação manual seguinte gerou a requisição pg_net 3934, com HTTP 200.
O transporte e a entrada no consumidor funcionaram, mas duas cabeças
`push_upsert` terminaram em `failed`, com uma tentativa cada e erro
`Missing GOOGLE_CLIENT_ID`. Permaneceram dois `push_upsert` e um `push_delete`
em `queued`, com zero tentativas. HTTP 200 não foi tratado como recibo do
provedor: nenhum evento ou estado final no Google foi confirmado.

As três configurações `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e
`GOOGLE_CALENDAR_REDIRECT_URI` estavam ausentes no runtime e nas fontes
existentes pesquisadas. O refresh também carrega as três; restaurar apenas
o ID não basta. A pesquisa histórica identificou a antiga lacuna na migração
do Secret Store Edge, sem recuperar um par utilizável. O candidato histórico
em quarentena, associado a outro cliente, não foi usado.

O Cron Google NÃO foi criado nem ativado. Não houve replay de pulls antigos
nem reset/forçamento de tentativas, leases ou datas de execução. O baseline
dos 24 `pull_incremental` mortos tinha fingerprint
`2c9df8686d5513d45468757e43159bae`; a comparação final feita pelo operador
confirmou a mesma contagem e o mesmo fingerprint. No encerramento, não havia
jobs outbound running, HTTP Google pendente ou jobs de outra organização.

F02 segue bloqueada para conclusão de ponta a ponta. Antes de retomar canário
ou Cron, recuperar e instalar com segurança as três chaves do cliente OAuth
original correto, mantendo gates e conexões atuais. Não criar cliente novo,
usar credencial de outra aplicação ou reaproveitar o candidato em quarentena.
Depois, conferir presença no runtime, repetir o preflight global e acompanhar
as tentativas elegíveis pelo protocolo canônico, sem reset da fila. Somente
a prova do estado final no Google e dos recibos CRM permite encerrar o fluxo
e avaliar a ativação do scheduler outbound.
