-- SOMENTE PARA CUTOVER MANUAL.
-- Este arquivo fica intencionalmente fora de supabase/migrations porque sua
-- trava depende do estado de produção e ele nunca deve rodar em um push comum.
begin;

do $cutover$
begin
  if exists (
    select 1
    from public.whatsapp_sessions
    where provider = 'evolution_go'
      and coalesce(is_active, true)
      and coalesce(status, '') <> 'deleted'
      and (
        coalesce(advanced_settings->>'webhook_url', '') !~*
          '^https://api\.vimobcrm\.com\.br/v1/whatsapp/webhook/evolution-go(?:\?|$)'
        or coalesce(advanced_settings->>'webhook_url', '') ~*
          '([?&])(webhook_token|apikey|token)='
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'WhatsApp webhook token rotation blocked: active sessions have not completed the tokenless backend cutover';
  end if;
end
$cutover$;

update public.whatsapp_sessions
set advanced_settings =
      jsonb_set(
        case
          when not coalesce(is_active, true) or coalesce(status, '') = 'deleted'
            then jsonb_set(
              coalesce(advanced_settings, '{}'::jsonb),
              '{webhook_url}',
              to_jsonb(split_part(coalesce(advanced_settings->>'webhook_url', ''), '?', 1)),
              true
            )
          else coalesce(advanced_settings, '{}'::jsonb)
        end - 'webhook_rollout_managed',
        '{webhook_token}',
        to_jsonb(encode(gen_random_bytes(32), 'hex')),
        true
      ),
    updated_at = now()
where provider = 'evolution_go';

with cleaned as (
  select
    id,
    payload
      - 'instanceToken'
      - 'instance_token'
      - 'InstanceToken'
      - 'webhook_token'
      - 'webhookToken'
      - 'apikey'
      - 'apiKey' as top_level
  from public.whatsapp_webhook_inbox
  where payload ?| array[
          'instanceToken', 'instance_token', 'InstanceToken',
          'webhook_token', 'webhookToken', 'apikey', 'apiKey'
        ]
     or (
       jsonb_typeof(payload->'data') = 'object'
       and (payload->'data') ?| array[
         'instanceToken', 'instance_token', 'InstanceToken',
         'webhook_token', 'webhookToken', 'apikey', 'apiKey'
       ]
     )
)
update public.whatsapp_webhook_inbox inbox
set payload = case
      when jsonb_typeof(cleaned.top_level->'data') = 'object'
        then jsonb_set(
          cleaned.top_level,
          '{data}',
          (cleaned.top_level->'data')
            - 'instanceToken'
            - 'instance_token'
            - 'InstanceToken'
            - 'webhook_token'
            - 'webhookToken'
            - 'apikey'
            - 'apiKey',
          false
        )
      else cleaned.top_level
    end,
    updated_at = now()
from cleaned
where inbox.id = cleaned.id;

alter table public.whatsapp_sessions
  drop constraint if exists whatsapp_sessions_webhook_url_has_no_credentials;

alter table public.whatsapp_sessions
  add constraint whatsapp_sessions_webhook_url_has_no_credentials
  check (
    provider <> 'evolution_go'
    or coalesce(advanced_settings->>'webhook_url', '') !~*
      '([?&])(webhook_token|apikey|token)='
  ) not valid;

alter table public.whatsapp_sessions
  validate constraint whatsapp_sessions_webhook_url_has_no_credentials;

alter table public.whatsapp_webhook_inbox
  drop constraint if exists whatsapp_webhook_inbox_payload_has_no_auth_credentials;

alter table public.whatsapp_webhook_inbox
  add constraint whatsapp_webhook_inbox_payload_has_no_auth_credentials
  check (
    not payload ?| array[
      'instanceToken', 'instance_token', 'InstanceToken',
      'webhook_token', 'webhookToken', 'apikey', 'apiKey'
    ]
    and not (
      jsonb_typeof(payload->'data') = 'object'
      and (payload->'data') ?| array[
        'instanceToken', 'instance_token', 'InstanceToken',
        'webhook_token', 'webhookToken', 'apikey', 'apiKey'
      ]
    )
  ) not valid;

alter table public.whatsapp_webhook_inbox
  validate constraint whatsapp_webhook_inbox_payload_has_no_auth_credentials;

commit;
