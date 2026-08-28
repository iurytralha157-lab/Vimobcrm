begin;

alter table public.help_articles
  add column if not exists slug text,
  add column if not exists summary text,
  add column if not exists module_key text,
  add column if not exists search_keywords text[] not null default '{}'::text[],
  add column if not exists visibility text not null default 'authenticated',
  add column if not exists route_href text,
  add column if not exists action_label text,
  add column if not exists steps jsonb not null default '[]'::jsonb,
  add column if not exists related_slugs text[] not null default '{}'::text[],
  add column if not exists estimated_minutes smallint not null default 3,
  add column if not exists last_reviewed_at timestamptz,
  add column if not exists search_vector tsvector;

alter table public.help_articles
  alter column visibility set default 'authenticated';

alter table public.help_articles
  disable trigger update_help_articles_updated_at;

update public.help_articles
set visibility = 'authenticated'
where visibility = 'all';

update public.help_articles
set
  title = case
    when btrim(title) <> '' then title
    else 'Artigo de ajuda ' || left(replace(id::text, '-', ''), 8)
  end,
  content = case
    when btrim(content) <> '' then content
    else 'Conteúdo legado aguardando revisão.'
  end,
  category = case
    when btrim(category) <> '' then category
    else 'Geral'
  end,
  slug = left(
    coalesce(
      nullif(slug, ''),
      trim(both '-' from regexp_replace(
        lower(translate(
          title,
          'áàâãäéèêëíìîïóòôõöúùûüçñ',
          'aaaaaeeeeiiiiooooouuuucn'
        )),
        '[^a-z0-9]+',
        '-',
        'g'
      ))
    ),
    160
  ),
  summary = left(
    coalesce(
      nullif(btrim(summary), ''),
      nullif(left(regexp_replace(btrim(content), '\s+', ' ', 'g'), 280), ''),
      'Conteúdo legado aguardando revisão.'
    ),
    320
  ),
  module_key = coalesce(
    nullif(module_key, ''),
    case
      when lower(category) like '%pipeline%' or lower(category) like '%lead%' then 'pipeline'
      when lower(category) like '%contato%' then 'contacts'
      when lower(category) like '%agenda%' then 'schedule'
      when lower(category) like '%whatsapp%' or lower(category) like '%conversa%' then 'conversations'
      when lower(category) like '%automa%' then 'automations'
      when lower(category) like '%dashboard%' then 'dashboard'
      when lower(category) like '%equipe%' or lower(category) like '%permiss%' then 'users'
      when lower(category) like '%imóve%' or lower(category) like '%imove%' then 'properties'
      else 'getting-started'
    end
  ),
  display_order = coalesce(display_order, 0),
  is_active = coalesce(is_active, true),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

update public.help_articles
set slug = 'artigo-' || left(replace(id::text, '-', ''), 12)
where slug is null or slug = '';

with duplicate_slugs as (
  select
    id,
    slug,
    row_number() over (
      partition by lower(slug)
      order by created_at, id
    ) as duplicate_number
  from public.help_articles
)
update public.help_articles article
set slug = left(duplicate.slug, 160) || '-' ||
  left(replace(article.id::text, '-', ''), 12)
from duplicate_slugs duplicate
where duplicate.id = article.id
  and duplicate.duplicate_number > 1;

do $$
begin
  if exists (
    select 1
    from public.help_articles
    where char_length(btrim(title)) not between 3 and 180
      or char_length(btrim(category)) not between 2 and 80
      or char_length(content) not between 1 and 20000
  ) then
    raise exception
      'help_articles contains legacy content outside the supported limits; review the rows before applying this migration';
  end if;
end;
$$;

alter table public.help_articles
  alter column slug set not null,
  alter column summary set not null,
  alter column module_key set not null,
  alter column display_order set not null,
  alter column is_active set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

alter table public.help_articles
  drop constraint if exists help_articles_slug_format_check,
  drop constraint if exists help_articles_title_length_check,
  drop constraint if exists help_articles_summary_length_check,
  drop constraint if exists help_articles_content_length_check,
  drop constraint if exists help_articles_category_length_check,
  drop constraint if exists help_articles_module_key_check,
  drop constraint if exists help_articles_visibility_check,
  drop constraint if exists help_articles_route_href_check,
  drop constraint if exists help_articles_action_label_length_check,
  drop constraint if exists help_articles_steps_check,
  drop constraint if exists help_articles_keywords_check,
  drop constraint if exists help_articles_related_slugs_check,
  drop constraint if exists help_articles_estimated_minutes_check;

alter table public.help_articles
  add constraint help_articles_slug_format_check
    check (
      char_length(slug) between 1 and 180
      and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    ),
  add constraint help_articles_title_length_check
    check (char_length(btrim(title)) between 3 and 180),
  add constraint help_articles_summary_length_check
    check (char_length(btrim(summary)) between 1 and 320),
  add constraint help_articles_content_length_check
    check (char_length(content) between 1 and 20000),
  add constraint help_articles_category_length_check
    check (char_length(btrim(category)) between 2 and 80),
  add constraint help_articles_module_key_check
    check (
      char_length(module_key) between 1 and 80
      and module_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    ),
  add constraint help_articles_visibility_check
    check (visibility in ('public', 'authenticated', 'all')),
  add constraint help_articles_route_href_check
    check (
      route_href is null
      or (
        route_href ~ '^/[A-Za-z0-9/_?=&.%+-]*$'
        and route_href !~ '^//'
      )
    ),
  add constraint help_articles_action_label_length_check
    check (action_label is null or char_length(btrim(action_label)) between 1 and 80),
  add constraint help_articles_steps_check
    check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 40),
  add constraint help_articles_keywords_check
    check (cardinality(search_keywords) <= 40),
  add constraint help_articles_related_slugs_check
    check (cardinality(related_slugs) <= 20),
  add constraint help_articles_estimated_minutes_check
    check (estimated_minutes between 1 and 60);

create unique index if not exists help_articles_slug_unique_idx
  on public.help_articles (lower(slug));

create index if not exists help_articles_active_catalog_idx
  on public.help_articles (is_active, visibility, module_key, display_order, updated_at desc);

create or replace function public.refresh_help_article_search_vector()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  accent_chars constant text := 'áàâãäéèêëíìîïóòôõöúùûüçñ';
  plain_chars constant text := 'aaaaaeeeeiiiiooooouuuucn';
  title_text text := coalesce(new.title, '');
  summary_keywords_text text := coalesce(new.summary, '') || ' ' ||
    coalesce(pg_catalog.array_to_string(new.search_keywords, ' '), '');
  content_text text := coalesce(new.category, '') || ' ' ||
    coalesce(new.content, '') || ' ' || coalesce(new.steps::text, '');
begin
  new.search_vector :=
    pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'portuguese'::pg_catalog.regconfig,
        title_text || ' ' ||
        pg_catalog.translate(pg_catalog.lower(title_text), accent_chars, plain_chars)
      ),
      'A'
    )
    ||
    pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'portuguese'::pg_catalog.regconfig,
        summary_keywords_text || ' ' ||
        pg_catalog.translate(
          pg_catalog.lower(summary_keywords_text),
          accent_chars,
          plain_chars
        )
      ),
      'B'
    )
    ||
    pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'portuguese'::pg_catalog.regconfig,
        content_text || ' ' ||
        pg_catalog.translate(pg_catalog.lower(content_text), accent_chars, plain_chars)
      ),
      'C'
    );
  return new;
end;
$$;

revoke all on function public.refresh_help_article_search_vector() from public, anon, authenticated;
grant execute on function public.refresh_help_article_search_vector() to postgres, service_role;

drop trigger if exists refresh_help_article_search_vector on public.help_articles;
create trigger refresh_help_article_search_vector
before insert or update of title, summary, category, content, search_keywords, steps
on public.help_articles
for each row
execute function public.refresh_help_article_search_vector();

