# Cutover de identidade de lead por fila e vínculo do WhatsApp

Este roteiro é forward-only e fail-closed. Ele não autoriza executar SQL nem
deploy por si só. Registre backup/PITR, operador, horários, SHA e a saída completa
de cada preflight/readback no ticket da implantação.

## Gates de entrada

Antes de qualquer write remoto:

1. Use um checkout limpo no SHA imutável aprovado. `git status --short` deve
   estar vazio e `git rev-parse HEAD` deve produzir o SHA que será implantado.
2. Confirme que o histórico remoto de migrations corresponde ao repositório.
   Não use `db push` cego e não marque versões manualmente para esconder drift.
3. Confirme backup/PITR restaurável e uma janela sem outra alteração de schema.
4. Antes de A1, pause **todo intake que cria ou registra reentrada de lead**:
   Meta, WhatsApp, portais, webhooks genéricos, contato público/site e qualquer
   importação ativa. Onde existir inbox durável, mantenha apenas a captura bruta
   e pare o processor; onde não houver replay comprovado, faça o endpoint falhar
   de forma retryable/upstream-paused, nunca aceite e descarte silenciosamente.
   Registre o instante UTC e os watermarks/contagens por fonte. O intake deve
   permanecer quiescido até B2 e os canários finais terminarem.
5. Depois de pelo menos dois ciclos máximos dos processors, prove nos logs e no
   banco que não houve criação/reentrada automatizada posterior ao instante de
   quiesce. Esta consulta é uma evidência complementar; compare também os
   watermarks por fonte, porque writers legados podem não registrar evento:

```sql
select 'leads_created_after_quiesce' as metric, count(*) as rows
from public.leads
where created_at >= :'intake_quiesced_at'
union all
select 'lead_entries_after_quiesce', count(*)
from public.lead_entry_events
where created_at >= :'intake_quiesced_at';
```

Somente canários explicitamente registrados podem aparecer. Se qualquer intake
real atravessar a janela A1-fences-tombstone-availability-A2-app-B1-B2, pare: enquanto o índice global existe,
uma entrada da fila B seria consolidada como reentrada no card A e a
contabilização ficaria permanentemente incorreta. Este rollout não implementa
shadow capture/replay para corrigir isso depois.

6. Meça, sem mutar dados, o volume que A1 precisará congelar:

```sql
select 'linked_messages_without_snapshot' as metric, count(*) as rows
from public.whatsapp_messages as message
join public.whatsapp_conversations as conversation
  on conversation.id = message.conversation_id
 and conversation.organization_id = message.organization_id
where message.lead_id is null
  and conversation.lead_id is not null
  and not (
    message.from_me is false
    and coalesce(message.metadata, '{}'::jsonb) @>
      '{"lead_resolution_quarantine":{"terminal":true,"retryable":false}}'::jsonb
    and nullif(btrim(coalesce(
      message.metadata #>> '{lead_resolution_quarantine,reason}', ''
    )), '') is not null
    and coalesce(message.metadata->>'source', '') = 'evolution_go_webhook'
    and coalesce(
      nullif(btrim(message.provider_message_id), ''),
      nullif(btrim(message.message_id), '')
    ) is not null
  )
union all
select 'terminal_quarantine_messages_without_snapshot', count(*)
from public.whatsapp_messages as message
join public.whatsapp_conversations as conversation
  on conversation.id = message.conversation_id
 and conversation.organization_id = message.organization_id
where message.lead_id is null
  and conversation.lead_id is not null
  and message.from_me is false
  and coalesce(message.metadata, '{}'::jsonb) @>
    '{"lead_resolution_quarantine":{"terminal":true,"retryable":false}}'::jsonb
  and nullif(btrim(coalesce(
    message.metadata #>> '{lead_resolution_quarantine,reason}', ''
  )), '') is not null
  and coalesce(message.metadata->>'source', '') = 'evolution_go_webhook'
  and coalesce(
    nullif(btrim(message.provider_message_id), ''),
    nullif(btrim(message.message_id), '')
  ) is not null
union all
select 'linked_inbound_logs_without_snapshot', count(*)
from public.whatsapp_inbound_logs as inbound_log
join public.whatsapp_conversations as conversation
  on conversation.id = inbound_log.conversation_id
 and conversation.organization_id = inbound_log.organization_id
where inbound_log.lead_id is null
  and conversation.lead_id is not null
union all
select 'active_legacy_outbox_before_snapshot_column', count(*)
from public.outbox_messages as outbox
where outbox.status in ('pending', 'processing');
```

Se o volume não couber com margem no `statement_timeout` de A1, pare. Particione
o backfill em uma mudança revisada; não aumente o timeout improvisadamente em
produção. Antes de A1, `public.outbox_messages.lead_id` ainda não existe; por
isso o preflight trata conservadoramente **todo** outbox ativo como linha que A1
precisará congelar. Não acrescente um filtro nessa coluna antes da migration.

7. Meça também o backlog aceito sem snapshot imutável de roteamento. Esses
eventos são anteriores ao writer compatível e não podem herdar o vínculo que
estiver ativo somente quando o worker finalmente os processar:

```sql
select status, processing_lane, count(*) as rows,
       min(created_at) as oldest_created_at,
       max(created_at) as newest_created_at
from public.whatsapp_webhook_inbox
where status in ('pending', 'retry', 'processing')
  and coalesce(payload #>> '{__vimob_ingress,routing_snapshot,version}', '') <> '1'
group by status, processing_lane
order by status, processing_lane;
```

Registre os IDs/watermarks. Durante toda a janela, proíba também relink manual
de conversa. Drene somente eventos cuja atribuição histórica possa ser provada
por `provider_message_id` já persistido ou pelo ledger; qualquer restante sem
prova deve ser movido para `dead` por um procedimento de quarentena revisado,
com motivo auditável, sem executar efeitos. Não faça backfill escolhendo o
`lead_id` atual da conversa. B1 aborta enquanto sobrar qualquer linha ativa sem
snapshot v1.

