# Google Agenda: envio do Vimob

O Vimob é a origem dos compromissos. Criar, editar e excluir enfileira saída
para a conta Google do responsável. Não importamos eventos Google, não criamos
watch no callback e não convidamos participantes Vimob. Conectar não envia
histórico. Eventos já enviados permanecem no Google após desconectar.

## Gate e acesso

Novas conexões ficam bloqueadas por padrão. GOOGLE_CALENDAR_CONNECT_MODE
aceita disabled, pilot ou all. Pilot exige UUID Vimob em
GOOGLE_CALENDAR_PILOT_USER_IDS e capacidade efetiva de Agenda: associação ativa,
billing, módulo e schedule_manage. O callback revalida capacidade e gate.
All exige liberação explícita, além de audiência/verificação Google adequada.
Status e desconexão continuam disponíveis para contas existentes.
Web/PWA usa retorno web de mesma origem; app nativo exige teste separado.

## Estado observado em 12/10/2026

- Status OAuth 200 com can_use_schedule=true, can_connect=false e
  GOOGLE_CALENDAR_CONNECT_DISABLED. O antigo 404 não é o resultado atual.
  GET do handler sync responde 405: rota existente, sem processamento de fila.
- Google Calendar API desativada; público Externo/Testando, uma conta de teste.
- Uma conexão ativa em erro, sem last_synced_at; 24 dead pulls legados,
  nenhum outbound; dois vínculos e quatro canais vencidos.
- Nenhum Cron Google. Cron secret existe; sync base URL não existe no Vault.
  O invoker SQL instalado usa URL literal: a chave ausente não é bloqueio
  isolado atual, mas diverge do arquivo SQL-base local.
- FK de vínculos SET NULL e claims sem EXECUTE anon/auth já presentes.
- Helpers Vault/desconexão SECURITY DEFINER tinham EXECUTE anon/auth sem guard
  interno. P0 comprovado por catálogo, sem ler token, invocar helper ou provar
  exploração. RLS das tabelas só tinha RESTRICTIVE, sem PERMISSIVE:
  grants amplos não provaram leitura de linhas. Produção permanece sem correção.
- API Go release ef1cefca6faa59a78fd2aecbbecbf31ed1030c4b sem diff Google
  contra o checkout. Hashes Edge efetivos não foram comparados.

## Candidato local, ainda não aplicado/publicado

A migração 20261012212128_harden_google_calendar_outbound_protocol.sql revoga
PUBLIC/anon/auth nos helpers e tabelas Google, mantém serviço autorizado,
acrescenta guard de role, claim v2, heartbeat/finalização com dono de lease,
terminalização de upserts comprovadamente obsoletos e protocolo de disconnect.
Finish RPC também grava erros event/link/conta na mesma transação fenced;
resposta antiga de uma falha não repinta o card após retry bem-sucedido.
Não ativa OAuth, API Google, Cron ou entrada Google.

Claim v2 admite um job por compromisso/organização, serializando somente SQL
curto, sem transação aberta durante rede. HTTP é limitado; PATCH/DELETE usa
If-Match Google. Versão local concorrente ou 412 devolve o job à fila para
reconstruir a versão atual; sucesso de snapshot antigo não encerra o envio.
Aliases de envio manual também enfileiram, sem bypass de claim.
Retry diferencia permanente/transitório, usa backoff exponencial, jitter e
Retry-After. Jobs dead válidos continuam exigindo revisão operacional.

OAuth exige Calendar scope realmente concedido e access/refresh token antes
de escrever Vault/conexão. Disconnect prepara o banco com o mesmo row lock
curto do insert outbox. Enquanto revoga, um comando CRM com saída Google falha
com 55P03 controlado e reverte a transação; o Go candidato responde 409 para
repetir depois, preservando intenção caso revoke falhe. Falha Google preserva
token, desfaz preparação e informa atenção. Outra desconexão simultânea não
compartilha o marker. Crash após preparação requer revisão operacional antes
de remover marker; não existe expiração automática que libere duas revogações.
Cópias sem identidade
Vimob válida continuam exigindo revisão antes de atualização/remoção.

GOOGLE_CALENDAR_IMMEDIATE_DISPATCH_ENABLED permanece false por padrão.
Wake-up após commit não substitui Cron/retry. Status 200, fila e teste local
não comprovam entrega Google.

## Validação e liberação