update public.help_articles
set search_keywords = search_keywords;

alter table public.help_articles
  enable trigger update_help_articles_updated_at;

create index if not exists help_articles_search_vector_idx
  on public.help_articles using gin (search_vector);

revoke all on table public.help_articles from anon, authenticated;
grant select on table public.help_articles to authenticated;
revoke all on table public.help_articles from service_role;
grant select, insert, update, delete on table public.help_articles to service_role;

insert into public.help_articles (
  id,
  category,
  title,
  content,
  image_url,
  video_url,
  display_order,
  is_active,
  slug,
  summary,
  module_key,
  search_keywords,
  visibility,
  route_href,
  action_label,
  steps,
  related_slugs,
  estimated_minutes,
  last_reviewed_at
)
values
(
  '10000000-0000-4000-8000-000000000201'::uuid,
  'Primeiros passos',
  'Como começar a usar o Vimob?',
  'A Página inicial reúne atalhos, orientações e o seu foco operacional. Use o menu lateral para entrar em Pipeline, Conversas, Contatos, Agenda, Automações, Dashboard, Gestão e Configurações. Os itens disponíveis variam conforme o plano, o módulo e as permissões do seu usuário.',
  null,
  null,
  10,
  true,
  'como-comecar-a-usar-o-vimob',
  'Conheça a navegação do CRM, os módulos principais e a ordem recomendada para configurar o ambiente.',
  'getting-started',
  array['primeiro acesso', 'começar', 'início', 'página inicial', 'menu', 'navegação', 'módulos'],
  'all',
  '/inicio',
  'Abrir Página inicial',
  $json$[
    {"id":"inicio-1","title":"Comece pela Página inicial","body":"Veja os atalhos disponíveis e o bloco Seu foco agora. Ele usa dados reais do seu acesso e leva diretamente ao lead, tarefa ou compromisso correspondente.","actionLabel":"Abrir Página inicial","actionHref":"/inicio"},
    {"id":"inicio-2","title":"Confira seus acessos","body":"Se uma área não aparece no menu, confirme com um administrador se o módulo e a permissão necessários estão liberados para o seu usuário.","actionLabel":"Abrir Configurações","actionHref":"/settings?tab=team"},
    {"id":"inicio-3","title":"Monte a base comercial","body":"Cadastre usuários, configure o pipeline e conecte as integrações que sua operação realmente utiliza antes de iniciar o atendimento."}
  ]$json$::jsonb,
  array['como-convidar-um-usuario', 'como-criar-um-lead-no-pipeline', 'como-conectar-o-whatsapp'],
  4,
  now()
),
(
  '10000000-0000-4000-8000-000000000202'::uuid,
  'Pipeline e leads',
  'Como criar um lead no Pipeline?',
  'A criação manual registra uma nova oportunidade no funil. O formulário separa dados de contato, pessoa, interesse e gestão. A disponibilidade de campos e ações respeita a permissão de criação de leads do usuário.',
  null,
  null,
  20,
  true,
  'como-criar-um-lead-no-pipeline',
  'Abra o formulário de novo lead, preencha os dados essenciais e salve a oportunidade na etapa correta.',
  'pipeline',
  array['criar lead', 'novo lead', 'cadastrar lead', 'adicionar contato', 'oportunidade', 'pipeline'],
  'all',
  '/crm/pipelines?new=lead',
  'Criar lead',
  $json$[
    {"id":"lead-create-1","title":"Abra o formulário","body":"No Pipeline, use o botão Novo lead. O link abaixo já abre o mesmo fluxo quando seu usuário possui permissão.","imageUrl":"/help/screenshots/criar-lead.png","imageAlt":"Formulário Novo lead do Vimob","imageCaption":"O formulário organiza o cadastro em blocos e mostra os campos obrigatórios.","actionLabel":"Abrir novo lead","actionHref":"/crm/pipelines?new=lead","annotations":[{"x":91,"y":7,"label":"1","title":"Botão para fechar e voltar ao Pipeline"},{"x":50,"y":19,"label":"2","title":"Informe primeiro os dados essenciais do contato"}]},
    {"id":"lead-create-2","title":"Informe o contato","body":"Preencha o nome e, quando disponíveis, telefone e e-mail. Use dados reais e revise o DDD para evitar duplicidade ou falha no WhatsApp."},
    {"id":"lead-create-3","title":"Complete interesse e gestão","body":"Selecione pipeline, etapa, responsável ou equipe e informe os imóveis de interesse quando fizer sentido. Esses vínculos determinam onde a oportunidade aparece e quem poderá atendê-la."},
    {"id":"lead-create-4","title":"Salve e abra o lead","body":"Depois de salvar, o lead aparece no Pipeline. Abra o card para registrar atividades, agenda, feedback, tags, anexos e histórico."}
  ]$json$::jsonb,
  array['como-abrir-e-entender-o-detalhe-de-um-lead', 'como-mover-um-lead-entre-etapas', 'como-pesquisar-e-filtrar-leads-no-pipeline'],
  5,
  now()
),
(
  '10000000-0000-4000-8000-000000000203'::uuid,
  'Pipeline e leads',
  'Como mover um lead entre etapas?',
  'No quadro Kanban, arraste o card para a etapa de destino. A mudança é persistida no backend, atualiza o estágio atual e entra no histórico. Dependendo da configuração da etapa, a movimentação também pode iniciar cadências, SLA ou automações.',
  null,
  null,
  30,
  true,
  'como-mover-um-lead-entre-etapas',
  'Mova oportunidades no Kanban e entenda o que pode ser disparado quando o estágio muda.',
  'pipeline',
  array['mover lead', 'arrastar card', 'trocar etapa', 'mudar estágio', 'kanban', 'coluna'],
  'all',
  '/crm/pipelines',
  'Abrir Pipeline',
  $json$[
    {"id":"move-1","title":"Localize o lead","body":"Selecione o pipeline correto e use a busca ou os filtros se o card não estiver visível.","actionLabel":"Abrir Pipeline","actionHref":"/crm/pipelines"},
    {"id":"move-2","title":"Arraste para a etapa de destino","body":"Clique e segure o card, mova-o até a coluna desejada e solte. Aguarde a confirmação visual antes de sair da página."},
    {"id":"move-3","title":"Revise as consequências","body":"Cadências, SLA e automações configuradas para a etapa podem ser aplicadas após a mudança. Abra o detalhe do lead para conferir o histórico e as próximas atividades."}
  ]$json$::jsonb,
  array['como-pesquisar-e-filtrar-leads-no-pipeline', 'como-configurar-etapas-cadencias-e-sla', 'como-marcar-um-lead-como-ganho-perdido-ou-reabrir'],
  3,
  now()
),
(
  '10000000-0000-4000-8000-000000000204'::uuid,
  'Tarefas e cadências',
  'Como acompanhar tarefas e cadências?',
  'Cadências são sequências de tarefas vinculadas à configuração de uma etapa do pipeline. As atividades aparecem no detalhe do lead e na Agenda. Concluir, reabrir ou registrar o resultado mantém o histórico comercial coerente.',
  null,
  null,
  40,
  true,
  'como-acompanhar-tarefas-e-cadencias',
  'Veja onde as tarefas aparecem, como concluir atividades e como a cadência acompanha o lead.',
  'pipeline',
  array['cadência', 'cadencias', 'tarefas', 'follow-up', 'ligação', 'mensagem', 'atividade pendente'],
  'all',
  '/agenda',
  'Abrir Agenda',
  $json$[
    {"id":"cadence-view-1","title":"Consulte as pendências","body":"Abra a Agenda ou o detalhe do lead. Use os filtros de tipo, período e responsável para localizar a atividade correta.","actionLabel":"Abrir Agenda","actionHref":"/agenda"},
    {"id":"cadence-view-2","title":"Execute e registre o resultado","body":"Ao concluir uma ligação, mensagem, e-mail ou visita, registre o resultado solicitado. Isso evita que uma tarefa seja encerrada sem contexto."},
    {"id":"cadence-view-3","title":"Corrija quando necessário","body":"Uma tarefa concluída pode ser reaberta quando o fluxo permitir. Para mudar a sequência futura, um usuário com permissão de pipeline deve editar a configuração da etapa."}
  ]$json$::jsonb,
  array['como-configurar-etapas-cadencias-e-sla', 'como-criar-e-editar-um-agendamento'],
  4,
  now()
),
(
  '10000000-0000-4000-8000-000000000205'::uuid,
  'Agenda',
  'Como criar e editar um agendamento?',
  'A Agenda permite criar ligações, e-mails, reuniões, tarefas, mensagens e visitas. Um agendamento pode ter data, duração, dia inteiro, recorrência, responsável, equipe, visibilidade, lead e imóvel relacionado.',
  null,
  null,
  50,
  true,
  'como-criar-e-editar-um-agendamento',
  'Crie compromissos completos, vincule o lead e acompanhe o trabalho no calendário.',
  'schedule',
  array['agenda', 'agendamento', 'evento', 'tarefa', 'visita', 'reunião', 'ligação', 'compromisso'],
  'all',
  '/agenda',
  'Abrir Agenda',
  $json$[
    {"id":"schedule-1","title":"Abra Novo agendamento","body":"Na Agenda, clique em Novo agendamento ou selecione um horário disponível no calendário.","imageUrl":"/help/screenshots/novo-agendamento.png","imageAlt":"Painel de criação de agendamento no Vimob","imageCaption":"O painel reúne tipo, título, período e vínculos do compromisso.","actionLabel":"Abrir Agenda","actionHref":"/agenda","annotations":[{"x":13,"y":12,"label":"1","title":"Escolha o tipo do agendamento"},{"x":78,"y":88,"label":"2","title":"Revise os dados e salve"}]},
    {"id":"schedule-2","title":"Defina tipo, período e recorrência","body":"Escolha a atividade, informe título, início e duração. Ative dia inteiro ou recorrência somente quando o compromisso exigir."},
    {"id":"schedule-3","title":"Vincule pessoas e contexto","body":"Selecione responsável, equipe, visibilidade e o lead relacionado. O imóvel é opcional e depende do módulo de imóveis."},
    {"id":"schedule-4","title":"Edite ou conclua","body":"Clique no evento para abrir os detalhes. Usuários autorizados podem editar, arrastar, redimensionar, concluir, reabrir ou excluir."}
  ]$json$::jsonb,
  array['como-conectar-o-google-agenda', 'como-acompanhar-tarefas-e-cadencias'],
  5,
  now()
),
(
  '10000000-0000-4000-8000-000000000206'::uuid,
  'Conversas e WhatsApp',
  'Como usar Conversas no Vimob?',
  'A tela Conversas reúne atendimentos das conexões de WhatsApp acessíveis ao usuário. É possível pesquisar, filtrar, ler o histórico, enviar mensagens, trabalhar com mídia e abrir o lead relacionado sem perder o contexto.',
  null,
  null,
  60,
  true,
  'como-usar-conversas-no-vimob',
  'Selecione a conexão, encontre um atendimento e use o histórico e os filtros de Conversas.',
  'conversations',
  array['conversas', 'whatsapp', 'chat', 'atendimento', 'mensagens', 'buscar conversa', 'histórico'],
  'all',
  '/crm/conversas',
  'Abrir Conversas',
  $json$[
    {"id":"conversation-1","title":"Selecione a conexão","body":"Quando houver mais de uma sessão disponível, escolha a conexão que atende o canal desejado.","actionLabel":"Abrir Conversas","actionHref":"/crm/conversas"},
    {"id":"conversation-2","title":"Pesquise ou filtre","body":"Busque por contato, nome, telefone, texto ou identificador. Combine filtros de grupos, arquivadas, somente leads, sem lead ou aguardando resposta."},
    {"id":"conversation-3","title":"Abra o histórico","body":"Selecione a conversa e carregue mensagens antigas quando necessário. Marque a conversa como lida depois de revisar o contexto."},
    {"id":"conversation-4","title":"Use o painel do lead","body":"Quando a conversa está vinculada, abra o lead no Pipeline. Se não estiver, cadastre o contato a partir da própria conversa quando tiver permissão."}
  ]$json$::jsonb,
  array['como-conectar-o-whatsapp', 'como-enviar-texto-audio-e-arquivos-no-whatsapp', 'como-abrir-e-entender-o-detalhe-de-um-lead'],
  5,
  now()
),
(
  '10000000-0000-4000-8000-000000000207'::uuid,
  'Imóveis',
  'Como cadastrar e publicar imóveis?',
  'O cadastro de imóvel organiza proprietário, dados gerais, localização, valores, características, extras, mídia, descrição, publicação, comissões e informações confidenciais. Os recursos disponíveis dependem do segmento, módulo e permissões da organização.',
  null,
  null,
  70,
  true,
  'como-cadastrar-e-publicar-imoveis',
  'Cadastre um imóvel completo e revise os dados necessários antes de publicar no site.',
  'properties',
  array['imóvel', 'imoveis', 'cadastrar imóvel', 'publicar imóvel', 'fotos', 'proprietário', 'site'],
  'all',
  '/properties/new',
  'Cadastrar imóvel',
  $json$[
    {"id":"property-1","title":"Abra o cadastro","body":"Em Imóveis, escolha Novo imóvel. O link abaixo abre diretamente o formulário quando o módulo está disponível.","actionLabel":"Cadastrar imóvel","actionHref":"/properties/new"},
    {"id":"property-2","title":"Preencha os blocos do formulário","body":"Informe proprietário, tipo, localização, valores, características e descrições. Salve dados consistentes para facilitar busca e publicação."},
    {"id":"property-3","title":"Adicione mídia com contexto","body":"Envie fotos adequadas, escolha a ordem e revise o conteúdo que ficará visível no site."},
    {"id":"property-4","title":"Revise a publicação","body":"Antes de publicar, confira status, campos confidenciais, condições comerciais e a configuração do site da organização."}
  ]$json$::jsonb,
  array['como-comecar-a-usar-o-vimob'],
  6,
  now()
),
(
  '10000000-0000-4000-8000-000000000208'::uuid,
  'Automações',
  'Como criar uma automação?',
  'O construtor visual de automações funciona no desktop. Você escolhe um gatilho, conecta ações e condições, simula o fluxo, salva e só então ativa. No celular é possível consultar lista, modelos e histórico, mas não montar o diagrama.',
  null,
  null,
  80,
  true,
  'como-criar-uma-automacao',
  'Crie um fluxo determinístico, teste o caminho e ative somente depois de validar a execução.',
  'automations',
  array['criar automação', 'nova automação', 'fluxo', 'gatilho', 'condição', 'ação', 'follow-up', 'builder'],
  'all',
  '/automations?tab=automations',
  'Abrir Automações',
  $json$[
    {"id":"automation-create-1","title":"Inicie no desktop","body":"Abra Automações e clique em Nova automação. O construtor visual não fica disponível no celular.","imageUrl":"/help/screenshots/nova-automacao.png","imageAlt":"Tela de criação de automação no Vimob","imageCaption":"Comece do zero ou escolha um modelo compatível com o processo.","actionLabel":"Abrir Automações","actionHref":"/automations?tab=automations","annotations":[{"x":88,"y":8,"label":"1","title":"Botão Nova automação"},{"x":21,"y":34,"label":"2","title":"Lista de automações e estado de ativação"}]},
    {"id":"automation-create-2","title":"Escolha o gatilho","body":"Use mensagem recebida, agendamento, mudança de etapa, lead criado, tag adicionada, inatividade ou execução manual."},
    {"id":"automation-create-3","title":"Monte o fluxo","body":"Adicione texto, imagem, vídeo, áudio, condição, espera, webhook, tag ou mudança de etapa. Configure a sessão de WhatsApp e use variáveis como {{lead.name}} e {{lead.phone}} quando necessário."},
    {"id":"automation-create-4","title":"Simule, salve e ative","body":"Execute o simulador, corrija blocos inválidos, salve o rascunho e ative apenas depois de conferir todos os caminhos."}
  ]$json$::jsonb,
  array['como-criar-uma-automacao-a-partir-de-um-modelo', 'como-acompanhar-execucoes-e-erros-de-automacao'],
  7,
  now()
),
(
  '10000000-0000-4000-8000-000000000209'::uuid,
  'Gestão e distribuição',
  'Como funciona a distribuição de leads?',
  'A distribuição usa filas e regras para encaminhar oportunidades a usuários ou equipes. Pesos, disponibilidade, origem e critérios configurados influenciam o destino. O backend registra o histórico da atribuição e respeita o escopo da organização.',
  null,
  null,
  90,
  true,
  'como-funciona-a-distribuicao-de-leads',
  'Entenda filas, participantes, pesos e regras usadas para atribuir novas oportunidades.',
  'management',
  array['distribuição', 'roleta', 'round robin', 'fila', 'peso', 'atribuição', 'responsável'],
  'all',
  '/crm/management?tab=distribution',
  'Abrir Distribuição',
  $json$[
    {"id":"distribution-1","title":"Abra a área de Distribuição","body":"Em Gestão, escolha Distribuição. A edição exige a permissão correspondente.","actionLabel":"Abrir Distribuição","actionHref":"/crm/management?tab=distribution"},
    {"id":"distribution-2","title":"Defina participantes e pesos","body":"Inclua apenas usuários que realmente atendem aquele fluxo e ajuste pesos de forma consciente."},
    {"id":"distribution-3","title":"Configure critérios","body":"Use origem, campanha, tag ou outras condições disponíveis para encaminhar cada entrada à fila correta."},
    {"id":"distribution-4","title":"Acompanhe o resultado","body":"Confira o responsável no lead e use o histórico de distribuição para investigar uma atribuição inesperada."}
  ]$json$::jsonb,
  array['como-criar-e-gerenciar-equipes', 'como-atribuir-ou-redistribuir-um-lead'],
  5,
  now()
),
(
  '10000000-0000-4000-8000-000000000210'::uuid,
  'Dashboard',
  'Como usar os filtros do Dashboard?',
  'O Dashboard geral apresenta indicadores comerciais conforme o período e o escopo de acesso. Os filtros podem incluir time, usuário, origem, campanha, conjunto, anúncio, tag, status e pesquisa. Dashboard de campanhas e Dashboard do site possuem permissões próprias.',
  null,
  null,
  100,
  true,
  'como-usar-os-filtros-do-dashboard',
  'Aplique filtros para analisar o mesmo recorte em KPIs, funil, evolução e origens.',
  'dashboard',
  array['dashboard', 'painel', 'filtros', 'período', 'equipe', 'corretor', 'origem', 'campanha'],
  'all',
  '/dashboard',
  'Abrir Dashboard',
  $json$[
    {"id":"dashboard-filter-1","title":"Defina o período","body":"Escolha o intervalo analisado antes de comparar indicadores. Alguns números consideram a data de captação; outros, a data em que o negócio foi ganho ou perdido.","actionLabel":"Abrir Dashboard","actionHref":"/dashboard"},
    {"id":"dashboard-filter-2","title":"Aplique o recorte operacional","body":"Use time, usuário, origem, campanha, anúncio, tag, status ou pesquisa conforme sua permissão."},
    {"id":"dashboard-filter-3","title":"Leia o conjunto completo","body":"Compare KPIs, funil por pipeline, evolução e origens. Clicar em uma origem ou detalhe pode abrir o recorte correspondente."},
    {"id":"dashboard-filter-4","title":"Respeite o escopo","body":"Os números refletem somente os leads que seu papel permite visualizar."}
  ]$json$::jsonb,
  array['o-que-significam-os-kpis-do-dashboard'],
  5,
  now()
),
(
  '10000000-0000-4000-8000-000000000211'::uuid,
  'Notificações',
  'Como acompanhar notificações?',
  'O sino no cabeçalho mostra avisos recentes e a quantidade não lida. A página de Notificações reúne a lista completa. Quando um aviso possui destino válido, selecioná-lo abre diretamente o item relacionado.',
  null,
  null,
  110,
  true,
  'como-acompanhar-notificacoes',
  'Consulte avisos, marque itens como lidos e abra o destino relacionado.',
  'notifications',
  array['notificações', 'sino', 'avisos', 'não lidas', 'push', 'alertas'],
  'all',
  '/notifications',
  'Abrir Notificações',
  $json$[
    {"id":"notification-1","title":"Abra o sino","body":"Use o contador no cabeçalho para ver os avisos mais recentes."},
    {"id":"notification-2","title":"Consulte a lista completa","body":"Na página Notificações, revise os itens não lidos e use as ações disponíveis.","actionLabel":"Abrir Notificações","actionHref":"/notifications"},
    {"id":"notification-3","title":"Abra o contexto","body":"Quando houver um link de destino, selecione a notificação para ir ao lead, tarefa, conversa ou configuração relacionada."}
  ]$json$::jsonb,
  array['como-comecar-a-usar-o-vimob'],
  3,
  now()
),
(
  '10000000-0000-4000-8000-000000000212'::uuid,
  'Contatos',
  'Como gerenciar contatos?',
  'Contatos é a visão pesquisável da base de leads da organização. A tela permite filtrar, ordenar, paginar, criar, abrir, importar, exportar e excluir conforme o escopo e as permissões do usuário.',
  null,
  null,
  120,
  true,
  'como-gerenciar-contatos',
  'Pesquise a base, aplique filtros e abra o detalhe completo de uma pessoa ou oportunidade.',
  'contacts',
  array['contatos', 'lista de leads', 'base', 'buscar pessoa', 'telefone', 'email'],
  'all',
  '/crm/contacts',
  'Abrir Contatos',
  $json$[
    {"id":"contacts-1","title":"Pesquise a base","body":"Use nome, telefone ou e-mail. A busca acontece no backend e respeita seu escopo de visualização.","actionLabel":"Abrir Contatos","actionHref":"/crm/contacts"},
    {"id":"contacts-2","title":"Refine os resultados","body":"Combine período, time, pipeline, etapa, responsável, tag, origem, campanha e status conforme necessário."},
    {"id":"contacts-3","title":"Abra o detalhe","body":"Selecione um contato para revisar dados, negócio, agenda, atividades e histórico."},
    {"id":"contacts-4","title":"Use ações em massa com cuidado","body":"Importação, exportação e exclusão aparecem somente para quem possui as permissões correspondentes."}
  ]$json$::jsonb,
  array['como-importar-contatos', 'como-exportar-contatos-em-csv', 'como-abrir-e-entender-o-detalhe-de-um-lead'],
  5,
  now()
),
(
  '10000000-0000-4000-8000-000000000213'::uuid,
  'Equipes e permissões',
  'Como criar e gerenciar equipes?',
  'A área Equipes organiza membros, líderes, disponibilidade e vínculos com pipelines. Ela é diferente da tela Usuários, onde são enviados convites e configuradas permissões individuais.',
  null,
  null,
  130,
  true,
  'como-criar-e-gerenciar-equipes',
  'Monte times operacionais, defina liderança e vincule os pipelines corretos.',
  'management',
  array['equipes', 'times', 'líder', 'membros', 'pipeline da equipe', 'disponibilidade'],
  'all',
  '/crm/management?tab=teams',
  'Abrir Equipes',
  $json$[
    {"id":"team-1","title":"Abra Equipes em Gestão","body":"A criação e edição dependem da permissão de gestão de equipes.","actionLabel":"Abrir Equipes","actionHref":"/crm/management?tab=teams"},
    {"id":"team-2","title":"Defina membros e liderança","body":"Inclua usuários ativos, marque a liderança correta e revise a disponibilidade de quem participa da operação."},
    {"id":"team-3","title":"Vincule pipelines","body":"Associe somente os pipelines que o time precisa acompanhar. Isso influencia visibilidade e distribuição."},
    {"id":"team-4","title":"Separe equipe de acesso","body":"Para convidar uma pessoa ou alterar permissões individuais, use Configurações > Usuários."}
  ]$json$::jsonb,
  array['como-convidar-um-usuario', 'como-configurar-permissoes-e-remover-usuarios', 'como-funciona-a-distribuicao-de-leads'],
  5,
  now()
),
(
  '20000000-0000-4000-8000-000000000214'::uuid,
  'Pipeline e leads',
  'Como abrir e entender o detalhe de um lead?',
  'O detalhe do lead centraliza contato, negócio, atividades, agenda e histórico. Também pode mostrar tags, imóveis de interesse, anexos, feedback, responsável, cadência e ações comerciais conforme as permissões.',
  null,
  null,
  140,
  true,
  'como-abrir-e-entender-o-detalhe-de-um-lead',
  'Abra uma oportunidade e entenda onde consultar contato, negócio, agenda e histórico.',
  'pipeline',
  array['detalhe do lead', 'histórico lead', 'perfil lead', 'atividades', 'feedback', 'anexos', 'agenda lead'],
  'all',
  '/crm/pipelines',
  'Abrir Pipeline',
  $json$[
    {"id":"lead-detail-1","title":"Abra o card ou um resultado de busca","body":"No Pipeline, Contatos, Conversas ou Página inicial, selecione o lead. Links diretos usam /crm/pipelines?lead={id}.","actionLabel":"Abrir Pipeline","actionHref":"/crm/pipelines"},
    {"id":"lead-detail-2","title":"Revise contato e negócio","body":"Confira nome, telefone, e-mail, origem, pipeline, etapa, responsável, valor e imóveis de interesse antes de alterar qualquer informação."},
    {"id":"lead-detail-3","title":"Registre a operação","body":"Use atividades, agenda, resultados de contato, tags, feedback e anexos para manter o contexto compartilhado."},
    {"id":"lead-detail-4","title":"Consulte o histórico","body":"O histórico ajuda a entender mensagens, mudanças de etapa, responsáveis, tarefas e outras ações já registradas."}
  ]$json$::jsonb,
  array['como-criar-um-lead-no-pipeline', 'como-marcar-um-lead-como-ganho-perdido-ou-reabrir', 'como-atribuir-ou-redistribuir-um-lead'],
  5,
  now()
),
(
  '20000000-0000-4000-8000-000000000215'::uuid,
  'Pipeline e leads',
  'Como pesquisar e filtrar leads no Pipeline?',
  'A pesquisa encontra leads pelo conteúdo disponível no quadro e, quando necessário, consulta páginas adicionais no backend. Filtros de tag, status, origem, campanha, anúncio, responsável e outros campos reduzem o quadro sem ignorar o escopo de acesso.',
  null,
  null,
  150,
  true,
  'como-pesquisar-e-filtrar-leads-no-pipeline',
  'Encontre um lead por nome, telefone ou e-mail e combine filtros comerciais.',
  'pipeline',
  array['buscar lead', 'pesquisa pipeline', 'filtro pipeline', 'telefone', 'email', 'responsável', 'origem', 'campanha'],
  'all',
  '/crm/pipelines',
  'Abrir Pipeline',
  $json$[
    {"id":"pipeline-search-1","title":"Escolha o pipeline correto","body":"O quadro e as contagens dependem do pipeline selecionado.","actionLabel":"Abrir Pipeline","actionHref":"/crm/pipelines"},
    {"id":"pipeline-search-2","title":"Digite a busca","body":"Use nome, telefone ou e-mail. Aguarde o carregamento dos resultados antes de concluir que o lead não existe."},
    {"id":"pipeline-search-3","title":"Aplique filtros","body":"Combine somente os filtros necessários. Muitos filtros simultâneos podem esconder um resultado válido."},
    {"id":"pipeline-search-4","title":"Limpe o recorte","body":"Remova filtros e revise seu escopo de permissão se um lead esperado não aparecer."}
  ]$json$::jsonb,
  array['como-gerenciar-contatos', 'como-abrir-e-entender-o-detalhe-de-um-lead'],
  4,
  now()
),
(
  '20000000-0000-4000-8000-000000000216'::uuid,
  'Pipeline e leads',
  'Como configurar etapas, cadências e SLA?',
  'As configurações de etapas ficam no próprio Pipeline. Usuários com permissão de gestão de pipeline podem criar, renomear, colorir, reordenar ou excluir etapas, configurar tarefas de cadência, automações de etapa e regras de SLA.',
  null,
  null,
  160,
  true,
  'como-configurar-etapas-cadencias-e-sla',
  'Ajuste as colunas do funil e defina o acompanhamento que começa quando o lead entra em uma etapa.',
  'pipeline',
  array['etapas', 'colunas', 'cadência por etapa', 'sla', 'automação de etapa', 'renomear etapa', 'ordenar etapas'],
  'authenticated',
  '/crm/pipelines',
  'Abrir Pipeline',
  $json$[
    {"id":"stage-1","title":"Abra as configurações do Pipeline","body":"Selecione o pipeline e use a ação de configuração disponível para usuários com pipeline_manage.","actionLabel":"Abrir Pipeline","actionHref":"/crm/pipelines"},
    {"id":"stage-2","title":"Organize as etapas","body":"Crie, renomeie, escolha cores e reordene as colunas para representar o processo real da equipe."},
    {"id":"stage-3","title":"Configure a cadência da etapa","body":"Adicione as tarefas que devem nascer quando o lead entra na etapa. Não existe hoje uma aba autônoma de Cadências na Gestão."},
    {"id":"stage-4","title":"Revise automações e SLA","body":"Configure automações de etapa somente com o módulo disponível e defina os tempos de SLA que fazem sentido para aquele estágio."}
  ]$json$::jsonb,
  array['como-acompanhar-tarefas-e-cadencias', 'como-mover-um-lead-entre-etapas', 'como-criar-uma-automacao'],
  6,
  now()
),
(
  '20000000-0000-4000-8000-000000000217'::uuid,
  'Contatos',
  'Como importar contatos?',
  'A importação aceita arquivo CSV ou Excel e permite mapear os dados para a estrutura do CRM. Revise pipeline, etapa, responsável e tags antes de confirmar. A ação exige permissão de importação.',
  null,
  null,
  170,
  true,
  'como-importar-contatos',
  'Importe uma planilha, valide o mapeamento e corrija linhas inválidas antes de concluir.',
  'contacts',
  array['importar contatos', 'importar leads', 'csv', 'excel', 'planilha', 'mapear colunas'],
  'all',
  '/crm/contacts',
  'Abrir Contatos',
  $json$[
    {"id":"contact-import-1","title":"Prepare o arquivo","body":"Mantenha cabeçalhos claros e dados consistentes. Nome é essencial; telefone e e-mail ajudam na identificação e no atendimento."},
    {"id":"contact-import-2","title":"Abra Importar em Contatos","body":"A ação aparece para usuários com permissão lead_import.","actionLabel":"Abrir Contatos","actionHref":"/crm/contacts"},
    {"id":"contact-import-3","title":"Revise o mapeamento","body":"Confirme como cada coluna do arquivo corresponde a contato, pipeline, responsável e tags."},
    {"id":"contact-import-4","title":"Corrija antes de confirmar","body":"Use a prévia e as mensagens de validação para evitar cadastros incompletos ou no destino errado."}
  ]$json$::jsonb,
  array['como-gerenciar-contatos', 'como-exportar-contatos-em-csv'],
  6,
  now()
),
(
  '20000000-0000-4000-8000-000000000218'::uuid,
  'Contatos',
  'Como exportar contatos em CSV?',
  'A exportação gera um arquivo CSV com os contatos que pertencem ao recorte atual. Antes de exportar, confirme pesquisa, filtros e permissões para não gerar uma base diferente da esperada.',
  null,
  null,
  180,
  true,
  'como-exportar-contatos-em-csv',
  'Aplique o recorte certo e exporte os resultados filtrados em CSV.',
  'contacts',
  array['exportar contatos', 'exportar leads', 'csv', 'baixar base', 'planilha'],
  'all',
  '/crm/contacts',
  'Abrir Contatos',
  $json$[
    {"id":"contact-export-1","title":"Defina o recorte","body":"Aplique pesquisa, período, time, pipeline, etapa, responsável, origem, campanha, tag ou status.","actionLabel":"Abrir Contatos","actionHref":"/crm/contacts"},
    {"id":"contact-export-2","title":"Confira a quantidade","body":"Revise a paginação e o total informado pela tela antes de iniciar."},
    {"id":"contact-export-3","title":"Use Exportar","body":"O botão aparece para usuários com lead_export. O formato atual é CSV, não XLSX."},
    {"id":"contact-export-4","title":"Proteja o arquivo","body":"O CSV pode conter dados pessoais e comerciais. Armazene e compartilhe somente com pessoas autorizadas."}
  ]$json$::jsonb,
  array['como-gerenciar-contatos', 'como-importar-contatos'],
  4,
  now()
),
(
  '20000000-0000-4000-8000-000000000219'::uuid,
  'Conversas e WhatsApp',
  'Como conectar o WhatsApp?',
  'A conexão é criada em Configurações, na área de Integrações do WhatsApp. Informe um nome para a sessão, gere o QR Code e leia com o aparelho correto. O limite de sessões depende do plano e da organização.',
  null,
  null,
  190,
  true,
  'como-conectar-o-whatsapp',
  'Crie uma sessão, leia o QR Code e confira se a conexão ficou pronta para uso.',
  'conversations',
  array['conectar whatsapp', 'qr code', 'nova sessão', 'instância', 'evolution', 'reconectar whatsapp'],
  'all',
  '/settings?tab=whatsapp',
  'Configurar WhatsApp',
  $json$[
    {"id":"whatsapp-connect-1","title":"Abra a integração","body":"Em Configurações, entre em Integrações e selecione WhatsApp. A área exige o módulo e a permissão de gestão.","imageUrl":"/help/screenshots/conectar-whatsapp.png","imageAlt":"Configuração de uma conexão WhatsApp no Vimob","imageCaption":"Crie uma sessão identificável e use o QR Code no aparelho correto.","actionLabel":"Configurar WhatsApp","actionHref":"/settings?tab=whatsapp","annotations":[{"x":86,"y":12,"label":"1","title":"Ação para criar uma nova conexão"},{"x":54,"y":51,"label":"2","title":"Status e ações da sessão"}]},
    {"id":"whatsapp-connect-2","title":"Nomeie a sessão","body":"Use um nome que identifique canal, equipe ou finalidade. Isso facilita selecionar a conexão em Conversas e Automações."},
    {"id":"whatsapp-connect-3","title":"Leia o QR Code","body":"No aparelho correto, abra os dispositivos conectados do WhatsApp e leia o código exibido. Aguarde a confirmação do status."},
    {"id":"whatsapp-connect-4","title":"Valide a operação","body":"Abra Conversas, selecione a sessão e confirme que o histórico e o envio estão disponíveis. Se necessário, use atualizar, recriar ou reconectar."}
  ]$json$::jsonb,
  array['como-usar-conversas-no-vimob', 'como-enviar-texto-audio-e-arquivos-no-whatsapp'],
  6,
  now()
),
(
  '20000000-0000-4000-8000-000000000220'::uuid,
  'Conversas e WhatsApp',
  'Como enviar texto, áudio e arquivos no WhatsApp?',
  'O compositor de Conversas permite texto, imagem, vídeo, áudio gravado e documentos. Também é possível reagir a mensagens e repetir o envio de mídia quando a ação estiver disponível.',
  null,
  null,
  200,
  true,
  'como-enviar-texto-audio-e-arquivos-no-whatsapp',
  'Envie mensagens e mídias mantendo o atendimento vinculado ao lead correto.',
  'conversations',
  array['enviar mensagem', 'áudio whatsapp', 'imagem', 'vídeo', 'arquivo', 'documento', 'gravar áudio', 'reagir'],
  'all',
  '/crm/conversas',
  'Abrir Conversas',
  $json$[
    {"id":"message-1","title":"Confirme conversa e conexão","body":"Antes de enviar, revise o contato aberto e a sessão selecionada.","actionLabel":"Abrir Conversas","actionHref":"/crm/conversas"},
    {"id":"message-2","title":"Escolha o formato","body":"Digite texto ou use as ações de anexo e áudio. Confira arquivo, tamanho e destinatário."},
    {"id":"message-3","title":"Envie e aguarde o estado","body":"Não repita imediatamente. Observe o estado da mensagem e use repetir somente quando houver indicação de falha."},
    {"id":"message-4","title":"Mantenha o lead vinculado","body":"Cadastre ou abra o lead relacionado para preservar histórico, tags, agenda e automações do atendimento."}
  ]$json$::jsonb,
  array['como-usar-conversas-no-vimob', 'como-conectar-o-whatsapp'],
  4,
  now()
),
(
  '20000000-0000-4000-8000-000000000221'::uuid,
  'Automações',
  'Como criar uma automação a partir de um modelo?',
  'Modelos ajudam a iniciar um fluxo com uma estrutura pronta. Eles não eliminam a revisão: confira gatilho, conexão, mensagens, esperas, condições, tags, etapas e variáveis antes de salvar e ativar.',
  null,
  null,
  210,
  true,
  'como-criar-uma-automacao-a-partir-de-um-modelo',
  'Escolha um modelo, adapte cada bloco ao processo e valide antes de ativar.',
  'automations',
  array['modelo de automação', 'template automação', 'follow-up pronto', 'duplicar fluxo'],
  'all',
  '/automations?tab=templates',
  'Ver modelos',
  $json$[
    {"id":"template-1","title":"Abra Modelos","body":"Consulte os modelos disponíveis e escolha o ponto de partida mais próximo do seu objetivo.","actionLabel":"Ver modelos","actionHref":"/automations?tab=templates"},
    {"id":"template-2","title":"Revise todos os blocos","body":"Troque mensagens, sessão do WhatsApp, tempos de espera, condições, tags e etapas que não pertencem ao seu processo."},
    {"id":"template-3","title":"Simule os caminhos","body":"Teste respostas e condições no simulador para localizar blocos desconectados ou inválidos."},
    {"id":"template-4","title":"Salve e ative conscientemente","body":"O modelo só deve entrar em produção depois da revisão completa."}
  ]$json$::jsonb,
  array['como-criar-uma-automacao', 'como-acompanhar-execucoes-e-erros-de-automacao'],
  5,
  now()
),
(
  '20000000-0000-4000-8000-000000000222'::uuid,
  'Automações',
  'Como acompanhar execuções e erros de automação?',
  'A aba Histórico mostra execuções, etapas percorridas, falhas e ações disponíveis. Usuários autorizados podem cancelar execuções em andamento e tentar novamente operações compatíveis.',
  null,
  null,
  220,
  true,
  'como-acompanhar-execucoes-e-erros-de-automacao',
  'Use o Histórico para entender uma execução, cancelar um fluxo ou investigar uma falha.',
  'automations',
  array['histórico automação', 'execução automação', 'erro automação', 'falha', 'retry', 'tentar novamente', 'saúde'],
  'all',
  '/automations?tab=history',
  'Abrir Histórico',
  $json$[
    {"id":"automation-history-1","title":"Abra Histórico","body":"A antiga aba Saúde foi incorporada ao Histórico. Use filtros para localizar a automação, o lead ou o estado da execução.","actionLabel":"Abrir Histórico","actionHref":"/automations?tab=history"},
    {"id":"automation-history-2","title":"Abra a execução","body":"Confira o gatilho, cada etapa, horários, tentativas e a mensagem de erro apresentada."},
    {"id":"automation-history-3","title":"Decida a ação","body":"Cancele uma execução ainda ativa ou tente novamente somente quando a causa já estiver corrigida."},
    {"id":"automation-history-4","title":"Corrija o fluxo na origem","body":"Se a falha se repetir, edite a automação e revise sessão, mídia, webhook, variável ou conexão envolvida."}
  ]$json$::jsonb,
  array['como-criar-uma-automacao', 'como-criar-uma-automacao-a-partir-de-um-modelo'],
  5,
  now()
),
(
  '20000000-0000-4000-8000-000000000223'::uuid,
  'Agenda',
  'Como conectar o Google Agenda?',
  'A integração fica dentro da Agenda. Usuários autorizados podem conectar ou desconectar a conta Google, ativar a sincronização e executar uma sincronização manual. A disponibilidade global também depende da configuração do produto.',
  null,
  null,
  230,
  true,
  'como-conectar-o-google-agenda',
  'Autorize sua conta Google, ajuste a sincronização e confirme o estado da conexão.',
  'schedule',
  array['google agenda', 'google calendar', 'sincronizar agenda', 'conectar calendário', 'oauth'],
  'all',
  '/agenda',
  'Abrir Agenda',
  $json$[
    {"id":"google-1","title":"Abra Google Agenda","body":"Na barra da Agenda, selecione Google Agenda.","actionLabel":"Abrir Agenda","actionHref":"/agenda"},
    {"id":"google-2","title":"Autorize a conta correta","body":"Confira qual conta Google está aberta antes de aceitar o acesso."},
    {"id":"google-3","title":"Ajuste a sincronização","body":"Depois do retorno ao Vimob, ative ou desative a sincronização conforme sua necessidade."},
    {"id":"google-4","title":"Sincronize e valide","body":"Use Sincronizar agora quando disponível e confira se os eventos esperados aparecem sem duplicidade."}
  ]$json$::jsonb,
  array['como-criar-e-editar-um-agendamento'],
  4,
  now()
),
(
  '20000000-0000-4000-8000-000000000224'::uuid,
  'Usuários e permissões',
  'Como convidar um usuário?',
  'Convites são enviados por e-mail e não geram senha pronta. Escolha a função inicial admin ou usuário. O destinatário usa o link para criar o acesso ou associar uma conta existente à organização.',
  null,
  null,
  240,
  true,
  'como-convidar-um-usuario',
  'Envie um convite seguro por e-mail e acompanhe os estados pendente, expirado ou aceito.',
  'users',
  array['convidar usuário', 'adicionar usuário', 'novo usuário', 'convite email', 'equipe', 'admin'],
  'all',
  '/settings?tab=team',
  'Abrir Usuários',
  $json$[
    {"id":"invite-1","title":"Abra Usuários","body":"Em Configurações, entre na aba Usuários. A ação exige permissão de gestão de usuários.","imageUrl":"/help/screenshots/convidar-usuario.png","imageAlt":"Painel Convidar usuário do Vimob","imageCaption":"Informe o e-mail e escolha a função inicial antes de enviar.","actionLabel":"Abrir Usuários","actionHref":"/settings?tab=team","annotations":[{"x":79,"y":12,"label":"1","title":"Botão Novo usuário"},{"x":51,"y":36,"label":"2","title":"E-mail e função do convite"},{"x":84,"y":87,"label":"3","title":"Enviar convite"}]},
    {"id":"invite-2","title":"Informe e-mail e função","body":"Revise o endereço e escolha admin ou usuário. Permissões individuais podem ser ajustadas depois."},
    {"id":"invite-3","title":"Envie e acompanhe","body":"O convite aparece como pendente. Se expirar, reenviar cria um novo link válido por sete dias; cancelar invalida o acesso pendente."},
    {"id":"invite-4","title":"Oriente o destinatário","body":"Uma pessoa nova informa nome, WhatsApp, senha e aceita os documentos legais. Quem já possui conta pode aceitar usando o acesso existente."}
  ]$json$::jsonb,
  array['como-configurar-permissoes-e-remover-usuarios', 'como-criar-e-gerenciar-equipes'],
  6,
  now()
),
(
  '20000000-0000-4000-8000-000000000225'::uuid,
  'Usuários e permissões',
  'Como configurar permissões e remover usuários?',
  'A tela individual permite alterar permissões específicas e restaurar o padrão. Ao excluir um usuário, o Vimob mostra o impacto e pode exigir a transferência de leads e imóveis para outro usuário ativo. Conexões de WhatsApp são desconectadas, não transferidas.',
  null,
  null,
  250,
  true,
  'como-configurar-permissoes-e-remover-usuarios',
  'Ajuste acessos individuais e transfira responsabilidades antes de remover uma pessoa.',
  'users',
  array['permissões', 'acesso usuário', 'remover usuário', 'excluir usuário', 'transferir leads', 'desativar usuário'],
  'authenticated',
  '/settings?tab=team',
  'Abrir Usuários',
  $json$[
    {"id":"permission-1","title":"Abra o usuário","body":"Em Configurações > Usuários, selecione a pessoa. A tela de permissões exige permissions_manage.","actionLabel":"Abrir Usuários","actionHref":"/settings?tab=team"},
    {"id":"permission-2","title":"Ajuste ou restaure","body":"Salve somente os acessos necessários. Use restaurar quando quiser voltar ao padrão da função."},
    {"id":"permission-3","title":"Desative quando for temporário","body":"Desativar preserva o registro e bloqueia o uso sem executar a exclusão definitiva."},
    {"id":"permission-4","title":"Transfira antes de excluir","body":"Revise a contagem de impacto e escolha outro usuário ativo para receber leads e imóveis. Confirme também o efeito sobre sessões de WhatsApp."}
  ]$json$::jsonb,
  array['como-convidar-um-usuario', 'como-criar-e-gerenciar-equipes'],
  6,
  now()
),
(
  '20000000-0000-4000-8000-000000000226'::uuid,
  'Pipeline e leads',
  'Como marcar um lead como ganho, perdido ou reabrir?',
  'O status comercial é independente da coluna do Pipeline. Marcar como ganho registra a conclusão positiva; marcar como perdido exige o motivo; reabrir devolve a oportunidade ao fluxo ativo. Todas as ações entram no histórico.',
  null,
  null,
  260,
  true,
  'como-marcar-um-lead-como-ganho-perdido-ou-reabrir',
  'Registre corretamente o resultado comercial sem perder o histórico da oportunidade.',
  'pipeline',
  array['lead ganho', 'lead perdido', 'reabrir lead', 'motivo de perda', 'venda', 'status do negócio'],
  'all',
  '/crm/pipelines',
  'Abrir Pipeline',
  $json$[
    {"id":"deal-status-1","title":"Abra o lead","body":"Selecione o card e revise o negócio antes de alterar o resultado.","actionLabel":"Abrir Pipeline","actionHref":"/crm/pipelines"},
    {"id":"deal-status-2","title":"Escolha ganho ou perdido","body":"Use a ação disponível no detalhe. Para perda, informe um motivo que ajude a análise comercial."},
    {"id":"deal-status-3","title":"Confira o histórico","body":"Valide quem alterou, quando e qual motivo foi registrado."},
    {"id":"deal-status-4","title":"Reabra quando a oportunidade voltar","body":"Use reabrir em vez de criar um lead duplicado quando o mesmo negócio retomar o atendimento."}
  ]$json$::jsonb,
  array['como-abrir-e-entender-o-detalhe-de-um-lead', 'o-que-significam-os-kpis-do-dashboard'],
  4,
  now()
),
(
  '20000000-0000-4000-8000-000000000227'::uuid,
  'Pipeline e leads',
  'Como atribuir ou redistribuir um lead?',
  'Usuários autorizados podem selecionar um responsável, limpar a atribuição ou solicitar redistribuição pela fila configurada. A ação respeita organização, equipe, disponibilidade e regras de acesso.',
  null,
  null,
  270,
  true,
  'como-atribuir-ou-redistribuir-um-lead',
  'Troque o responsável ou use a distribuição configurada sem perder o histórico.',
  'pipeline',
  array['atribuir lead', 'responsável', 'redistribuir lead', 'trocar corretor', 'limpar responsável', 'roleta'],
  'authenticated',
  '/crm/pipelines',
  'Abrir Pipeline',
  $json$[
    {"id":"assign-1","title":"Abra o detalhe do lead","body":"Confira responsável atual, equipe e pipeline antes da mudança.","actionLabel":"Abrir Pipeline","actionHref":"/crm/pipelines"},
    {"id":"assign-2","title":"Escolha a ação","body":"Selecione outro responsável, limpe a atribuição ou use Redistribuir para aplicar a fila disponível."},
    {"id":"assign-3","title":"Confirme o destino","body":"Revise o novo responsável e o histórico. Uma redistribuição pode considerar peso e disponibilidade."}
  ]$json$::jsonb,
  array['como-funciona-a-distribuicao-de-leads', 'como-abrir-e-entender-o-detalhe-de-um-lead'],
  4,
  now()
),
(
  '20000000-0000-4000-8000-000000000228'::uuid,
  'Dashboard',
  'O que significam os KPIs do Dashboard?',
  'O Dashboard geral pode mostrar Leads, Em aberto, Perdidos, Ganhos, Visitas, VGV, 1º Contato, Imóveis e Visitas no site. Cada indicador depende do período, dos filtros, do módulo e da permissão do usuário.',
  null,
  null,
  280,
  true,
  'o-que-significam-os-kpis-do-dashboard',
  'Entenda o significado dos indicadores realmente exibidos no Dashboard do Vimob.',
  'dashboard',
  array['kpi', 'indicadores', 'leads', 'em aberto', 'perdidos', 'ganhos', 'visitas', 'vgv', 'primeiro contato'],
  'all',
  '/dashboard',
  'Abrir Dashboard',
  $json$[
    {"id":"kpi-1","title":"Leads e Em aberto","body":"Leads representa o volume captado no recorte. Em aberto representa oportunidades ainda ativas conforme os filtros."},
    {"id":"kpi-2","title":"Ganhos, Perdidos e VGV","body":"Ganhos e Perdidos usam o resultado comercial. VGV soma os valores considerados pelo recorte de negócios ganhos."},
    {"id":"kpi-3","title":"Visitas e 1º Contato","body":"Visitas dependem das atividades registradas. 1º Contato mede o atendimento inicial conforme a instrumentação do CRM."},
    {"id":"kpi-4","title":"Imóveis e Visitas no site","body":"Esses indicadores aparecem quando os módulos e permissões correspondentes estão disponíveis.","actionLabel":"Abrir Dashboard","actionHref":"/dashboard"}
  ]$json$::jsonb,
  array['como-usar-os-filtros-do-dashboard'],
  5,
  now()
),
(
  '20000000-0000-4000-8000-000000000229'::uuid,
  'Integrações',
  'Como conectar a integração Meta?',
  'A integração Meta é configurada em Configurações > Integrações. O fluxo autoriza a conta, seleciona páginas e formulários e mapeia o destino dos leads. O acesso depende do módulo e das permissões da organização.',
  null,
  null,
  290,
  true,
  'como-conectar-a-integracao-meta',
  'Autorize a Meta, selecione páginas e formulários e revise o destino de cada lead.',
  'integrations',
  array['meta', 'facebook', 'instagram', 'lead ads', 'formulário meta', 'conectar facebook'],
  'all',
  '/settings?tab=integrations',
  'Abrir Integrações',
  $json$[
    {"id":"meta-1","title":"Abra Integrações","body":"Em Configurações, selecione Integrações e localize Meta.","actionLabel":"Abrir Integrações","actionHref":"/settings?tab=integrations"},
    {"id":"meta-2","title":"Autorize a conta correta","body":"Confira o perfil e a empresa antes de concluir o OAuth."},
    {"id":"meta-3","title":"Selecione página e formulários","body":"Escolha somente as fontes que devem alimentar o CRM."},
    {"id":"meta-4","title":"Mapeie e teste","body":"Defina pipeline, etapa, equipe ou responsável e valide a chegada de um lead de teste."}
  ]$json$::jsonb,
  array['como-funciona-a-distribuicao-de-leads', 'como-criar-um-lead-no-pipeline'],
  6,
  now()
),
(
  '20000000-0000-4000-8000-000000000230'::uuid,
  'Integrações e API',
  'Como criar uma chave de API e configurar webhooks?',
  'As chaves emitidas nesta tela são credenciais reservadas às integrações que a Vimob liberar explicitamente. Elas não substituem o login do usuário e não tornam públicos os endpoints internos do CRM. Webhooks enviam eventos selecionados para uma URL configurada. Trate toda credencial como segredo e valide cada evento recebido.',
  null,
  null,
  300,
  true,
  'como-criar-chave-de-api-e-configurar-webhooks',
  'Entenda o escopo atual das credenciais e configure entregas de eventos com segurança.',
  'integrations',
  array['api', 'chave api', 'token', 'webhook', 'integração', 'documentação api', 'endpoint'],
  'authenticated',
  '/settings?tab=api',
  'Abrir chaves de API',
  $json$[
    {"id":"api-1","title":"Confirme se a integração foi liberada","body":"Uma chave cadastrada não libera, sozinha, os endpoints internos do CRM. Antes de desenvolver, confirme com a Vimob quais rotas e escopos estão disponíveis para sua organização."},
    {"id":"api-2","title":"Abra e proteja as credenciais","body":"Em Configurações, entre em API. Se a integração estiver liberada, gere a chave, copie-a no momento indicado e armazene-a em um cofre de segredos. Nunca coloque uma chave em frontend, código público ou mensagem.","actionLabel":"Abrir chaves de API","actionHref":"/settings?tab=api"},
    {"id":"api-3","title":"Configure o webhook","body":"Use uma URL HTTPS, escolha os eventos necessários e mantenha o receptor idempotente."},
    {"id":"api-4","title":"Teste somente contra o contrato liberado","body":"Confirme autenticação, payload, resposta e reentregas em um ambiente seguro antes de ativar a integração em produção."}
  ]$json$::jsonb,
  array['como-comecar-a-usar-o-vimob'],
  6,
  now()
)
on conflict (id) do update set
  category = excluded.category,
  title = excluded.title,
  content = excluded.content,
  image_url = excluded.image_url,
  video_url = excluded.video_url,
  display_order = excluded.display_order,
  is_active = excluded.is_active,
  slug = excluded.slug,
  summary = excluded.summary,
  module_key = excluded.module_key,
  search_keywords = excluded.search_keywords,
  visibility = excluded.visibility,
  route_href = excluded.route_href,
  action_label = excluded.action_label,
  steps = excluded.steps,
  related_slugs = excluded.related_slugs,
  estimated_minutes = excluded.estimated_minutes,
  last_reviewed_at = excluded.last_reviewed_at,
  updated_at = now();

commit;
