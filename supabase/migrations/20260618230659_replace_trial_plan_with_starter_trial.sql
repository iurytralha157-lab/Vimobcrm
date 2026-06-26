update public.admin_subscription_plans
set
  is_active = false,
  is_public = false,
  updated_at = now()
where slug = 'trial-7';

insert into public.admin_subscription_plans (
  slug,
  name,
  description,
  price,
  billing_cycle,
  trial_enabled,
  trial_days,
  max_users,
  max_leads,
  max_whatsapp_sessions,
  modules,
  is_active,
  is_public
) values
  (
    'starter-197',
    'Vimob Starter',
    'CRM imobiliario essencial com 7 dias gratis antes da primeira cobranca.',
    197,
    'monthly',
    true,
    7,
    5,
    3000,
    1,
    array['crm', 'properties', 'agenda', 'whatsapp', 'cadences', 'tags', 'round_robin', 'reports'],
    true,
    true
  ),
  (
    'intermediario-297',
    'Vimob Intermediario',
    'Starter com site publico integrado para divulgacao de imoveis.',
    297,
    'monthly',
    false,
    null,
    10,
    8000,
    2,
    array['crm', 'properties', 'agenda', 'whatsapp', 'cadences', 'tags', 'round_robin', 'reports', 'site'],
    true,
    true
  ),
  (
    'master-497',
    'Vimob Master',
    'Plano completo com site, financeiro, automacoes e integracoes, sem gamificacao inclusa.',
    497,
    'monthly',
    false,
    null,
    20,
    20000,
    3,
    array['crm', 'properties', 'agenda', 'whatsapp', 'cadences', 'tags', 'round_robin', 'reports', 'site', 'financial', 'automations', 'webhooks', 'api', 'campaigns', 'performance'],
    true,
    true
  )
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  price = excluded.price,
  billing_cycle = excluded.billing_cycle,
  trial_enabled = excluded.trial_enabled,
  trial_days = excluded.trial_days,
  max_users = excluded.max_users,
  max_leads = excluded.max_leads,
  max_whatsapp_sessions = excluded.max_whatsapp_sessions,
  modules = excluded.modules,
  is_active = excluded.is_active,
  is_public = excluded.is_public,
  updated_at = now();
