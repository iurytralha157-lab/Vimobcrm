begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.home_publications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  cta_label text not null,
  cta_href text not null,
  image_url text,
  image_storage_path text,
  card_size text not null default 'half',
  accent text not null default 'orange',
  display_order integer not null default 0,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  target_type text not null default 'all',
  target_organization_ids uuid[] not null default '{}'::uuid[],
  target_user_ids uuid[] not null default '{}'::uuid[],
  target_roles text[] not null default '{}'::text[],
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint home_publications_title_length_check
    check (char_length(btrim(title)) between 2 and 120),
  constraint home_publications_body_length_check
    check (char_length(btrim(body)) between 2 and 1000),
  constraint home_publications_cta_label_length_check
    check (char_length(btrim(cta_label)) between 2 and 40),
  constraint home_publications_cta_href_internal_check
    check (cta_href in (
      '/dashboard',
      '/crm/pipelines',
      '/crm/contacts',
      '/crm/conversas',
      '/agenda',
      '/automations',
      '/automations?tab=automations',
      '/automations?tab=templates',
      '/automations?tab=history',
      '/properties',
      '/gamificacao',
      '/notifications',
      '/settings',
      '/suporte'
    )),
  constraint home_publications_image_pair_check
    check ((image_url is null) = (image_storage_path is null)),
  constraint home_publications_card_size_check
    check (card_size in ('wide', 'half', 'compact')),
  constraint home_publications_accent_check
    check (accent in ('orange', 'violet', 'blue', 'emerald', 'amber', 'slate')),
  constraint home_publications_display_order_check
    check (display_order between 0 and 10000),
  constraint home_publications_schedule_check
    check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint home_publications_target_type_check
    check (target_type in ('all', 'organizations', 'users', 'roles')),
  constraint home_publications_target_roles_check
    check (target_roles <@ array['admin', 'user']::text[]),
  constraint home_publications_target_shape_check
    check (
      (
        target_type = 'all'
        and cardinality(target_organization_ids) = 0
        and cardinality(target_user_ids) = 0
        and cardinality(target_roles) = 0
      )
      or (
        target_type = 'organizations'
        and cardinality(target_organization_ids) > 0
        and cardinality(target_user_ids) = 0
        and cardinality(target_roles) = 0
      )
      or (
        target_type = 'users'
        and cardinality(target_user_ids) > 0
        and cardinality(target_organization_ids) = 0
        and cardinality(target_roles) = 0
      )
      or (
        target_type = 'roles'
        and cardinality(target_roles) > 0
        and cardinality(target_organization_ids) = 0
        and cardinality(target_user_ids) = 0
      )
    )
);

comment on table public.home_publications is
  'Platform-managed cards for the authenticated home page. Read and mutations are exposed only through the Vimob API.';

create index home_publications_active_schedule_order_idx
  on public.home_publications (is_active, starts_at, ends_at, display_order, created_at);

create index home_publications_target_organization_ids_idx
  on public.home_publications using gin (target_organization_ids);

create index home_publications_target_user_ids_idx
  on public.home_publications using gin (target_user_ids);

create index home_publications_target_roles_idx
  on public.home_publications using gin (target_roles);

create trigger update_home_publications_updated_at
before update on public.home_publications
for each row execute function public.update_updated_at_column();

alter table public.home_publications enable row level security;

revoke all privileges on table public.home_publications from public, anon, authenticated;
revoke all privileges on table public.home_publications from service_role;
grant select, insert, update, delete on table public.home_publications to service_role;

insert into public.home_publications (
  id,
  title,
  body,
  cta_label,
  cta_href,
  card_size,
  accent,
  display_order,
  is_active,
  target_type
)
values
  (
    '10000000-0000-4000-8000-000000000101',
    'Transforme oportunidades em negócios',
    'Organize seus leads por etapa, acompanhe cada negociação e avance as melhores oportunidades no Pipeline.',
    'Abrir Pipeline',
    '/crm/pipelines',
    'wide',
    'orange',
    10,
    true,
    'all'
  ),
  (
    '10000000-0000-4000-8000-000000000102',
    'Nenhuma oportunidade esquecida',
    'Revise leads que precisam de atenção e mantenha seus próximos contatos e cadências em movimento.',
    'Revisar oportunidades',
    '/crm/pipelines',
    'half',
    'violet',
    20,
    true,
    'all'
  ),
  (
    '10000000-0000-4000-8000-000000000103',
    'Sua agenda sob controle',
    'Visualize compromissos, visitas e tarefas do dia em um só lugar.',
    'Ver Agenda',
    '/agenda',
    'compact',
    'blue',
    30,
    true,
    'all'
  ),
  (
    '10000000-0000-4000-8000-000000000104',
    'Converse com seus leads',
    'Acompanhe as conversas do WhatsApp e responda seus clientes sem sair do CRM.',
    'Abrir Conversas',
    '/crm/conversas',
    'half',
    'emerald',
    40,
    true,
    'all'
  )
on conflict (id) do nothing;

insert into public.help_articles (
  id,
  category,
  title,
  content,
  display_order,
  is_active
)
select
  seed.id,
  seed.category,
  seed.title,
  seed.content,
  seed.display_order,
  true
