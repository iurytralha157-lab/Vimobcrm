-- Keep lead assignment notifications backend-owned.
-- These triggers may still be the source of assignments performed inside the
-- database, but they must only create notification outbox rows. External
-- delivery is handled by the Go API notification dispatcher.

create or replace function public.notify_new_lead()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_new_assignment boolean := false;
  v_pipeline_name text;
  v_source text;
  v_campaign text;
  v_created_label text;
  v_dedupe_key text;
  v_content text;
  v_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    v_is_new_assignment := new.assigned_user_id is not null;
  elsif tg_op = 'UPDATE' then
    v_is_new_assignment := old.assigned_user_id is null and new.assigned_user_id is not null;
  end if;

  if not v_is_new_assignment then
    return new;
  end if;

  select name into v_pipeline_name
  from public.pipelines
  where id = new.pipeline_id;

  v_source := coalesce(nullif(new.source_detail, ''), nullif(new.source, ''), 'CRM');
  v_campaign := coalesce(nullif(new.utm_campaign, ''), nullif(new.meta_campaign_id, ''));
  v_created_label := to_char(coalesce(new.created_at, now()) at time zone 'America/Sao_Paulo', 'DD/MM/YYYY | HH24:MI');
  v_dedupe_key := 'new_lead_received:' || new.id::text || ':' || new.assigned_user_id::text;
  v_content := coalesce(nullif(new.name, ''), 'Lead') || ' foi atribuido a voce';

  if exists (
    select 1
    from public.notifications
    where organization_id = new.organization_id
      and user_id = new.assigned_user_id
      and metadata->>'dedupe_key' = v_dedupe_key
      and created_at >= now() - interval '6 hours'
    limit 1
  ) then
    return new;
  end if;

  v_metadata := jsonb_build_object(
    'event_key', 'new_lead_received',
    'dedupe_key', v_dedupe_key,
    'whatsapp_dispatch_required', true,
    'variables', jsonb_build_object(
      'lead_name', coalesce(nullif(new.name, ''), 'Lead'),
      'source', v_source,
      'origin', v_source,
      'campaign', coalesce(v_campaign, ''),
      'campaign_name', coalesce(v_campaign, ''),
      'pipeline_name', coalesce(v_pipeline_name, ''),
      'created_at', v_created_label,
      'date', v_created_label
    ),
    'dispatch', jsonb_build_object(
      'whatsapp', jsonb_build_object('required', true, 'status', 'pending'),
      'push', jsonb_build_object('required', true, 'status', 'pending')
    )
  );

  insert into public.notifications (
    organization_id,
    user_id,
    title,
    content,
    body,
    type,
    channel,
    lead_id,
    target_url,
    is_read,
    metadata
  ) values (
    new.organization_id,
    new.assigned_user_id,
    'Novo lead recebido',
    v_content,
    v_content,
    'lead',
    'in_app',
    new.id,
    '/crm/pipelines?lead=' || new.id::text,
    false,
    v_metadata
  );

  return new;
end;
$function$;

create or replace function public.notify_lead_assigned()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old_user_name text;
  v_pipeline_name text;
  v_created_label text;
  v_dedupe_key text;
  v_content text;
  v_metadata jsonb;
begin
  if new.assigned_user_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if old.assigned_user_id is not distinct from new.assigned_user_id then
    return new;
  end if;

  -- First assignment is handled by notify_new_lead.
  if old.assigned_user_id is null then
    return new;
  end if;

  select name into v_old_user_name
  from public.users
  where id = old.assigned_user_id;

  select name into v_pipeline_name
  from public.pipelines
  where id = new.pipeline_id;

  v_created_label := to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY | HH24:MI');
  v_dedupe_key := 'lead_transferred_to_user:' || new.id::text || ':' || new.assigned_user_id::text || ':' || coalesce(old.assigned_user_id::text, '');
  v_content := coalesce(nullif(new.name, ''), 'Lead') || ' foi transferido para voce';

  if exists (
    select 1
    from public.notifications
    where organization_id = new.organization_id
      and user_id = new.assigned_user_id
      and metadata->>'dedupe_key' = v_dedupe_key
      and created_at >= now() - interval '6 hours'
    limit 1
  ) then
    return new;
  end if;

  v_metadata := jsonb_build_object(
    'event_key', 'lead_transferred_to_user',
    'dedupe_key', v_dedupe_key,
    'old_user_id', old.assigned_user_id,
    'old_user_name', coalesce(v_old_user_name, ''),
    'pipeline_id', new.pipeline_id,
    'pipeline_name', coalesce(v_pipeline_name, ''),
    'whatsapp_dispatch_required', true,
    'variables', jsonb_build_object(
      'lead_name', coalesce(nullif(new.name, ''), 'Lead'),
      'pipeline_name', coalesce(v_pipeline_name, ''),
      'old_user_name', coalesce(v_old_user_name, 'outro usuario'),
      'from_user_name', coalesce(v_old_user_name, 'outro usuario'),
      'created_at', v_created_label,
      'date', v_created_label
    ),
    'dispatch', jsonb_build_object(
      'whatsapp', jsonb_build_object('required', true, 'status', 'pending'),
      'push', jsonb_build_object('required', true, 'status', 'pending')
    )
  );

  insert into public.notifications (
    organization_id,
    user_id,
    title,
    content,
    body,
    type,
    channel,
    lead_id,
    target_url,
    is_read,
    metadata
  ) values (
    new.organization_id,
    new.assigned_user_id,
    'Lead transferido para voce',
    v_content,
    v_content,
    'lead',
    'in_app',
    new.id,
    '/crm/pipelines?lead=' || new.id::text,
    false,
    v_metadata
  );

  return new;
end;
$function$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trigger_notify_new_lead'
      and tgrelid = 'public.leads'::regclass
  ) then
    create trigger trigger_notify_new_lead
    after insert or update of assigned_user_id on public.leads
    for each row execute function public.notify_new_lead();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trigger_notify_lead_assigned'
      and tgrelid = 'public.leads'::regclass
  ) then
    create trigger trigger_notify_lead_assigned
    after update on public.leads
    for each row execute function public.notify_lead_assigned();
  end if;
end $$;
