# Release controlado: Vimob → Google Agenda

Roteiro do candidato local de 12/10/2026. Não executa deploy, migração, env,
ativação Google ou Cron. Produção continua bloqueada. Contrato e evidência
atual em docs/google-agenda.md.

## Estado atual

OAuth status 200/gate disabled; sync existe (GET 405). Calendar API desativada;
OAuth Externo/Testando com uma conta de teste. Nenhum Cron Google, uma conexão
em erro, 24 dead pulls, nenhum outbound. FK SET NULL e claims restritos já
presentes; helpers Vault/desconexão ainda públicos no catálogo observado.
Não foram chamados. P0 só será corrigido no ambiente após mudança aprovada.

Invoker SQL real usa URL literal. Falta google_calendar_sync_base_url no Vault
não é bloqueio isolado desse objeto. Não substituir pelo arquivo-base que exige
a chave sem reconciliar destino e consumidor. Cron secret existe.
Não revelar/copy/persistir tokens ou secret values em evidências.

## Corte migration-first e compatibilidade

1. Ler ledger, catálogo, mounts/router policy, env, workers e hashes Edge.
   Preservar rotas existentes e preparar backup/reversão. Manifesto local
   não prova versão nem policy do runtime atual.
2. Manter CONNECT_MODE disabled, despacho imediato false e Cron sem ativação.
   Pausar/drenar Edge antigo e suas rotas Google mutáveis antes do corte:
   ele não implementa fencing e perde claim ao aplicar SQL novo. Gate disabled
   só impede novas conexões, não chamadas de contas existentes. A manutenção
   seletiva dessas rotas deve preservar as Functions de outros domínios.
3. Revisar/aplicar isoladamente, no alvo autorizado,
   supabase/migrations/20261012212128_harden_google_calendar_outbound_protocol.sql.
   Dependências: cinco tabelas Google, schedule_events, Vault e claim anterior
   reconciliados. Não replay baseline/sweep. Migração não agenda Cron nem chama
   Google. Corrige grants/role guard, adiciona disconnecting_at/terminal_reason,
   claim v2, heartbeat/finish e preparação/cancelamento de disconnect.
   Finish inclui erros event/link/conta na mesma transação fenced; argumento
   p_is_conflict é boolean opcional. Não manter o Edge antigo, que escreve
   status separadamente e não conhece esse protocolo.
4. Producers Go existentes mantêm outbox transacional. Trigger usa row lock
   curto de conexão; comando CRM durante disconnect reverte com 55P03 exato
   google_calendar_connection_disconnecting. Go candidato traduz para 409
   google_calendar_disconnecting. Edição/delete não podem perder intenção caso
   revoke falhe depois. Validar retry com o mesmo client_request_id.
   O Go candidato deriva pending de INSERT RETURNING do job; publicar essa
   correção antes de retomar a integração. Go anterior suporta o schema,
   mas devolve erro genérico nesse bloqueio e pode deixar pending sem job quando
   falta token/conexão e o trigger suprime o insert.
   Não há lock durante rede. Helper disconnect conserva assinatura para a
   remoção de organização Go, com rechecagem atômica de pendências; validar
   esse consumidor em staging. Begin rejeita outro marker ativo; crash após
   preparação exige revisão de worker/revogação antes de abortar o marker,
   sem expiração automática concorrente.
5. Publicar somente OAuth/sync e os módulos compartilhados Google importados.
   Edge novo exige claim v2 e heartbeat/finish: não publicar antes do SQL.
   Não substituir todo _shared nem router global. Webhook/auth legado não
   são necessários. Comparar hashes/rotas efetivos após troca.
6. Conferir helpers e claims negados a PUBLIC/anon/auth, serviço autorizado
   somente nas funções esperadas. Usar catálogo e teste negativo com fixture/
   staging; não ler get_token_secret em produção para demonstrar proteção.
   Conferir owner/search_path/RLS/grants.
7. Deixar migração de Ajuda 20261006151000 fora deste corte. Não reaplicar
   reliability sweep histórico, que também agenda pulls/watches.

## Configuração futura, somente após autorização

- Functions: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET, GOOGLE_CALENDAR_REDIRECT_URI e retorno web/PWA de mesma
  origem GOOGLE_CALENDAR_POST_CONNECT_REDIRECT_URL.
- Gate disabled padrão; pilot exige UUID Vimob de capacidade comprovada.
  All somente com decisão de liberação geral e OAuth Google verificado/publicado.
- Google Calendar API ativada, cliente Web, callback HTTPS exato de
  /functions/v1/google-calendar-oauth/callback e escopos openid/email/Calendar
  owned. Gmail de teste e UUID Vimob são controles independentes.
- Reconciliar invoker SQL instalado, cron secret e URL efetiva. Adotar URL
  Vault exige preparação coordenada da chave/SQL, sem supor equivalência atual.
- Classificar fila por ação/status/idade/conexão/owner. Dead pulls são legado,
  não outbound. Não ligar entrada para tentar corrigir envio.
- Ativar somente google-calendar-sync-jobs sob autorização. Não chamar
  reconcile histórico que cria três Crons sem revisar o corpo real.
  Despacho imediato true só após privilégio/destino validados; medir atraso.
  Até lá manter false. Cron continua fallback de retry.

## Verificação local e staging

Comandos locais sem rede de produto:
- node --import ./scripts/tests/typescript-alias-hooks.mjs --experimental-transform-types --test supabase/functions/_shared/google-calendar-event.test.ts supabase/functions/_shared/google-calendar-delivery.test.ts
- node --test scripts/supabase/plan-google-calendar-edge-release.test.mjs
- node scripts/supabase/verify-edge-functions.mjs
- node scripts/supabase/verify-migrations.mjs