## Sequência obrigatória

### 1. A1 aditiva

Com todo intake ainda quiescido, aplique, pelo mecanismo aprovado de migrations,
somente:

`supabase/migrations/20260919181318_queue_scoped_lead_identity_and_whatsapp_binding.sql`

A1 mantém `public.leads_org_phone_unique`, portanto o comportamento efetivo
ainda é globalmente único durante a janela de rollout. Ela adiciona o contrato
escopado, congela atribuições históricas, instala o ledger/RPC e preserva
compatibilidade com writers antigos. Ela não materializa bindings ativos em
massa; isso evita drift enquanto código antigo ainda pode atualizar a conversa.
Depois que existir um binding ativo, um constraint trigger diferido rejeita no
commit qualquer writer antigo/direto que deixe `whatsapp_conversations` em
divergência. Ausência de binding continua compatível durante a janela.

Readback mínimo:

```sql
select
  pg_catalog.to_regclass('public.whatsapp_conversation_lead_bindings') as binding_table,
  pg_catalog.to_regprocedure(
    'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text)'
  ) as binding_rpc,
  pg_catalog.to_regprocedure(
    'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text,text)'
  ) as manual_binding_cas_rpc,
  pg_catalog.to_regprocedure(
    'public.activate_whatsapp_conversation_lead_binding_if_current(uuid,uuid,uuid,text,uuid,uuid)'
  ) as intake_binding_cas_rpc,
  pg_catalog.to_regprocedure(
    'public.upsert_whatsapp_webhook_lead(uuid,text,text,text,text,timestamp with time zone,text,uuid,text,text,text,uuid,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,timestamp with time zone,text,timestamp with time zone,jsonb,uuid)'
  ) as queue_aware_upsert,
  pg_catalog.to_regprocedure(
    'private.is_terminal_whatsapp_lead_resolution_quarantine(jsonb,boolean,text,text)'
  ) as terminal_quarantine_contract,
  pg_catalog.to_regclass(
    'public.whatsapp_webhook_routing_snapshots'
  ) as routing_snapshot_ledger,
  pg_catalog.to_regclass(
    'public.whatsapp_webhook_routing_outcomes'
  ) as routing_outcome_ledger,
  pg_catalog.to_regclass(
    'public.whatsapp_conversation_routing_heads'
  ) as applied_routing_heads,
  pg_catalog.to_regprocedure(
    'private.capture_whatsapp_webhook_routing_snapshot(uuid,uuid,text,text,text,text,boolean,text[],text,text,text,boolean,boolean,boolean,uuid,uuid,uuid)'
  ) as pre_ack_capture_rpc,
  pg_catalog.to_regprocedure(
    'public.resolve_whatsapp_webhook_inherited_routing_target(uuid,uuid,text)'
  ) as inherited_target_rpc,
  pg_catalog.to_regprocedure(
    'private.cleanup_whatsapp_webhook_routing_provenance(integer,timestamp with time zone)'
  ) as provenance_retention_rpc,
  pg_catalog.to_regclass('public.leads_org_phone_unique') as legacy_unique_index;
```

Todos os valores devem ser não nulos. Não prossiga se o backfill de mensagens,
inbound ou outbox falhar.

### 1.1. Fences de automação dependentes da A1

Sem retomar intake, workers ou relink manual, aplique imediatamente depois da
A1 e antes de A2 ou de qualquer réplica da aplicação:

`supabase/migrations/20260919232152_harden_automation_whatsapp_binding_fences.sql`

Essa migration substitui apenas os três RPCs de automação que dependem do
binding canônico instalado pela A1. Ela serializa resolver/enqueue/claim pela
conversa antes das linhas dependentes, exige o epoch de binding exato e torna
eventos stale terminais. Não prossiga com uma definição parcial ou sem os três
marcadores abaixo.

Readback obrigatório:

```sql
select
  pg_catalog.obj_description(
    'public.resolve_automation_whatsapp_conversation(uuid,uuid,text,text,uuid)'::pg_catalog.regprocedure,
    'pg_proc'
  ) as resolver_binding_fence_version,
  pg_catalog.obj_description(
    'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::pg_catalog.regprocedure,
    'pg_proc'
  ) as enqueue_binding_fence_version,
  pg_catalog.obj_description(
    'public.claim_automation_events(text,integer)'::pg_catalog.regprocedure,
    'pg_proc'
  ) as claim_binding_epoch_version;
```

Os dois primeiros valores devem iniciar com
`automation_whatsapp_binding_fence_v2:` e o terceiro com
`automation_event_binding_epoch_v2:`. Qualquer valor nulo ou prefixo diferente
é gate de parada.

### 1.2. Tombstone da fila e fence do snapshot pré-ACK

Ainda com intake, processors e relink manual parados, aplique antes de A2 e,
obrigatoriamente, antes de qualquer réplica nova da API:

`supabase/migrations/20260920012629_preserve_deleted_round_robin_identity.sql`

O código compatível consulta `public.round_robins.deleted_at`; inverter essa
ordem quebra List/Get/Delete. A migration preserva o UUID da fila como
identidade inerte, congela o destino do intake, esconde tombstones da UI e
impede hard-delete/ressurreição. `service_role` perde `DELETE`/`TRUNCATE` direto
na fila, um trigger `ENABLE ALWAYS` bloqueia `TRUNCATE` de manutenção e a
auditoria continua registrando mutações ordinárias sem impedir o `CASCADE`
legítimo da organização inteira. Ela também serializa o snapshot managed gravado
no ACK com Delete: enquanto houver snapshot aceito sem outcome terminal —
inclusive inbox `dead` ainda não reconciliada — Delete deve retornar conflito e
preservar fila e regras. Não trate esse conflito como autorização para apagar a
proveniência ou fabricar um outcome; reprocessar/reconciliar o evento é o único
caminho de liberação.

Readback obrigatório:

```sql
select
  attribute.attname as column_name,
  pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as type_name,
  attribute.attnotnull as not_null,
  pg_catalog.pg_get_expr(attribute_default.adbin, attribute_default.adrelid) as default_expression
from pg_catalog.pg_attribute as attribute
left join pg_catalog.pg_attrdef as attribute_default
  on attribute_default.adrelid = attribute.attrelid
 and attribute_default.adnum = attribute.attnum
where attribute.attrelid = 'public.round_robins'::regclass
  and attribute.attname in (
    'deleted_at', 'tombstone_pipeline_id', 'tombstone_stage_id'
  )
  and not attribute.attisdropped
order by attribute.attname;

select
  pg_catalog.obj_description(
    'private.sync_round_robin_contract()'::regprocedure,
    'pg_proc'
  ) as synchronizer_fence,
  pg_catalog.to_regclass(
    'public.idx_round_robins_live_organization_created'
  ) as live_queue_index,
  pg_catalog.to_regclass(
    'public.idx_whatsapp_routing_snapshots_managed_queue'
  ) as managed_snapshot_queue_index;

select
  trigger.tgrelid::regclass as relation_name,
  trigger.tgname,
  pg_catalog.pg_get_triggerdef(trigger.oid, true) as definition
from pg_catalog.pg_trigger as trigger
where not trigger.tgisinternal
  and trigger.tgname in (
    'guard_round_robin_tombstone_state',
    'guard_round_robin_hard_delete',
    'guard_round_robin_truncate',
    'hydrate_round_robin_destination_before_lead_insert',
    'guard_managed_whatsapp_snapshot_queue',
    'guard_00_round_robin_pending_intake',
    'guard_live_round_robin_pipeline_reference',
    'guard_live_round_robin_portal_reference',
    'guard_live_round_robin_meta_form_reference',
    'guard_live_round_robin_whatsapp_reference',
    'guard_live_round_robin_redistribution_job',
    'guard_live_round_robin_member',
    'guard_live_round_robin_rule'
  )
order by trigger.tgrelid::regclass::text, trigger.tgname;

select
  function_definition.prosecdef as security_definer,
  function_definition.provolatile as volatility,
  function_definition.proconfig,
  owner_role.rolname as owner_role,
  owner_role.rolbypassrls as owner_bypasses_rls,
  pg_catalog.obj_description(
    function_definition.oid,
    'pg_proc'
  ) as contract_marker,
  pg_catalog.has_function_privilege(
    'service_role',
    function_definition.oid,
    'execute'
  ) as service_role_can_execute,
  pg_catalog.has_function_privilege(
    'authenticated',
    function_definition.oid,
    'execute'
  ) as authenticated_can_execute,
  pg_catalog.has_function_privilege(
    'anon',
    function_definition.oid,
    'execute'
  ) as anon_can_execute,
  pg_catalog.has_function_privilege(
    'public',
    function_definition.oid,
    'execute'
  ) as public_can_execute
from pg_catalog.pg_proc as function_definition
join pg_catalog.pg_roles as owner_role
  on owner_role.oid = function_definition.proowner
where function_definition.oid =
  'private.write_audit_log_for_row()'::regprocedure;

select
  trigger.tgrelid::regclass as relation_name,
  trigger.tgname,
  trigger.tgtype,
  trigger.tgenabled
from pg_catalog.pg_trigger as trigger
where trigger.tgfoid =
    'private.write_audit_log_for_row()'::regprocedure
  and not trigger.tgisinternal
order by trigger.tgrelid::regclass::text, trigger.tgname;

select checked_role.role_name, checked_table.table_name,
       checked_privilege.privilege_name,
       pg_catalog.has_table_privilege(
         checked_role.role_name,
         checked_table.table_name,
         checked_privilege.privilege_name
       ) as still_granted
from (values ('anon'::text), ('authenticated'::text))
  as checked_role(role_name)
cross join (
  values
    ('public.round_robins'::text),
    ('public.round_robin_rules'::text),
    ('public.round_robin_members'::text),
    ('public.whatsapp_inbound_rules'::text)
) as checked_table(table_name)
cross join (
  values ('INSERT'::text), ('UPDATE'::text),
         ('DELETE'::text), ('TRUNCATE'::text)
) as checked_privilege(privilege_name)
order by checked_role.role_name, checked_table.table_name,
         checked_privilege.privilege_name;

select
  pg_catalog.has_table_privilege(
    'service_role',
    'public.round_robins',
    'DELETE'
  ) as service_role_can_delete_queue,
  pg_catalog.has_table_privilege(
    'service_role',
    'public.round_robins',
    'TRUNCATE'
  ) as service_role_can_truncate_queue;

select
  policyname, permissive, cmd, roles, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename = 'round_robins'
  and policyname = 'vimob_round_robins_live_rows_only';

select count(*) as unresolved_managed_queue_snapshots
from public.whatsapp_webhook_routing_snapshots as routing_snapshot
left join public.whatsapp_webhook_routing_outcomes as routing_outcome
  on routing_outcome.organization_id = routing_snapshot.organization_id
 and routing_outcome.session_id = routing_snapshot.session_id
 and routing_outcome.provider_message_id = routing_snapshot.provider_message_id
 and routing_outcome.ingress_sequence = routing_snapshot.ingress_sequence
where routing_snapshot.snapshot @>
    '{"managed_message_distribution":true}'::jsonb
  and routing_outcome.provider_message_id is null
  and (
    routing_snapshot.binding_eligible
    or exists (
      select 1
      from public.whatsapp_webhook_inbox as inbox
      where inbox.organization_id = routing_snapshot.organization_id
        and inbox.session_id = routing_snapshot.session_id
        and inbox.event_key = routing_snapshot.inbox_event_key
        and inbox.status in ('pending', 'retry', 'processing', 'dead')
    )
  );
```