Roteiro: deploy/supabase-self-hosted/google-calendar-release-readiness.md.
Migration-first com pausa/drenagem do worker Edge antigo; producers Go são
compatíveis pelo trigger. Não reaplicar baseline/sweep ou db push em lote.
Regressões google-calendar-delivery.test.ts extraem funções reais com mocks:
V1 tardia não substitui V2; snapshot já aceito retorna queued e retry repara;
OAuth parcial não grava; lease perdido não envia; revoke 503 mantém token.
Falha antiga com resposta atrasada após retry do mesmo job não regrava erro.
O teste SQL usa database descartável, duas organizações e grants/claim/fencing/
disconnect reais. Nenhuma fixture deve rodar em CRM existente ou produção.
Em 12/10/2026 passou em PostgreSQL 18.6 WASM, PGlite 0.5.9 em memória,
com authenticator/service_role reais, guard negativo mesmo com grant acidental,
owner transfer de job dead e bloqueio de insert de outro tenant.
SQL também prova rollback integral se gravar erro falhar e nega repaint por
worker antigo; erros de delete respeitam org/conexão do vínculo. Isso não prova
Postgres 17/Supabase completo nem execução concorrente de duas réplicas.
O Docker descartável ficou indisponível; nenhum banco CRM foi usado no teste.
O Go candidato marca pending somente quando INSERT RETURNING confirma job.
Producers Go anteriores aceitam o SQL aditivo, mas devem ser atualizados antes
de retomar para manter status coerente quando falta token/conexão, e comunicar
409 no conflito insert/desconexão. O SQL reverte CRM mesmo com Go anterior.
O shared legado permanece acima do limite usual de linhas. A política nova
de HTTP/retry/OAuth está isolada em google-calendar-delivery.ts; a separação
posterior de OAuth, provider/worker e entrada legada requer revisão própria,
sem refatorar consumidores incidentais durante este corte de segurança.

Antes de liberar, corrigir grants no alvo autorizado, validar hashes/cliente/
redirect/audiência, ativar API Google sob autorização, preparar piloto, revisar
fila/destino SQL e Cron somente de saída. Depois testar create/edit/delete,
concorrência, recorrência, all-day, owner transfer e revogação com conta
controlada e medir IDs/versão/atraso no Google. OAuth Testing com Calendar tem
refresh de sete dias: não anunciar liberação geral nesse estado.
# Fechamento da segunda auditoria — candidato local

Além da migration `20261012212128`, este candidato exige a forward
`20261013000127_harden_google_calendar_activation_status_and_export.sql`.
Nenhuma delas foi aplicada a CRM/produção por este trabalho. O snapshot de
configuração/filas registrado anteriormente não foi revalidado por estas
correções locais.

- OAuth salva Vault e ativa a conexão na mesma transação curta, após CAS de
  `credential_revision`. Prepare/abort/finalize disconnect invalidam snapshots
  de credencial; metadata e access-token rotation não invalidam consentimento.
- Refresh grava através de CAS de revisão/ref. Não repinta invalid_grant fora
  do finish. O fluxo autenticado de disconnect usa snapshot fresco e uma flag
  explícita para renovar token de canal legado; workers comuns permanecem
  bloqueados sob o marker. A flag e o contexto de lease sobrevivem ao 401.
- Claim v2 captura a revisão da credencial. Um resultado do grant anterior,
  mesmo com lease válido, volta à fila sem consumir retry/repintar erros após
  reconexão. Reconnect não descarta nem reenvia dead intents automaticamente.
- O agregado de status é derivado em SQL da fila atual, sob lock de conexão,
  incluindo finish de todos os outcomes e ativação OAuth. Edge não envia um
  snapshot antigo de erro para persistir. Último sync é monotônico.
- PATCH envia `null` para descrição/local removidos; o cleanup tardio passa o
  etag recebido também após perda de dono entre link e metadata.
- Lead export usa scope atual do dono: defaults, grants ativos, overrides,
  wildcard, equipe e membership_generation. Participar do evento não concede
  acesso ao lead. Sem scope, texto e `lead_id` são omitidos; `property_id` não
  sai sem autorização própria. Nenhum invite/pull/watch é habilitado.

Ordem dos locks: mutation Go event→links/FK→connection; finish
event→links aplicáveis→connection→job, com rechecks de binding/lease; disconnect
connection→jobs, sem lock/write de eventos/links; claim locks jobs e só lê
eventos/conexões por MVCC; activation/refresh connection→Vault; agregado
connection e leitura MVCC da fila. HTTP permanece fora dos locks.

Checks persistentes: `node scripts/supabase/check-google-calendar.mjs` faz
strict semantic check dos quatro entrypoints completos/imports com TypeScript
e tipos reais da versão instalada de supabase-js. Ambient Deno env/serve é
fornecido em memória; não substitui `deno check` no runtime alvo.
`google-calendar-lifecycle.test.ts` cobre os ramos da segunda rodada.
`node scripts/supabase/test-google-calendar-lifecycle-sql.mjs <caminho-absoluto-para-PGlite-dist/index.js>`
sempre usa banco novo memory://; não aceita database URL. Fixture SQL também
pode ser executada por psql somente contra banco descartável novo.

Para release, drenar workers **e callbacks/refresh antigos**, aplicar a forward
sob revisão, publicar API/Web/Edge compatíveis, validar PostgreSQL 17 alvo,
duas sessões/réplicas (inclusive ciclo de locks), e canário autorizado Web/PWA
de uma conta. Testes sintéticos/PG18.6 WASM não provam Google real nem carga.