from (
  values
    (
      '10000000-0000-4000-8000-000000000201'::uuid,
      'CRM e Pipeline',
      'Como funciona o CRM e o pipeline?',
      'O CRM reúne seus leads, contatos, conversas, tarefas e histórico comercial. Abra Pipeline no menu lateral para visualizar o funil em formato Kanban: cada coluna representa uma etapa do processo e cada card representa uma oportunidade.',
      10
    ),
    (
      '10000000-0000-4000-8000-000000000202'::uuid,
      'Leads',
      'Como criar um novo lead?',
      'Abra Pipeline e clique em Novo Lead. Informe pelo menos os dados essenciais do contato, complemente telefone, e-mail, responsável e imóvel de interesse quando disponíveis, e salve para incluir a oportunidade no funil.',
      20
    ),
    (
      '10000000-0000-4000-8000-000000000203'::uuid,
      'Leads',
      'Como mover um lead entre estágios?',
      'No Pipeline, arraste o card do lead para a coluna de destino e solte para registrar a mudança. Você também pode abrir os detalhes do lead e atualizar o estágio; a movimentação fica vinculada ao histórico da oportunidade.',
      30
    ),
    (
      '10000000-0000-4000-8000-000000000204'::uuid,
      'Tarefas e Cadências',
      'Como acompanhar tarefas e cadências?',
      'As tarefas pendentes podem ser acompanhadas nos detalhes do lead e na Agenda. Cadências são sequências automáticas de atividades associadas ao avanço do atendimento; revise as oportunidades no Pipeline e conclua cada tarefa para manter o acompanhamento em dia.',
      40
    ),
    (
      '10000000-0000-4000-8000-000000000205'::uuid,
      'Agenda',
      'Como usar a agenda?',
      'Abra Agenda para visualizar compromissos e tarefas por período. Use Novo Evento para cadastrar uma ligação, visita, reunião ou outro compromisso, vinculando o lead e o imóvel quando fizer sentido; os filtros disponíveis respeitam sua permissão de acesso.',
      50
    ),
    (
      '10000000-0000-4000-8000-000000000206'::uuid,
      'WhatsApp e Conversas',
      'Como conversar com leads pelo WhatsApp?',
      'Abra Conversas para consultar atendimentos e enviar mensagens mantendo o contexto do lead. Para conectar ou administrar uma sessão, acesse Configurações, entre em Integrações e selecione WhatsApp; depois siga o fluxo de conexão e leitura do QR Code.',
      60
    ),
    (
      '10000000-0000-4000-8000-000000000207'::uuid,
      'Imóveis',
      'Como cadastrar e publicar imóveis?',
      'Abra Imóveis e use Novo Imóvel para informar tipo, preço, localização, características e fotos. A publicação no site depende do módulo e das permissões da organização; quando disponível, revise também as opções do imóvel e a configuração do site antes de publicar.',
      70
    ),
    (
      '10000000-0000-4000-8000-000000000208'::uuid,
      'Automações',
      'Como criar uma automação?',
      'Abra Automações e selecione Nova Automação. No editor visual, escolha o gatilho, adicione condições e ações compatíveis com seu processo, conecte os blocos, salve e ative somente depois de revisar o fluxo.',
      80
    ),
    (
      '10000000-0000-4000-8000-000000000209'::uuid,
      'Distribuição de Leads',
      'Como funciona a distribuição de leads?',
      'A distribuição encaminha novas oportunidades para usuários ou equipes conforme as filas e regras configuradas. Usuários autorizados podem abrir Gestão e selecionar Distribuição para ajustar participantes, pesos e critérios; o histórico ajuda a acompanhar o resultado das atribuições.',
      90
    ),
    (
      '10000000-0000-4000-8000-000000000210'::uuid,
      'Dashboard',
      'O que aparece no Dashboard?',
      'O Dashboard apresenta indicadores e gráficos conforme os módulos e as permissões do usuário, incluindo visão comercial, desempenho do site e campanhas quando habilitados. Use os filtros de período, pipeline, equipe e responsável para analisar o recorte necessário.',
      100
    ),
    (
      '10000000-0000-4000-8000-000000000211'::uuid,
      'Notificações',
      'Como acompanhar notificações?',
      'O sino no cabeçalho mostra avisos recentes e o contador de itens não lidos. Abra Notificações para consultar a lista completa; ao selecionar um aviso com destino disponível, o CRM leva você ao item relacionado.',
      110
    ),
    (
      '10000000-0000-4000-8000-000000000212'::uuid,
      'Contatos',
      'Como gerenciar contatos?',
      'Abra Contatos para pesquisar e consultar as pessoas cadastradas na organização. Os dados e ações exibidos respeitam seu escopo de acesso; ao abrir um contato, você pode revisar informações e o relacionamento dele com as oportunidades disponíveis.',
      120
    ),
    (
      '10000000-0000-4000-8000-000000000213'::uuid,
      'Equipes e Permissões',
      'Como organizar equipes e permissões?',
      'Usuários autorizados podem abrir Gestão e selecionar Equipes para criar grupos, definir líderes, participantes e pipelines vinculados. Em Configurações, na área de Usuários, é possível convidar pessoas e ajustar o acesso individual conforme as permissões da organização.',
      130
    )
) as seed(id, category, title, content, display_order)
where not exists (
  select 1
  from public.help_articles existing
  where lower(regexp_replace(btrim(existing.title), '\s+', ' ', 'g'))
    = lower(regexp_replace(btrim(seed.title), '\s+', ' ', 'g'))
)
on conflict (id) do nothing;

commit;