As três colunas devem ser anuláveis, sem default, com tipos respectivamente
`timestamp with time zone`, `uuid`, `uuid`; o marcador do synchronizer deve ser
`round_robin_tombstone_aware_v1`; os dois índices e os quinze triggers de guard
devem existir com as definições esperadas. A função genérica de auditoria deve
ser `SECURITY DEFINER`, `VOLATILE`, `search_path=""`, pertencer a um owner com
`BYPASSRLS`, expor o marcador `audit_org_cascade_safe_v1`, permitir execução
somente ao `service_role` entre `service_role`, `authenticated`, `anon` e
`PUBLIC`, e manter os sete triggers
de auditoria habilitados. A policy deve ser `RESTRICTIVE/ALL` para
`anon,authenticated`; todas as 32 linhas do readback de privilégios devem
mostrar `still_granted = false`, e os dois privilégios destrutivos de
`service_role` também devem ser `false`. O último contador deve ser zero antes do
deploy. Se não for, mantenha o corte parado e reconcilie/reprocesse os eventos
até que outcomes reais sejam publicados.

Um inbox `dead` sem outcome continua sendo trabalho não concluído e bloqueia a
mutação da fila. O provider não cria uma nova tentativa: o mesmo `event_key`
resolve para a linha terminal existente. Se a causa já foi corrigida e a
reexecução foi aprovada, use o procedimento abaixo **somente com intake e
processors quiescidos**, preenchendo os quatro identificadores a partir do
readback. Ele preserva integralmente `payload`, `event_key`, timestamps de
ingresso e o snapshot; não insira outcome manualmente.

```sql
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Inspeção humana obrigatória antes do UPDATE. Confirme snapshot v1, tenant,
-- sessão, provider id e que não existe outcome terminal correspondente.
select inbox.id, inbox.organization_id, inbox.session_id, inbox.event_key,
       inbox.status, inbox.attempts, inbox.last_error,
       inbox.payload #> '{__vimob_ingress,routing_snapshot}' as routing_snapshot
from public.whatsapp_webhook_inbox as inbox
where inbox.id = :'dead_inbox_id'::uuid
  and inbox.organization_id = :'organization_id'::uuid
  and inbox.session_id = :'session_id'::uuid
  and inbox.event_key = :'event_key'
for update;

with eligible as materialized (
  select inbox.id
  from public.whatsapp_webhook_inbox as inbox
  where inbox.id = :'dead_inbox_id'::uuid
    and inbox.organization_id = :'organization_id'::uuid
    and inbox.session_id = :'session_id'::uuid
    and inbox.event_key = :'event_key'
    and inbox.status = 'dead'
    and coalesce(
      inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}',
      ''
    ) = '1'
    and exists (
      select 1
      from public.whatsapp_webhook_routing_snapshots as routing_snapshot
      where routing_snapshot.organization_id = inbox.organization_id
        and routing_snapshot.session_id = inbox.session_id
        and routing_snapshot.inbox_event_key = inbox.event_key
        and not exists (
          select 1
          from public.whatsapp_webhook_routing_outcomes as routing_outcome
          where routing_outcome.organization_id = routing_snapshot.organization_id
            and routing_outcome.session_id = routing_snapshot.session_id
            and routing_outcome.provider_message_id =
              routing_snapshot.provider_message_id
            and routing_outcome.ingress_sequence =
              routing_snapshot.ingress_sequence
        )
    )
  for update
), retried as (
  update public.whatsapp_webhook_inbox as inbox
  set status = 'retry',
      attempts = 0,
      next_attempt_at = now(),
      locked_at = null,
      locked_by = null,
      last_error = null,
      processed_at = null,
      dead_lettered_at = null,
      updated_at = now()
  from eligible
  where inbox.id = eligible.id
  returning inbox.id
)
select 1 / count(*)::int as exactly_one_requeued
from retried;

commit;
```

Retome apenas o worker desse lane, aguarde o outcome real, pare-o novamente e
repita o contador `unresolved_managed_queue_snapshots`. Se a linha voltar a
`dead`, preserve-a e investigue; não repita automaticamente, não altere o
payload e não libere a fila criando outcome sintético.

### 1.3. Disponibilidade canônica da distribuição

Ainda com o intake parado, depois da migration de tombstone e antes de A2 ou de
qualquer réplica nova da API, aplique:

`supabase/migrations/20260920022237_harden_canonical_distribution_availability.sql`

Essa migration não altera o ticket nem o IWRR. Ela alinha somente a elegibilidade
por horário do picker canônico com a API: membro direto herda a agenda de qualquer
membership ativa em equipe ativa; membership vinculada continua exata; uma semana
configurada e toda desativada falha fechada; e uma faixa que cruza meia-noite usa
o dia inicial antes da meia-noite e o dia anterior depois dela. Os limites são
inclusivos: em `22:00-08:00`, `22:00` e `08:00` entram, `08:00:01` não entra.
O dia e a hora entregues ao picker já são calculados por
`private.distribute_lead` no fuso da fila, depois no fuso da organização e, por
último, em `America/Sao_Paulo`.

Readback obrigatório:

```sql
select
  procedure.oid::regprocedure as function_name,
  procedure.prosecdef as security_definer,
  procedure.provolatile as volatility,
  procedure.proconfig,
  lower(procedure.prosrc) like
    '%availability.day_of_week = (p_current_day + 6) % 7%'
    as has_previous_day_overnight_carry,
  lower(procedure.prosrc) like
    '%from public.team_members as availability_member%'
    as has_direct_membership_schedule_scope
from pg_catalog.pg_proc as procedure
where procedure.oid =
  'private.pick_round_robin_ticket_candidate(uuid,uuid,text,boolean,integer,time without time zone,bigint)'::regprocedure;

select checked_role.role_name,
       pg_catalog.has_function_privilege(
         checked_role.role_name,
         'private.pick_round_robin_ticket_candidate(uuid,uuid,text,boolean,integer,time without time zone,bigint)',
         'EXECUTE'
       ) as can_execute
from (values ('public'::text), ('anon'::text),
             ('authenticated'::text), ('service_role'::text))
  as checked_role(role_name)
order by checked_role.role_name;
```

