-- Legacy executions may retain a conversation deleted before the composite
-- tenant foreign key existed. Archive the full row and mirror ON DELETE SET
-- NULL before the hardened runtime validates that relationship.
create schema if not exists private;

create table if not exists private.automation_runtime_reference_archive (
  archived_at timestamptz not null default now(),
  source_table text not null,
  row_id uuid not null,
  organization_id uuid,
  snapshot jsonb not null
);

insert into private.automation_runtime_reference_archive (
  source_table,
  row_id,
  organization_id,
  snapshot
)
select
  'automation_executions:conversation_reference',
  execution.id,
  execution.organization_id,
  to_jsonb(execution)
from public.automation_executions as execution
left join public.whatsapp_conversations as conversation
  on conversation.id = execution.conversation_id
 and conversation.organization_id = execution.organization_id
where execution.conversation_id is not null
  and conversation.id is null;

update public.automation_executions as execution
set conversation_id = null
where execution.conversation_id is not null
  and not exists (
    select 1
    from public.whatsapp_conversations as conversation
    where conversation.id = execution.conversation_id
      and conversation.organization_id = execution.organization_id
  );

revoke all on table private.automation_runtime_reference_archive
  from public, anon, authenticated, service_role;
