-- Prepared only. Apply in a controlled database rollout after the API tests pass.
create table if not exists public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  permission_key text not null,
  allowed boolean not null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_permission_overrides_key_not_blank check (btrim(permission_key) <> ''),
  constraint user_permission_overrides_membership_fk
    foreign key (organization_id, user_id)
    references public.organization_members (organization_id, user_id)
    on delete cascade,
  constraint user_permission_overrides_unique unique (organization_id, user_id, permission_key)
);

create index if not exists user_permission_overrides_user_lookup_idx
  on public.user_permission_overrides (organization_id, user_id);

alter table public.user_permission_overrides enable row level security;

-- Authorization is served by the Go API. Keep this table out of the Data API.
revoke all on table public.user_permission_overrides from anon, authenticated, public;

insert into public.available_permissions (key, name, label, description, category, domain)
select key, label, label, description, domain, domain
from (values
  ('dashboard_view', 'Ver dashboard geral', 'Acessar o painel comercial no escopo permitido', 'dashboard'),
  ('dashboard_site_view', 'Ver dashboard do site', 'Acessar metricas e analises do site', 'dashboard'),
  ('dashboard_campaigns_view', 'Ver dashboard de campanhas', 'Acessar metricas e analises de campanhas', 'dashboard'),
  ('lead_view_own', 'Ver leads proprios', 'Visualizar leads sob sua responsabilidade principal', 'leads'),
  ('lead_view_team', 'Ver leads das equipes lideradas', 'Visualizar leads vinculados as equipes que lidera', 'leads'),
  ('lead_view_all', 'Ver todos os leads', 'Visualizar todos os leads da organizacao', 'leads'),
  ('lead_operate', 'Editar e operar leads', 'Editar, mover, transferir, reabrir e classificar leads visiveis', 'leads'),
  ('lead_create', 'Criar leads', 'Criar novos leads manualmente', 'leads'),
  ('lead_delete', 'Excluir leads', 'Excluir leads visiveis', 'leads'),
  ('lead_import', 'Importar leads', 'Importar leads em massa', 'leads'),
  ('lead_export', 'Exportar leads', 'Exportar leads e contatos', 'leads'),
  ('attention_view', 'Ver central de atencao', 'Acessar alertas dos leads visiveis', 'crm'),
  ('whatsapp_view', 'Ver conversas', 'Visualizar conversas autorizadas', 'conversations'),
  ('whatsapp_operate', 'Operar conversas', 'Enviar mensagens e organizar conversas autorizadas', 'conversations'),
  ('whatsapp_manage', 'Gerenciar conexoes', 'Criar e administrar conexoes do WhatsApp', 'conversations'),
  ('team_view', 'Ver equipes', 'Visualizar equipes dentro do escopo permitido', 'management'),
  ('team_manage', 'Gerenciar equipes', 'Editar membros e disponibilidade dentro do escopo permitido', 'management'),
  ('distribution_manage', 'Gerenciar distribuicao', 'Criar e configurar listas e regras de distribuicao', 'management'),
  ('pipeline_manage', 'Gerenciar pipelines', 'Gerenciar pipelines, etapas, cadencias e automacoes de etapa', 'management'),
  ('tag_manage', 'Gerenciar tags', 'Criar, editar e excluir tags globais', 'management'),
  ('property_view', 'Ver imoveis', 'Visualizar o catalogo de imoveis', 'properties'),
  ('property_manage', 'Gerenciar imoveis', 'Criar, editar, atribuir e excluir imoveis', 'properties'),
  ('schedule_view', 'Ver agenda', 'Visualizar eventos autorizados', 'schedule'),
  ('schedule_manage', 'Gerenciar agenda', 'Criar, editar, concluir e excluir eventos autorizados', 'schedule'),
  ('automations_view', 'Ver automacoes', 'Visualizar automacoes e historico', 'automations'),
  ('automations_manage', 'Gerenciar automacoes', 'Criar, editar e excluir automacoes', 'automations'),
  ('financial_view', 'Ver financeiro', 'Visualizar dados financeiros', 'financial'),
  ('financial_manage', 'Gerenciar financeiro', 'Criar e alterar dados financeiros', 'financial'),
  ('gamification_view', 'Ver gamificacao', 'Visualizar arena, ranking e historico', 'gamification'),
  ('gamification_manage', 'Configurar gamificacao', 'Gerenciar regras, missoes e temporadas', 'gamification'),
  ('users_manage', 'Gerenciar usuarios', 'Convidar, editar, desativar e excluir usuarios', 'settings'),
  ('permissions_manage', 'Gerenciar permissoes', 'Alterar o acesso individual dos usuarios', 'settings'),
  ('settings_integrations', 'Gerenciar integracoes', 'Configurar integracoes da organizacao', 'settings'),
  ('settings_organization', 'Gerenciar organizacao', 'Alterar dados e preferencias da organizacao', 'settings'),
  ('settings_ai', 'Gerenciar IA', 'Configurar agentes e regras de inteligencia artificial', 'settings'),
  ('settings_site', 'Gerenciar site', 'Configurar o site da organizacao', 'settings'),
  ('settings_billing', 'Gerenciar cobranca', 'Alterar plano e dados de cobranca', 'settings')
) as seed(key, label, description, domain)
on conflict (key) do update set
  name = excluded.name,
  label = excluded.label,
  description = excluded.description,
  category = excluded.category,
  domain = excluded.domain;