O primeiro readback deve retornar uma linha com `security_definer = true`,
`volatility = s`, `search_path=""` em `proconfig` e os dois marcadores de
semântica verdadeiros. As quatro linhas de privilégio devem retornar
`can_execute = false`; o picker continua acessível somente pelo fluxo canônico
interno. Qualquer divergência é gate de parada.

### Caminho online sem pausar produção

Use este caminho somente com a migration
`20260920080434_freeze_legacy_whatsapp_ingress_for_online_cutover.sql`
aplicada e depois de provar que todas as réplicas executam o mesmo SHA cujo
worker só reivindica inbox com `routing_snapshot.version = 1`. Não pare API,
intake ou workers e não altere/reenvie o backlog antigo.

Primeiro registre exatamente as linhas legadas ainda ativas. O script não muda
status, payload, tentativas ou datas da inbox; ele instala uma trava que preserva
essas linhas e exige snapshot v1 em toda entrada nova:

```powershell
psql $vimobDatabaseUrl -X `
  -v "app_ready_release=$vimobReleaseSha" `
  -v "app_smoke_confirmed=true" `
  -f supabase/cutovers/20260920_freeze_legacy_whatsapp_ingress_online.sql
```

Se existir lease legado em `processing`, aguarde-o terminar naturalmente e
repita. Não pause o worker. Depois execute A2, B1 e B2 com a mesma prova online:

```powershell
psql $vimobDatabaseUrl -X `
  -v "online_legacy_freeze=true" `
  -f supabase/cutovers/20260919_prepare_queue_scoped_lead_online_indexes.sql

psql $vimobDatabaseUrl -X `
  -v "app_ready_release=$vimobReleaseSha" `
  -v "app_smoke_confirmed=true" `
  -v "workers_quiesced=false" `
  -v "intake_quiesced=false" `
  -v "online_legacy_freeze=true" `
  -f supabase/cutovers/20260919_enable_strict_whatsapp_message_binding.sql

psql $vimobDatabaseUrl -X `
  -v "app_ready_release=$vimobReleaseSha" `
  -v "app_smoke_confirmed=true" `
  -v "intake_quiesced=false" `
  -v "online_legacy_freeze=true" `
  -f supabase/cutovers/20260919_retire_legacy_global_lead_phone_index.sql
```

A2 e B2 usam operações `CONCURRENTLY`. B1 toma locks finais com timeout de cinco
segundos; se houver atividade incompatível em voo, ele aborta a transação inteira
e deve ser repetido. O intake continua ativo durante todo o processo.

### 2. A2 índice escopado online

Em uma conexão dedicada do `psql`, com autocommit habilitado:

```powershell
$vimobDatabaseUrl = '<production-direct-postgres-url>'
psql $vimobDatabaseUrl -X `
  -v "intake_quiesced=true" `
  -f supabase/cutovers/20260919_prepare_queue_scoped_lead_online_indexes.sql
```

O arquivo prova que A1 e o índice global continuam válidos, falha se houver
duplicatas escopadas, cria `public.leads_org_scope_phone_unique` com
`CONCURRENTLY`, cria também o índice parcial da proveniência ativa da outbox
legada sem bloquear writers e faz readback de validade. Código novo ainda não
deve depender da remoção do índice global.

### 3. Deploy compatível

Com o intake ainda quiescido, implante API e Web a partir do mesmo SHA
imutável. No runtime Edge self-hosted, publique **somente** a função ativa e
necessária `evolution-go-webhook`, preservando o roteador/manifesto real de
produção e seu allowlist. Não use o manifesto local mais amplo como autorização
para reativar `ai-agent-responder`, `calculate-first-response`,
`evolution-webhook`, `threecplus-webhook` nem qualquer snapshot antigo do
ambiente cloud. Não
misture réplicas antigas e novas durante o corte. Drene as réplicas antigas da
API/worker; o constraint de A1
falha fechado, mas uma réplica antiga ainda poderia receber erro depois que uma
réplica nova criasse o primeiro binding. Não retome o intake nessa etapa, mesmo
quando todas as réplicas escritoras reportarem o SHA novo. Antes de atestar o gate:

- o preflight de schema da API deve aceitar o contrato compatível de A1 antes
  de B1 (`TestEvolutionWebhookSchemaCompatibilityRequiresPreB1LiveLaneContract`):
  ele valida colunas, funções de routing e índices fair-claim, mas não pode
  exigir antecipadamente o constraint estrito
  `whatsapp_webhook_active_routing_snapshot_v1_check`, criado somente no passo 4;
- o intake deve sempre enviar a fila ao overload novo quando houver fila;
- a compatibilidade enquanto o índice global existe deve resolver o card único
  existente como reentrada, sem erro 500 e sem criar card duplicado;
- todo link/relink deve usar o RPC canônico sob lock;
- cada callback persistido pela API deve conter
  `__vimob_ingress.routing_snapshot.version = 1`, criado depois da sanitização
  do payload do provedor e antes do ACK; a função Edge só pode confiar nesse
  envelope quando o request usar o contrato autenticado `internal_worker_lease`;
- a rota de scheduling pode ser `__session__` para serializar lote misto, mas
  cada mensagem 1:1 precisa ter `routing_key` próprio (`phone:` ou `jid:`),
  sequência e predecessor imutáveis no ledger;
- o worker só libera sucessor quando o predecessor está no mesmo envelope
  ordenado, quando a inbox original está `processed` ou quando existe outcome
  monotônico do provider id; sem uma dessas provas a claim permanece bloqueada;
- callbacks diretos de mensagem para Edge devem falhar de forma retryable e
  nunca aceitar um `__vimob_ingress` fornecido pelo provedor;
- todo writer de mensagem deve resolver a conversa canônica antes do insert e
  não depender do trigger legado que mudava `conversation_id` por sessão;
- inserts de mensagens e outboxes devem persistir o `lead_id` snapshot;
- readers devem filtrar mensagens pelo `lead_id`, sem fallback de histórico
  nulo para o lead atual;
- workers devem recusar snapshots antigos quando o binding atual já mudou;
- o replay de um provider message deve retornar o binding histórico sem trocar
  o binding atual.