SQL somente database descartável vazio: fixture
supabase/tests/google_calendar_outbound_protocol.fixture.sql, migração nova,
supabase/tests/google_calendar_outbound_protocol.test.sql, nessa ordem.
Nunca usar fixture em CRM existente/produção. Teste cobre negação real dos
helpers, serviço, duas orgs, claim único por evento, segunda worker, lease
expirado, completion antigo bloqueado, órfãos pós-delete e insert/disconnect.
Passou em 12/10/2026 em PostgreSQL 18.6 WASM via PGlite 0.5.9, memória isolada.
O caso de serviço usa session authorization authenticator + role service_role;
guard negativo continua negando mesmo com EXECUTE autenticado simulado. Inclui
transferência de job dead e inserção com owner de outra organização.
Outcome e erros são atômicos: rejeição de metadata reverte outcome/attempt;
completion antigo não repinta retry concluído. Erro delete não alcança link
de outro tenant/conexão. Regressão Edge pausa resposta da falha após o commit
SQL, conclui retry do mesmo job e prova zero statuswrites tardios.
Runner desta auditoria: D:/Vimob/outputs/auditoria-agenda-2026-10-12/sql-runtime/run-google-sql.mjs.
Instalação de ferramenta fora do CRM: npm install --prefix
D:/Vimob/outputs/auditoria-agenda-2026-10-12/sql-runtime @electric-sql/pglite@0.5.9
--save-exact --ignore-scripts --no-audit --no-fund. Não adicionar ao app.
O Docker descartável ficou indisponível. WASM valida SQL/roles/ACL/fencing, mas
não substitui teste no Postgres 17 alvo nem concorrência de réplicas em staging.

No staging/piloto aprovado validar: consentimento parcial sem gravação, fora
do piloto 403, state replay/expiração, create/edit/delete/all-day/recorrência,
owner transfer, V1/V2 concorrente, timeout/429/403/refresh revogado,
disconnect/criação simultâneos, revoke falho e reconexão. Confirmar nenhum
convidado/import Google. Validar cleanup de organização Go e app nativo à parte.
Registrar ID/versão final e latência Google; 202/status OAuth/jobs não bastam.

## Reversão

Disabled pausa novas conexões, não contas existentes nem fila. Suspender Cron/
dispatch e parar worker antes da reversão. Não restaurar grants públicos ou
claim antigo como rollback; aditivos podem permanecer e correção é forward.
Tokens não são revogados pelo gate. Reconciliar fila/links antes de retomar.
Workers sem fencing não podem coexistir com v2.
# Adendo da segunda auditoria — aplicar antes do candidato compatível

`20261013000127_harden_google_calendar_activation_status_and_export.sql` é
forward posterior a `20261012212128`; o histórico da primeira rodada foi
preservado. Esta documentação não executa mudanças de ambiente. Estados de
API/OAuth/Vault/filas anteriormente observados são snapshots anteriores,
não uma nova verificação autenticada de produção.

O corte precisa drenar também callbacks OAuth e refreshes antigos: código
antigo grava Vault/linha separadamente e não participa do CAS dedicado.
Suspender cron/dispatch/worker, aguardar requests em voo e conferir leases e
fila antes de aplicar. Nunca restaurar grants públicos como rollback.

Novos RPCs são service-only, com guard interno e search_path fechado:
activate_oauth_connection, store_refreshed_token,
refresh_outbound_connection_status e get_authorized_event_lead (prefixo
google_calendar_). Claim/finish v2 mantêm assinaturas. Reconnect/rotation usam
revisão da credencial; metadata não a altera. Claim captura a revisão, e finish
devolve resultado obsoleto à fila sem consumir tentativa. Reconnect não é
autorização para replay/descarte de dead intents.

Validar antes do canário: OAuth parcial sem Vault write, callbacks concorrentes,
callback×prepare/finalize/abort disconnect, refresh antigo×reconnect, refresh de
canal legado durante disconnect seguido de 401, erro de grant antigo com lease
válido, status agregado com falha resolvida/nova, descrição/local apagados,
cleanup tardio com If-Match e export com Own/Team/All negados. Confirmar que
metadados de lead/propriedade não escapam por associação ao evento.

Verificar ordem de locks em duas conexões nativas: produtores
event→links/FK→connection; finish event→links→connection→job; disconnect
connection→jobs sem lock/write de eventos/links; claim jobs + leituras MVCC.
Fixtures de PGlite não são prova de ausência de deadlock entre réplicas.

Checks locais persistentes:

- `node scripts/supabase/check-google-calendar.mjs` (strict semantic, quatro
  entrypoints + imports, tipos reais de supabase-js; ambient Deno mínimo).
- `node --experimental-transform-types --import ./scripts/tests/typescript-alias-hooks.mjs --test supabase/functions/_shared/google-calendar-lifecycle.test.ts`.
- `node scripts/supabase/test-google-calendar-lifecycle-sql.mjs <absolute-PGlite-dist/index.js>`
  cria apenas memory:// e não aceita URL de CRM/produção.
- No runtime alvo: `deno check` dos entrypoints Google, versão/mount/router/hash,
  migrations/ACL reais e canário com prova da versão final no Google.

Nenhum teste desta correção autoriza ativação Calendar API/Cron, revoke real,
replay, migração de CRM ou deploy por si só.
