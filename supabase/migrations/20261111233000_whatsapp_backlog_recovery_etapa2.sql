-- Etapa 2: recuperacao silenciosa do backlog suprimido.
-- Escopo deliberadamente minimo e idempotente:
--   1) Colunas de retencao unlinked (no-op se 20261008210143 ja foi aplicada).
--   2) Restricao de capture_state no formato completo (mesmo texto de
--      20261009021248), cobrindo unlinked_ephemeral inbound e outbound.
--   3) Indice parcial de varredura do inbox processado.
--   4) Tabela de checkpoint do worker de recuperacao (uma linha, singleton).
-- Nada aqui ativa worker, gatilho, automacao ou captura nova. A recuperacao
-- em si acontece por UPDATE em linhas ja existentes, que nunca dispara os
-- gatilhos AFTER INSERT de automacao/atencao/avatar/handoff.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.whatsapp_conversations
  add column if not exists retired_at timestamptz;
alter table public.whatsapp_conversations
  add column if not exists unlinked_retention_v1 boolean not null default false;
alter table public.whatsapp_conversations
  add column if not exists unlinked_retention_scrubbed_at timestamptz;
alter table public.whatsapp_messages
  add column if not exists unlinked_retention_scrubbed_at timestamptz;

alter table public.whatsapp_messages
  drop constraint if exists whatsapp_messages_capture_state_check;
alter table public.whatsapp_messages
  add constraint whatsapp_messages_capture_state_check check (
    capture_state is null
    or capture_state in ('legacy', 'captured', 'suppressed')
    or (
      capture_state = 'unlinked_ephemeral' and lead_id is null
      and ((not from_me and direction = 'inbound')
        or (from_me and direction = 'outbound'))
    )
    or (
      capture_state in ('promoted_unlinked', 'observed_unattended')
      and lead_id is not null
      and ((not from_me and direction = 'inbound')
        or (from_me and direction = 'outbound'))
    )
  ) not valid;

create index if not exists whatsapp_webhook_inbox_recovery_scan_idx
  on public.whatsapp_webhook_inbox (created_at, id)
  where status = 'processed';

create table if not exists private.whatsapp_backlog_recovery_checkpoint (
  id smallint primary key default 1 check (id = 1),
  last_created_at timestamptz not null default 'epoch',
  last_inbox_id uuid not null default '00000000-0000-0000-0000-000000000000',
  envelopes_scanned bigint not null default 0,
  messages_recovered_lead bigint not null default 0,
  messages_recovered_unlinked bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table private.whatsapp_backlog_recovery_checkpoint enable row level security;
alter table private.whatsapp_backlog_recovery_checkpoint force row level security;
revoke all on table private.whatsapp_backlog_recovery_checkpoint
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_backlog_recovery_checkpoint is
'Cursor unico do worker de recuperacao do backlog (etapa 2). A linha singleton serializa as replicas via FOR UPDATE SKIP LOCKED; os contadores sao apenas observabilidade acumulada.';

insert into private.whatsapp_backlog_recovery_checkpoint (id)
values (1)
on conflict (id) do nothing;

commit;