- o readback do roteador/manifesto efetivamente carregado pelo runtime Edge deve
  provar `evolution-go-webhook` no novo digest e deve provar que
  `ai-agent-responder`, `calculate-first-response`, `evolution-webhook`,
  `threecplus-webhook` e diretórios `__snapshots__` continuam fora das rotas
  publicadas; no manifesto eles devem estar `RETIRED/RETIRED/NOT_ROUTABLE` e sem
  bloco executável em `supabase/config.toml`. Anexe inventário e readback HTTP
  ao ticket e coloque o release em HOLD se o allowlist real divergir.

Valide health/version de cada réplica, um canário de mesma fila, um replay
idempotente e um envio/recebimento controlado. Antes do passo 5 ainda é esperado
que filas diferentes conversem com a compatibilidade global; o canário que
prova cards diferentes acontece somente após a retirada do índice global.

Defina o SHA somente depois desses smokes:

```powershell
$vimobReleaseSha = '<40-character-deployed-git-sha>'
```

### 4. B1 vínculo estrito de mensagens

O bloco abaixo descreve o caminho legado com pausa integral. Para produção sem
pausa, use os comandos de **Caminho online sem pausar produção** acima; B1 exige
o ledger exato do legado congelado e ignora somente essas identidades imutáveis.

Pause temporariamente o ingresso e os workers que escrevem mensagens, outboxes,
IA e automações. Espere ou reconcilie todos os efeitos que já cruzaram a
fronteira externa; o resultado abaixo precisa ser zero em todas as linhas:

```sql
select 'whatsapp_outbox_processing' as metric, count(*) as rows
from public.whatsapp_outbox where status = 'processing'
union all
select 'legacy_outbox_processing', count(*)
from public.outbox_messages where status = 'processing'
union all
select 'conversation_ai_jobs_processing', count(*)
from public.ai_jobs where conversation_id is not null and status = 'processing'
union all
select 'whatsapp_autoreply_jobs_processing', count(*)
from public.jobs
where job_type = 'whatsapp_ai_autoreply' and status = 'processing'
union all
select 'ai_outbox_sending', count(*)
from public.ai_outbox_messages where status = 'sending'
union all
select 'conversation_automation_events_processing', count(*)
from public.automation_event_outbox
where conversation_id is not null and status = 'processing'
union all
select 'conversation_automations_running', count(*)
from public.automation_executions
where conversation_id is not null and status = 'running'
union all
select 'automation_effects_sending', count(*)
from public.automation_effect_dispatches as dispatch
join public.automation_executions as execution
  on execution.id = dispatch.execution_id
 and execution.organization_id = dispatch.organization_id
where execution.conversation_id is not null
  and dispatch.status = 'sending';
```

Prove separadamente que o backlog legado sem proveniência foi drenado ou
quarentenado; este resultado também precisa ser zero:

```sql
select count(*) as active_inbox_rows_without_routing_snapshot_v1
from public.whatsapp_webhook_inbox
where status in ('pending', 'retry', 'processing')
  and coalesce(payload #>> '{__vimob_ingress,routing_snapshot,version}', '') <> '1';
```

Se houver qualquer linha, não execute B1. Não altere o payload histórico para
fabricar o envelope: o trigger de A1 torna o snapshot imutável e B1 aceita
histórico antigo somente em estado terminal `processed`/`dead`.

Registre também estes dois zero-gates. O primeiro prova correspondência exata
entre payload ativo e ledger. O segundo detecta provenance binding-eligible
órfã, sem inbox e sem outcome:

```sql
select count(*) as active_payload_snapshots_without_exact_ledger
from public.whatsapp_webhook_inbox as inbox
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(
      inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
    ) = 'array'
      then inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
    else '[]'::jsonb
  end
) as payload_route(snapshot)
left join public.whatsapp_webhook_routing_snapshots as ledger
  on ledger.organization_id = inbox.organization_id
 and ledger.session_id = inbox.session_id
 and ledger.provider_message_id = payload_route.snapshot->>'provider_message_id'
 and ledger.snapshot = payload_route.snapshot
where inbox.status in ('pending', 'retry', 'processing')
  and ledger.provider_message_id is null;

select count(*) as unresolved_routing_snapshots_without_inbox_or_outcome
from public.whatsapp_webhook_routing_snapshots as ledger
where ledger.binding_eligible
  and not exists (
    select 1
    from public.whatsapp_webhook_routing_outcomes as outcome
    where outcome.organization_id = ledger.organization_id
      and outcome.session_id = ledger.session_id
      and outcome.provider_message_id = ledger.provider_message_id
      and outcome.ingress_sequence = ledger.ingress_sequence
  )
  and not exists (
    select 1
    from public.whatsapp_webhook_inbox as inbox
    where inbox.organization_id = ledger.organization_id
      and inbox.session_id = ledger.session_id
      and exists (
        select 1
        from jsonb_array_elements(
          case
            when jsonb_typeof(
              inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
            ) = 'array'
              then inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
            else '[]'::jsonb
          end
        ) as payload_route(snapshot)
        where payload_route.snapshot->>'provider_message_id' =
          ledger.provider_message_id
      )
  );
```

Ambos devem ser zero. Não crie inbox ou outcome manual para “corrigir” a
contagem; faça rollback/reconciliação auditada da transação defeituosa.

Mantenha-os pausados e execute B1 em uma conexão dedicada:

```powershell
psql $vimobDatabaseUrl -X `
  -v "app_ready_release=$vimobReleaseSha" `
  -v "app_smoke_confirmed=true" `
  -v "workers_quiesced=true" `
  -v "intake_quiesced=true" `
  -f supabase/cutovers/20260919_enable_strict_whatsapp_message_binding.sql
