-- Producao nunca recebeu 20261008210143 inteira; o caminho de download de midia
-- (findCompletedWhatsAppMediaAsset) consulta private.whatsapp_unlinked_media_gc
-- e falhava com 42P01, travando 100% dos downloads. Esta migracao cria apenas a
-- tabela, verbatim da original, com guardas if-not-exists para o CI (onde a
-- 20261008210143 ja criou tudo). As funcoes de GC ficam de fora: o worker de
-- retencao esta desligado (WHATSAPP_UNLINKED_RETENTION_WORKER_ENABLED=false) e
-- as versoes do CI ja foram remendadas por migracoes posteriores.
create table if not exists private.whatsapp_unlinked_media_gc (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bucket_id text not null default 'whatsapp-media'
    check (bucket_id = 'whatsapp-media'),
  object_path text not null,
  source_conversation_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 100),
  next_attempt_at timestamptz not null default clock_timestamp(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (organization_id, bucket_id, object_path),
  constraint whatsapp_unlinked_media_gc_path_check check (
    object_path like 'orgs/' || organization_id::text || '/%'
    and length(object_path) between 44 and 1024
    and position('..' in object_path) = 0
    and position(E'\\' in object_path) = 0
  ),
  constraint whatsapp_unlinked_media_gc_lease_check check (
    (status = 'processing' and locked_at is not null and locked_by is not null)
    or (status <> 'processing' and locked_at is null and locked_by is null)
  )
);

create index if not exists whatsapp_unlinked_media_gc_pending_idx
on private.whatsapp_unlinked_media_gc (next_attempt_at, created_at, id)
where status in ('pending', 'retry', 'processing');

alter table private.whatsapp_unlinked_media_gc enable row level security;
alter table private.whatsapp_unlinked_media_gc force row level security;
revoke all on private.whatsapp_unlinked_media_gc
from public, anon, authenticated, service_role;
grant select on private.whatsapp_unlinked_media_gc to service_role;
