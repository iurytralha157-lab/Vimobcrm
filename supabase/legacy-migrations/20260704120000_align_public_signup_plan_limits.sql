update public.admin_subscription_plans
set
  description = '7 dias gratis. Kanban, dashboard, agenda, WhatsApp, Meta e imoveis.',
  max_users = 5,
  max_leads = null,
  max_whatsapp_sessions = 5,
  modules = array['crm', 'properties', 'agenda', 'whatsapp', 'campaigns'],
  is_public = true,
  updated_at = now()
where slug = 'starter-197';

update public.admin_subscription_plans
set
  description = 'Tudo do Starter, com site publico.',
  max_users = 10,
  max_leads = null,
  max_whatsapp_sessions = 10,
  modules = array['crm', 'properties', 'agenda', 'whatsapp', 'campaigns', 'site'],
  is_public = true,
  updated_at = now()
where slug = 'intermediario-297';

update public.admin_subscription_plans
set
  description = 'Tudo do Pro, com automacoes e mais usuarios.',
  max_users = 20,
  max_leads = null,
  max_whatsapp_sessions = 20,
  modules = array['crm', 'properties', 'agenda', 'whatsapp', 'campaigns', 'site', 'automations'],
  is_public = true,
  updated_at = now()
where slug = 'master-497';