```

B1 materializa somente os bindings ausentes após o deploy, congela novamente a
janela A1-deploy e ativa os triggers estritos de mensagem e outbox. Ela adquire
locks curtos que falham se writers não estiverem realmente quiescidos; qualquer
binding divergente aborta a transação inteira. Um rebind individual também aborta com
`whatsapp_binding_switch_delivery_in_flight` enquanto houver efeito externo em
`processing`/`sending`; reconcilie o efeito e repita o rebind, nunca force a
troca.

B1 também exige que a fronteira backend-only já não tenha policy de escrita
para `anon`/`authenticated` e revoga atomicamente qualquer grant residual de
`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` em `whatsapp_messages`. Isso impede que um
cliente PostgREST fabrique os campos reservados de proveniência, quarentena ou
elegibilidade de automação; o `service_role` permanece como writer.

B1 também valida `whatsapp_webhook_active_routing_snapshot_v1_check`: depois do
cutover nenhuma linha pode entrar ou voltar a `pending`, `retry` ou `processing`
sem o envelope v1 capturado na mesma transação do ingresso.

O trigger canônico do outbox passa a validar toda inserção ativa e toda
reativação de estado terminal para `pending`, `retry` ou `processing`. Retry
manual só continua quando organização, sessão, conversa e mensagem coincidem e
o `message.lead_id` ainda é exatamente o lead da conversa e do único binding
ativo. As transições normais entre estados já ativos não repetem locks em ordem
inversa: a linha foi validada ao entrar no conjunto ativo, o claim concorre pela
própria linha e o rebind dead-lettera `pending`/`retry` ou rejeita
`processing`. Uma entrega terminal do lead A não pode ser reenfileirada depois
de A→B; a operação falha com
`canonical_whatsapp_outbox_message_lead_mismatch` e permanece terminal. A troca
de `message_id` continua permitida somente na reconciliação
provider-webhook-wins quando as duas mensagens têm a mesma
organização/sessão/conversa/lead e as identidades client/provider batem. O
worker pode mover a projeção mantendo o lease `processing`; um webhook assinado
também pode mover e terminalizar atomicamente uma linha `processing`, ou uma
linha `dead` cujo erro seja exatamente `provider_delivery_outcome_unknown`.
Qualquer outro `dead` permanece terminal. A identidade `client_message_id` é
transferida à projeção canônica antes da troca do outbox, e a projeção perdedora
só é apagada depois do fence validar o par. Essa terminalização não autoriza
novo envio nem troca de card e pode apenas registrar no card histórico o
resultado externo já comprovado.

A promoção LID atualiza a rota futura da conversa e o mapa de aliases, mas não
reescreve `whatsapp_messages.remote_jid`: esse valor é evidência imutável da
identidade que o provider entregou naquele evento.

Readback obrigatório após B1 (inclua o overload manual CAS no primeiro bloco de
readback da A1; ele também é gateado por B1 e B2):

```sql
select convalidated
from pg_catalog.pg_constraint
where conrelid = 'public.whatsapp_webhook_inbox'::regclass
  and conname = 'whatsapp_webhook_active_routing_snapshot_v1_check';

