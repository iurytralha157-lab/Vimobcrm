begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Keep the relational permission catalog used by organization roles aligned
-- with the canonical catalog served by the API. Previous active migrations
-- only seeded a subset, which made role updates silently ignore valid keys.
insert into public.available_permissions (
  key,
  name,
  label,
  description,
  category,
  domain
)
select key, label, label, description, domain, domain
from (values
  ('dashboard_view', 'Ver dashboard geral', 'Acessar o painel comercial no escopo permitido', 'dashboard'),
  ('dashboard_site_view', 'Ver dashboard do site', 'Acessar métricas e análises do site', 'dashboard'),
  ('dashboard_campaigns_view', 'Ver dashboard de campanhas', 'Acessar métricas e análises de campanhas', 'dashboard'),
  ('lead_view_own', 'Ver leads próprios', 'Visualizar leads sob sua responsabilidade principal', 'leads'),
  ('lead_view_team', 'Ver leads das equipes lideradas', 'Visualizar leads vinculados às equipes que lidera', 'leads'),
  ('lead_view_all', 'Ver todos os leads', 'Visualizar todos os leads da organização', 'leads'),
  ('lead_operate', 'Editar e operar leads', 'Editar, mover, transferir, reabrir e classificar leads visíveis', 'leads'),
  ('lead_create', 'Criar leads', 'Criar novos leads manualmente', 'leads'),
  ('lead_delete', 'Excluir leads', 'Excluir leads visíveis', 'leads'),
  ('lead_import', 'Importar leads', 'Importar leads em massa', 'leads'),
  ('lead_export', 'Exportar leads', 'Exportar leads e contatos', 'leads'),
  ('attention_view', 'Ver prioridades e atenções', 'Acessar alertas e pendências dos leads visíveis', 'crm'),
  ('whatsapp_view', 'Ver conversas', 'Visualizar conversas autorizadas', 'conversations'),
  ('whatsapp_operate', 'Operar conversas', 'Enviar mensagens e organizar conversas autorizadas', 'conversations'),
  ('whatsapp_manage', 'Gerenciar conexões', 'Criar e administrar conexões do WhatsApp', 'conversations'),
  ('team_view', 'Ver equipes', 'Visualizar equipes dentro do escopo permitido', 'management'),
  ('team_manage', 'Gerenciar equipes', 'Editar membros e disponibilidade dentro do escopo permitido', 'management'),
  ('distribution_manage', 'Gerenciar distribuição', 'Criar e configurar listas e regras de distribuição', 'management'),
  ('pipeline_manage', 'Gerenciar pipelines', 'Gerenciar pipelines, etapas, cadências e automações de etapa', 'management'),
  ('tag_manage', 'Gerenciar tags', 'Criar, editar e excluir tags globais', 'management'),
  ('property_view', 'Ver imóveis', 'Visualizar o catálogo de imóveis', 'properties'),
  ('property_manage', 'Gerenciar imóveis', 'Criar, editar, atribuir e excluir imóveis', 'properties'),
  ('schedule_view', 'Ver agenda', 'Visualizar eventos autorizados', 'schedule'),
  ('schedule_manage', 'Gerenciar agenda', 'Criar, editar, concluir e excluir eventos autorizados', 'schedule'),
  ('automations_view', 'Ver automações', 'Visualizar automações e histórico', 'automations'),
  ('automations_manage', 'Gerenciar automações', 'Criar, editar e excluir automações', 'automations'),
  ('financial_view', 'Ver financeiro', 'Visualizar dados financeiros', 'financial'),
  ('financial_manage', 'Gerenciar financeiro', 'Criar e alterar dados financeiros', 'financial'),
  ('gamification_view', 'Ver gamificação', 'Visualizar arena, ranking e histórico', 'gamification'),
  ('gamification_manage', 'Configurar gamificação', 'Gerenciar regras, missões e temporadas', 'gamification'),
  ('users_presence_view', 'Ver presença da equipe', 'Visualizar presença no escopo da organização, da concessão administrativa ou das equipes lideradas', 'access'),
  ('users_manage', 'Gerenciar usuários', 'Convidar, editar, desativar e excluir usuários', 'access'),
  ('permissions_manage', 'Gerenciar permissões', 'Alterar o acesso individual dos usuários', 'access'),
  ('settings_integrations', 'Gerenciar integrações', 'Configurar integrações da organização', 'settings'),
  ('settings_organization', 'Gerenciar organização', 'Alterar dados e preferências da organização', 'settings'),
  ('settings_ai', 'Gerenciar IA', 'Configurar agentes e regras de inteligência artificial', 'settings'),
  ('settings_site', 'Gerenciar site', 'Configurar o site da organização', 'settings'),
  ('settings_billing', 'Gerenciar cobrança', 'Alterar plano e dados de cobrança', 'settings')
) as seed(key, label, description, domain)
on conflict (key) do update
set name = excluded.name,
    label = excluded.label,
    description = excluded.description,
    category = excluded.category,
    domain = excluded.domain;

-- This is reference data. Browsers may read the catalog, but only the backend
-- service role may mutate it.
revoke all on table public.available_permissions from anon, authenticated, public;
grant select on table public.available_permissions to authenticated;

commit;