select count(*) as active_inbox_rows_without_routing_snapshot_v1
from public.whatsapp_webhook_inbox
where status in ('pending', 'retry', 'processing')
  and coalesce(payload #>> '{__vimob_ingress,routing_snapshot,version}', '') <> '1';

select
  pg_catalog.to_regclass('public.whatsapp_webhook_routing_outcomes') is not null
    as outcome_ledger_ready,
  pg_catalog.to_regprocedure(
    'private.cleanup_whatsapp_webhook_routing_provenance(integer,timestamp with time zone)'
  ) is not null as retention_ready;

select browser.role_name, operation.privilege_name
from unnest(array['anon', 'authenticated']::text[]) as browser(role_name)
cross join unnest(
  array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']::text[]
) as operation(privilege_name)
where pg_catalog.has_table_privilege(
  browser.role_name,
  'public.whatsapp_messages',
  operation.privilege_name
);

select policyname, cmd, roles
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename = 'whatsapp_messages'
  and cmd = any (array['ALL', 'INSERT', 'UPDATE', 'DELETE']::text[])
  and roles && array['public', 'anon', 'authenticated']::name[];

select count(*) as linked_messages_without_lead_snapshot
from public.whatsapp_messages as message
join public.whatsapp_conversations as conversation
  on conversation.id = message.conversation_id
 and conversation.organization_id = message.organization_id
where conversation.lead_id is not null
  and message.lead_id is null
  and not private.is_terminal_whatsapp_lead_resolution_quarantine(
    message.metadata,
    message.from_me,
    message.provider_message_id,
    message.message_id
  );
```

O primeiro resultado deve ser `true`, o segundo zero e os dois últimos valores
devem ser `true`; as duas consultas de segurança seguintes não podem retornar
linhas e a contagem final deve ser zero. Esse zero-gate fecha a janela de
compatibilidade em que o writer ainda fazia `coalesce` de um snapshot nulo;
depois do B1, nenhuma mensagem ligada alcançável depende desse reparo. Linhas históricas em
`processed`/`dead` permanecem intactas; não reescreva o payload para fazê-las
parecer capturadas pelo writer novo.

O outcome é a prova de conclusão por `(organization, session, provider id)` e
não depende da inbox original: ele cobre retenção da inbox e replay concluído
por um novo `event_key`. A limpeza conservadora usa 90 dias por padrão e nunca
apaga head aplicado, predecessor com sucessor, inbox ainda existente, mensagem,
binding, `lead_entry_event` ou ledger de criativo. Não reduza o horizonte abaixo
de 30 dias e não apague snapshots/outcomes diretamente. Monitore:

```sql
select count(*) as unresolved_routes,
       min(created_at) as oldest_unresolved_route
from public.whatsapp_webhook_routing_snapshots as ledger
where ledger.binding_eligible
  and not exists (
    select 1
    from public.whatsapp_webhook_routing_outcomes as outcome
    where outcome.organization_id = ledger.organization_id
      and outcome.session_id = ledger.session_id
      and outcome.provider_message_id = ledger.provider_message_id
  );
```

Mantenha intake e workers pausados depois do commit/readbacks de B1. Confirme
que nenhuma réplica antiga voltou a registrar writes durante a janela.

### 5. B2 retirar a unicidade global

Este é o ponto de liberação funcional e remove um índice que pode não ser
recriável depois dos primeiros cards multi-fila. Antes de autorizar B2 em
produção, faça obrigatoriamente um dress rehearsal completo em um clone
restaurado: aplique A1, a migration de fences, a migration de tombstone, a
migration de disponibilidade, A2, B1 e B2 com as mesmas variáveis operacionais e só
aceite o cutover se o pgTAP focado terminar verde no schema pós-B2:

```powershell
psql $vimobValidationDatabaseUrl -X -v ON_ERROR_STOP=1 `
  -f supabase/tests/queue_scoped_lead_identity_and_whatsapp_binding.test.sql
```

O teste prova explicitamente que o índice global já foi retirado e, por isso,
não é compatível com o estado intermediário B1. Ele deve rodar no clone, nunca
diretamente em produção. Registre o dump/SHA, comandos e saída desse ensaio como
evidência de autorização.

Execute B2 em produção somente se A1, a migration de fences, a migration de
tombstone, a migration de disponibilidade, A2, deploy, smokes, B1 e o dress rehearsal
pós-B2 do clone estiverem verdes:

No caminho online, use `intake_quiesced=false` e
`online_legacy_freeze=true`, conforme o bloco anterior. O comando abaixo é o
fallback legado com intake pausado.

```powershell
psql $vimobDatabaseUrl -X `
  -v "app_ready_release=$vimobReleaseSha" `
  -v "app_smoke_confirmed=true" `
  -v "intake_quiesced=true" `
  -f supabase/cutovers/20260919_retire_legacy_global_lead_phone_index.sql
```

O arquivo confirma o índice escopado, o marcador/trigger estrito, ausência de
drift de bindings e snapshots nulos ligados; só então executa `DROP INDEX
CONCURRENTLY` e verifica a ausência do índice global. Depois de B2 em produção,
faça apenas os readbacks e canários operacionais abaixo; não use a produção para
fixtures pgTAP. Um segundo clone pós-produção é opcional como evidência extra,
mas não substitui o ensaio obrigatório anterior.

Depois de B2, faça em um tenant canário aprovado:

1. mesma fila + mesmo telefone: o mesmo card/reentrada;
2. fila diferente + mesmo telefone: novo card;
3. conversa vinculada a A, troca para B: histórico A não aparece em B, previews,
   unread, arquivo e memória de IA são zerados, e efeitos de A não executam em B;
4. replay do evento de A: não reativa A nem move aliases para trás;
5. mensagem órfã só aceita `lead_id` nulo quando a conversa também está sem
   binding/lead.
6. dois eventos aceitos antes do drain, B→B e B→C, avançam pela sequência de
   ingresso; B→B mantém o card e registra reentrada, B→C termina no card C;
7. contextual B seguido de orgânico antes do worker faz o orgânico herdar o
   resultado aplicado de B, inclusive para LID canônico conhecido;
8. predecessor backlog e sucessor live não invertem a cadeia; lote não dividido
   com reação antes de inbound e lote maior que 128 mensagens respeitam todas
   as dependências por mensagem;
9. K1 `dead`/expirada depois dos efeitos, replay K2 concluído e sucessor K3:
   K2 grava um único outcome, K3 segue e nenhum efeito é duplicado;
10. lead do snapshot apagado antes do worker termina em quarentena neutra
    `whatsapp_ingress_snapshot_lead_deleted`, sem distribuição, unread,
    automação ou retry/DLQ, tanto no Edge quanto no processor nativo.

Somente depois de todos esses canários e de um último readback dos índices,
bindings e filas, reative primeiro os processors/workers no SHA novo e depois os
endpoints/fontes de intake. Monitore o replay do backlog por fila; não faça
deduplicação global por telefone durante o dreno.

## Critérios de parada e recuperação

- A1 possui fases com `COMMIT` interno para não segurar locks de backfill durante
  DDL. Portanto, um erro depois da primeira fase pode deixar mudanças aditivas
  já commitadas sem o histórico da migration concluído. Mantenha **todo intake,
  workers e relink manual pausados**; não tente um rollback lógico nem marque a
  migration como aplicada. Corrija a causa e execute novamente o arquivo A1
  inteiro com `ON_ERROR_STOP`, pois as fases foram desenhadas para replay. A1 só
  está concluída quando a última transação e o gate/readback final do próprio
  arquivo terminarem sem erro e a migration tiver sido registrada pelo mecanismo
  aprovado. Até lá, não execute A2 nem implante writers compatíveis.
- Se a migration de fences falhar, a transação inteira faz rollback. Mantenha
  intake, workers e relink manual pausados, corrija a causa e repita somente o
  arquivo completo com `ON_ERROR_STOP`. Não execute A2 nem implante a aplicação
  até o readback dos três marcadores estar verde.
- Se A2 falhar ou deixar índice inválido, inspecione e use apenas `DROP INDEX
  CONCURRENTLY` numa janela aprovada antes de tentar novamente.
- Se o deploy ou os smokes falharem, mantenha os dois índices e não execute B1.
- Se B1 falhar, a transação faz rollback; mantenha o índice global e não execute
  B2.
- B2 grava, antes do `DROP INDEX CONCURRENTLY`, um marcador durável privado com
  o SHA, OID e definição exata do índice global. Se a conexão cair durante o
  drop, mantenha intake e workers pausados. Não recrie o índice nem libere
  writers. Inspecione o índice e o marcador; somente o replay integral de B2 com
  o mesmo SHA atestado pode aceitar um índice parcial/inválido cujo OID e
  definição coincidam com o marcador `prepared`. O replay repete o drop,
  confirma a ausência e promove o marcador a `completed`.
- Depois de B2, recriar a unicidade global pode ser impossível assim que duas
  filas criarem cards para o mesmo telefone. A recuperação é forward-only:
  interrompa writers incompatíveis, preserve os cards e corrija o contrato; não
  tente fundir ou excluir leads automaticamente.
