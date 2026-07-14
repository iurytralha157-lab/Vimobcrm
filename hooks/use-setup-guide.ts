import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { useOrganizationModules } from '@/hooks/use-organization-modules';
import { useUserAccessScope } from '@/hooks/use-user-access-scope';
import { settingsAPI } from '@/lib/api/settings';
import { canUseFinancialModule } from '@/lib/financial-access';

export type SetupStepId =
  | 'dashboard'
  | 'first_lead'
  | 'first_property'
  | 'pipeline'
  | 'contacts'
  | 'conversations'
  | 'agenda'
  | 'profile'
  | 'whatsapp'
  | 'team'
  | 'teams'
  | 'distribution'
  | 'integrations_meta'
  | 'properties'
  | 'automations'
  | 'gamification'
  | 'site'
  | 'financial'
  | 'ai';

export interface SetupStep {
  id: SetupStepId;
  title: string;
  subtitle: string;
  description: string;
  route: string;
  ctaLabel: string;
  section: string;
  badge: string;
  details: string[];
  checklist: string[];
  audience: string;
  tourTarget?: string;
}

const GUIDE_CUTOFF_DATE = new Date('2024-01-01T00:00:00Z');
const SESSION_SHOWN_KEY = 'setup_guide_shown_this_session';
export const SETUP_GUIDE_ACTIVE_STEP_PREFIX = 'setup_guide_active_step_';
export const SETUP_GUIDE_STEP_EVENT = 'setup-guide:step-change';
export const SETUP_GUIDE_COMPLETE_EVENT = 'setup-guide:complete-step';

interface SetupGuideProgressRow {
  completed_steps: Record<string, boolean> | null;
  skipped: boolean | null;
}

function normalizeProgress(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
  );
}

export function useSetupGuide() {
  const {
    user,
    profile,
    isSuperAdmin,
    organization,
    userOrganizations = [],
  } = useAuth();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const { hasModule, isLoading: modulesLoading } = useOrganizationModules();
  const accessScope = useUserAccessScope();

  const [progress, setProgress] = useState<Record<string, boolean>>({});
  const [skipped, setSkipped] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const userId = user?.id;
  const organizationId = organization?.id || profile?.organization_id;
  const loginSessionId = user?.last_sign_in_at || user?.created_at || 'current';
  const sessionShownKey = userId && organizationId
    ? `${SESSION_SHOWN_KEY}:${userId}:${organizationId}:${loginSessionId}`
    : null;
  const activeStepStorageKey = userId && organizationId
    ? `${SETUP_GUIDE_ACTIVE_STEP_PREFIX}${userId}:${organizationId}`
    : null;
  const isNewUser = !!user?.created_at && new Date(user.created_at) >= GUIDE_CUTOFF_DATE;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const metaProgressSource = user?.user_metadata?.setup_progress;
  const metaProgress = useMemo(() => normalizeProgress(metaProgressSource), [metaProgressSource]);
  const metaSkipped = user?.user_metadata?.setup_skipped === true;
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === organizationId)?.member_role;
  const isAdmin =
    isSuperAdmin ||
    activeMemberRole === 'admin' ||
    activeMemberRole === 'owner';
  const isTeamLeader = accessScope.isTeamLeader;
  const canAccessManagement = isAdmin || isTeamLeader;
  const canManageTeam = isAdmin || hasPermission('settings_users') || hasPermission('settings_teams');
  const canManagePipelines = isAdmin || hasPermission('settings_pipelines');
  const canExportLeads = isAdmin || hasPermission('lead_export') || hasPermission('lead_view_all');
  const canUseAutomations = hasModule('automations') && hasPermission('automations_view');
  const canAccessFinancial =
    isAdmin &&
    hasModule('financial') &&
    canUseFinancialModule({
      id: organizationId,
      name: organization?.name || userOrganizations.find((org) => org.organization_id === organizationId)?.organization_name,
    });
  const canManageAI = isAdmin && hasModule('ai_agent');

  const resolvedSteps = useMemo<SetupStep[]>(() => {
    const contactsChecklist = [
      'Buscar contatos por nome, telefone ou e-mail.',
      'Usar filtros para separar leads em aberto, ganhos, perdidos e responsáveis.',
      canExportLeads
        ? 'Importar ou exportar a base quando precisar organizar dados fora do CRM.'
        : 'Visualizar apenas os contatos permitidos para o seu perfil.',
    ];

    const propertyChecklist = isAdmin
      ? [
          'Cadastrar novos imóveis com fotos, valores, localização e características.',
          'Editar imóveis da equipe quando for necessário corrigir dados comerciais.',
          'Usar a base de imóveis para vincular oportunidades aos leads.',
        ]
      : [
          'Cadastrar e manter os imóveis sob sua responsabilidade.',
          'Editar somente os imóveis que pertencem ao seu acesso.',
          'Usar imóveis vinculados para contextualizar o atendimento.',
        ];

    const allSteps: Array<SetupStep & { visible: boolean }> = [
      {
        id: 'dashboard',
        title: 'Dashboard',
        subtitle: 'Indicadores e leitura do negócio',
        description: 'Entenda a tela inicial do CRM e como acompanhar os principais números da operação.',
        route: '/dashboard',
        ctaLabel: 'Abrir dashboard',
        section: 'Primeiros passos',
        badge: 'Essencial',
        audience: 'Todos os usuários',
        details: [
          'A dashboard resume a situação comercial da organização no período selecionado.',
          'Os cards de ganhos e perdidos ajudam a abrir detalhes rápidos sobre resultados e motivos.',
          'A leitura junta leads em aberto, visitas, VGV, primeiro contato, imóveis, visitas no site, evolução, origem e funil de vendas.',
        ],
        checklist: [
          'Conferir leads em aberto, ganhos e perdidos.',
          'Abrir os detalhes de ganhos e perdidos quando houver movimentação.',
          'Usar filtros de período para entender evolução, origem dos leads e funil de vendas.',
        ],
        tourTarget: 'dashboard-overview',
        visible: true,
      },
      {
        id: 'first_lead',
        title: 'Criar primeiro lead',
        subtitle: 'Cadastre, organize e abra o card completo',
        description: 'Crie um lead manual e conheça o fluxo atual de dados básicos, perfil e gestão antes de iniciar o atendimento.',
        route: '/crm/contacts?new=lead',
        ctaLabel: 'Criar lead',
        section: 'Primeiros passos',
        badge: 'Lead',
        audience: 'Usuários com CRM',
        details: [
          'O cadastro é dividido em Básico, Perfil e Gestão para separar contato, interesse e destino comercial.',
          'Depois de criado, o lead aparece em Contatos e na etapa escolhida da Pipeline.',
          'O card completo reúne dados, status, imóvel, documentos, agenda, cadência, feedback e histórico.',
        ],
        checklist: [
          'Abrir Contatos e clicar em Novo lead.',
          'Preencher nome, telefone ou e-mail e avançar pelas três abas.',
          'Definir responsável, pipeline e etapa; depois abrir o card na Pipeline.',
        ],
        tourTarget: 'contacts-new',
        visible: hasModule('crm'),
      },
      {
        id: 'first_property',
        title: 'Cadastrar primeiro imóvel',
        subtitle: 'Carteira usada no atendimento',
        description: 'Cadastre um imóvel seguindo as etapas atuais de proprietário, estrutura, localização, valores, mídia e publicação.',
        route: '/properties/new',
        ctaLabel: 'Cadastrar imóvel',
        section: 'Imóveis',
        badge: 'Imóvel',
        audience: isAdmin ? 'Administradores e usuários com módulo' : 'Usuários com módulo de imóveis',
        details: [
          'O cadastro de imóvel alimenta a carteira usada pela equipe e pelo site quando o módulo estiver liberado.',
          isAdmin
            ? 'Administradores podem revisar imóveis de toda a organização.'
            : 'Usuários comuns trabalham principalmente com imóveis sob o próprio acesso.',
          'Quanto melhor o cadastro, mais fácil fica vincular o interesse do lead ao imóvel certo.',
        ],
        checklist: [
          'Definir responsável e dados do proprietário.',
          'Preencher tipo, modalidade, localização e valores.',
          'Adicionar fotos, descrição e publicar quando o plano permitir.',
        ],
        tourTarget: 'property-form',
        visible: hasModule('properties'),
      },
      {
        id: 'pipeline',
        title: 'Pipeline',
        subtitle: canManagePipelines ? 'Crie etapas e organize o atendimento' : 'Mova leads entre etapas',
        description: canManagePipelines
          ? 'Aprenda como montar a primeira pipeline, criar colunas e organizar o fluxo comercial.'
          : 'Entenda como acompanhar seus leads, mover cards e registrar o andamento do atendimento.',
        route: '/crm/pipelines',
        ctaLabel: 'Abrir pipeline',
        section: 'CRM',
        badge: 'CRM',
        audience: canManagePipelines ? 'Administradores e líderes autorizados' : 'Usuários com CRM',
        details: [
          'A pipeline mostra os leads por etapa e ajuda o time a visualizar o que precisa de ação.',
          canManagePipelines
            ? 'Na gestão você consegue criar pipelines, editar etapas e definir como o atendimento deve funcionar.'
            : 'Cada card concentra dados do lead, responsável, etapa, histórico, mensagens e próximos passos.',
          'Ao mover um lead, o histórico registra a mudança para dar rastreabilidade ao atendimento.',
        ],
        checklist: [
          canManagePipelines ? 'Criar ou revisar a primeira pipeline.' : 'Abrir um card de lead para entender os dados principais.',
          canManagePipelines ? 'Adicionar colunas de acordo com o processo comercial.' : 'Mover um lead para a etapa correta quando houver avanço.',
          'Usar o histórico do card para acompanhar mensagens, mudanças e feedbacks.',
        ],
        tourTarget: 'pipeline-overview',
        visible: hasModule('crm'),
      },
      {
        id: 'contacts',
        title: 'Contatos',
        subtitle: 'Busca, filtros e base de leads',
        description: 'Veja como consultar a base de contatos e encontrar rapidamente os leads certos.',
        route: '/crm/contacts',
        ctaLabel: 'Abrir contatos',
        section: 'CRM',
        badge: 'Base',
        audience: canExportLeads ? 'Perfis com acesso à base' : 'Usuários com CRM',
        details: [
          'A tela de contatos concentra os leads e facilita busca, filtro e leitura rápida da base.',
          'Use os filtros para separar status, atendimento, responsável, campanha, origem e período.',
          canExportLeads
            ? 'Quando o perfil permitir, importação e exportação ajudam a organizar dados comerciais e informações de origem do lead.'
            : 'Perfis comuns visualizam somente os contatos liberados para o próprio atendimento.',
        ],
        checklist: contactsChecklist,
        tourTarget: 'contacts-overview',
        visible: hasModule('crm'),
      },
      {
        id: 'conversations',
        title: 'Conversas',
        subtitle: 'Atendimento pelo WhatsApp',
        description: 'Entenda onde chegam mensagens, grupos e conversas vinculadas aos leads.',
        route: '/crm/conversas',
        ctaLabel: 'Abrir conversas',
        section: 'Atendimento',
        badge: 'WhatsApp',
        audience: 'Usuários com WhatsApp liberado',
        details: [
          'A tela de conversas mostra atendimentos do WhatsApp e ajuda a continuar o contato sem sair do CRM.',
          'Quando uma conversa vira oportunidade, ela pode ser vinculada a um lead e seguir para a pipeline.',
          'As mensagens precisam respeitar a conexão do WhatsApp liberada para o usuário e para a organização.',
        ],
        checklist: [
          'Concluir a conexão do WhatsApp antes de abrir esta etapa.',
          'Abrir a lista de conversas e conferir mensagens recentes.',
          'Entrar em uma conversa e identificar se existe lead vinculado.',
          'Usar busca e filtros para localizar conversas, grupos e arquivadas.',
        ],
        tourTarget: 'conversations-overview',
        visible: hasModule('whatsapp'),
      },
      {
        id: 'agenda',
        title: 'Agenda',
        subtitle: 'Visitas, reuniões e filtros',
        description: 'Veja como agendar compromissos e acompanhar visitas comerciais.',
        route: '/agenda',
        ctaLabel: 'Abrir agenda',
        section: 'Rotina',
        badge: 'Agenda',
        audience: 'Usuários com agenda liberada',
        details: [
          'A agenda organiza visitas, reuniões e retornos com leads.',
          'Os filtros ajudam a enxergar compromissos por usuário, data e tipo de atividade.',
          'Os compromissos ficam ligados ao responsável, lead e imóvel quando essas relações forem informadas.',
        ],
        checklist: [
          'Usar os filtros para encontrar compromissos do dia ou do período.',
          'Criar um agendamento a partir da agenda ou do card do lead.',
          'Revisar responsável, visibilidade, recorrência e vínculos antes de salvar.',
        ],
        tourTarget: 'agenda-overview',
        visible: hasModule('agenda'),
      },
      {
        id: 'profile',
        title: 'Minha conta',
        subtitle: 'Perfil, telefone, tema e senha',
        description: 'Complete seus dados para melhorar identificação, segurança e notificações.',
        route: '/settings?tab=account',
        ctaLabel: 'Abrir conta',
        section: 'Conta',
        badge: 'Perfil',
        audience: 'Todos os usuários',
        details: [
          'A área de conta permite atualizar foto, nome, telefone, preferência visual e senha.',
          'O telefone é importante para notificações e identificação do usuário na operação.',
          'A troca de senha fica no mesmo fluxo para manter a conta segura.',
        ],
        checklist: [
          'Adicionar ou atualizar a foto do perfil.',
          'Cadastrar telefone para notificações e contato interno.',
          'Ajustar tema do sistema e revisar senha quando necessário.',
        ],
        tourTarget: 'account-profile',
        visible: true,
      },
      {
        id: 'whatsapp',
        title: 'Integração WhatsApp',
        subtitle: 'Conectar número e escanear QR Code',
        description: 'Veja onde conectar o WhatsApp usado no atendimento.',
        route: '/settings?tab=integrations',
        ctaLabel: 'Conectar WhatsApp',
        section: 'Integrações',
        badge: 'WhatsApp',
        audience: 'Usuários com WhatsApp liberado',
        details: [
          'Na tela de integrações, abra WhatsApp e clique em gerenciar para ver as conexões disponíveis.',
          'A conexão nova exige leitura do QR Code no celular do número autorizado.',
          'Cada usuário deve visualizar apenas as conexões que pertencem ao próprio acesso.',
        ],
        checklist: [
          'Abrir Configurações e entrar em Integrações.',
          'Gerenciar WhatsApp e criar uma nova conexão quando necessário.',
          'Escanear o QR Code e verificar se a conexão ficou como conectada.',
        ],
        tourTarget: 'whatsapp-new-session',
        visible: hasModule('whatsapp'),
      },
      {
        id: 'team',
        title: 'Usuários e acessos',
        subtitle: 'Convites, perfis, funções e status',
        description: 'Convide pessoas e controle o papel, a função e o status de cada acesso da organização.',
        route: '/settings?tab=team',
        ctaLabel: 'Gerenciar equipe',
        section: 'Gestão',
        badge: 'Admin',
        audience: 'Administradores',
        details: [
          'Novos usuários entram por convite e concluem o próprio acesso com segurança.',
          'Administradores podem alterar o perfil entre usuário e administrador, aplicar funções personalizadas e desativar acessos.',
          'Permissões corretas evitam que alguém veja conversas, leads ou integrações fora do próprio acesso.',
        ],
        checklist: [
          'Enviar um convite com nome, e-mail, telefone e perfil inicial.',
          'Definir administrador, usuário ou função personalizada conforme a responsabilidade.',
          'Desativar ou excluir acessos somente depois de revisar leads e imóveis vinculados.',
        ],
        tourTarget: 'team-add-user',
        visible: canManageTeam,
      },
      {
        id: 'teams',
        title: 'Gestão de equipes',
        subtitle: 'Líderes, membros e disponibilidade',
        description: 'Organize as pessoas em equipes e defina a disponibilidade usada na distribuição de leads.',
        route: '/crm/management?tab=teams',
        ctaLabel: 'Abrir equipes',
        section: 'Gestão',
        badge: 'Equipe',
        audience: isAdmin ? 'Administradores' : 'Líderes de equipe',
        details: [
          'Administradores enxergam todas as equipes; líderes enxergam somente as equipes que lideram.',
          'Cada equipe possui membros, líderes e disponibilidade própria por usuário.',
          'A disponibilidade é consultada por equipe e pode mudar entre equipes para a mesma pessoa.',
        ],
        checklist: [
          'Criar ou abrir uma equipe e revisar seus membros.',
          'Definir os líderes responsáveis pelo acompanhamento.',
          'Abrir a disponibilidade de cada membro e conferir dias e horários.',
        ],
        tourTarget: 'management-teams',
        visible: canAccessManagement && hasModule('crm'),
      },
      {
        id: 'distribution',
        title: 'Gestão e distribuição',
        subtitle: 'Equipes, filas e roleta de leads',
        description: 'Configure como os leads entram e são distribuídos para o time.',
        route: '/crm/management?tab=distribution',
        ctaLabel: 'Configurar distribuição',
        section: 'Gestão',
        badge: 'Distribuição',
        audience: isAdmin ? 'Administradores' : 'Líderes de equipe',
        details: [
          'A gestão permite organizar equipes, pipelines, etiquetas e regras de distribuição.',
          'Líderes podem acessar partes da gestão quando têm equipe vinculada.',
          'A distribuição define para onde o lead vai e quem será responsável pelo atendimento.',
        ],
        checklist: [
          'Criar ou revisar equipes de atendimento.',
          'Configurar filas de distribuição para novos leads.',
          'Conferir se a pipeline e os responsáveis estão corretos.',
        ],
        tourTarget: 'distribution-new-queue',
        visible: canAccessManagement && hasModule('crm') && hasModule('round_robin'),
      },
      {
        id: 'integrations_meta',
        title: 'Integração Meta',
        subtitle: 'Facebook, Instagram e formulários',
        description: 'Conecte Meta para receber leads de campanhas dentro do CRM.',
        route: '/settings?tab=integrations',
        ctaLabel: 'Abrir Meta',
        section: 'Integrações',
        badge: 'Meta',
        audience: 'Administradores',
        details: [
          'A integração com Meta conecta páginas, contas e formulários ao backend do Vimob.',
          'Leads de formulário podem chegar com campanha, formulário, perguntas, respostas e criativo quando a Meta disponibilizar.',
          'Depois de conectar, revise quais formulários entram em cada pipeline ou distribuição.',
        ],
        checklist: [
          'Abrir Configurações e entrar em Integrações.',
          'Gerenciar Facebook / Meta e conectar a conta correta.',
          'Selecionar páginas, formulários e destino dos leads.',
        ],
        tourTarget: 'meta-integration',
        visible: isAdmin && hasModule('campaigns'),
      },
      {
        id: 'properties',
        title: 'Imóveis',
        subtitle: isAdmin ? 'Cadastro e gestão da carteira' : 'Cadastro dos seus imóveis',
        description: 'Organize a carteira de imóveis usada pela equipe comercial.',
        route: '/properties',
        ctaLabel: 'Abrir imóveis',
        section: 'Imóveis',
        badge: 'Carteira',
        audience: isAdmin ? 'Administradores e usuários com módulo' : 'Usuários com módulo de imóveis',
        details: [
          'A área de imóveis centraliza cadastro, fotos, valores, localização e dados comerciais.',
          isAdmin
            ? 'Administradores podem revisar a carteira da organização e corrigir imóveis de outros usuários.'
            : 'Usuários comuns trabalham com os imóveis liberados para o próprio acesso.',
          'Imóveis bem cadastrados ajudam a qualificar leads e conectar interesse com oferta.',
        ],
        checklist: propertyChecklist,
        tourTarget: 'properties-overview',
        visible: hasModule('properties'),
      },
      {
        id: 'automations',
        title: 'Automações',
        subtitle: 'Fluxos, modelos e histórico',
        description: 'Configure ações automáticas para reduzir trabalho manual no atendimento.',
        route: '/automations',
        ctaLabel: 'Abrir automações',
        section: 'Avançado',
        badge: 'Automação',
        audience: 'Perfis com permissão',
        details: [
          'Automações ajudam a padronizar mensagens, tarefas e ações durante o atendimento.',
          'O módulo aparece somente quando o plano e a permissão do usuário permitem.',
          'O histórico ajuda a acompanhar o que foi executado automaticamente.',
        ],
        checklist: [
          'Abrir a lista de automações disponíveis.',
          'Revisar modelos antes de publicar novos fluxos.',
          'Acompanhar histórico para entender o que foi disparado.',
        ],
        tourTarget: 'automations-new',
        visible: canUseAutomations,
      },
      {
        id: 'gamification',
        title: 'Arena e gamificação',
        subtitle: 'Ranking, metas e desempenho',
        description: 'Acompanhe pontos, ranking e desempenho quando a organização usar gamificação.',
        route: '/gamificacao',
        ctaLabel: 'Abrir Arena',
        section: 'Performance',
        badge: 'Arena',
        audience: 'Usuários com Arena liberada',
        details: [
          'A Arena mostra pontuação, ranking e histórico das ações que geram pontos.',
          'Administradores conseguem configurar regras, missões, temporadas e aprovações quando permitido.',
          'Usuários acompanham desempenho e posição sem precisar sair da rotina do CRM.',
        ],
        checklist: [
          'Abrir visão geral da Arena.',
          'Conferir ranking e histórico de pontos.',
          isAdmin ? 'Revisar configurações de regras e temporada.' : 'Acompanhar seu próprio desempenho.',
        ],
        tourTarget: 'gamification-overview',
        visible: hasModule('gamification'),
      },
      {
        id: 'financial',
        title: 'Financeiro',
        subtitle: 'Receitas, despesas, contratos e comissões',
        description: 'Entenda os indicadores financeiros e onde acompanhar a operação comercial depois do fechamento.',
        route: '/financeiro',
        ctaLabel: 'Abrir financeiro',
        section: 'Financeiro',
        badge: 'Admin',
        audience: 'Administradores com módulo financeiro',
        details: [
          'O painel financeiro reúne VGV, receitas, despesas, valores vencidos e projeções da organização.',
          'Contas, contratos, comissões, relatórios e DRE ficam separados para facilitar a conferência da operação.',
          'Esta etapa só aparece para organizações e administradores com acesso financeiro liberado.',
        ],
        checklist: [
          'Conferir os indicadores principais do período.',
          'Revisar contas a receber, contas a pagar e vencimentos.',
          'Conhecer os fluxos de contratos, comissões e relatórios antes de cadastrar dados reais.',
        ],
        tourTarget: 'financial-overview',
        visible: canAccessFinancial,
      },
      {
        id: 'ai',
        title: 'Atendimento com IA',
        subtitle: 'Conexões, agentes, roteamento e testes',
        description: 'Configure com segurança quais conexões podem ser atendidas pela IA e como cada agente deve atuar.',
        route: '/settings?tab=ai',
        ctaLabel: 'Configurar IA',
        section: 'Avançado',
        badge: 'Admin',
        audience: 'Administradores com IA liberada',
        details: [
          'A central de IA mostra métricas, conexões autorizadas, agentes, regras de roteamento, testes e logs.',
          'Somente conexões explicitamente liberadas podem ser visualizadas e atendidas pelos agentes.',
          'As regras determinam quando a triagem responde, quando ocorre handoff e qual agente recebe cada conversa.',
        ],
        checklist: [
          'Selecionar as conexões que a IA pode atender.',
          'Revisar o agente de triagem e os especialistas disponíveis.',
          'Testar o roteamento antes de ativar respostas reais.',
        ],
        tourTarget: 'ai-overview',
        visible: canManageAI,
      },
      {
        id: 'site',
        title: 'Site imobiliário',
        subtitle: 'Publicação e vitrine de imóveis',
        description: 'Configure a presença pública da imobiliária quando o módulo estiver liberado.',
        route: '/settings/site',
        ctaLabel: 'Configurar site',
        section: 'Avançado',
        badge: 'Site',
        audience: 'Administradores com módulo de site',
        details: [
          'O site permite publicar uma vitrine conectada à carteira de imóveis.',
          'A configuração aparece apenas para organizações com módulo liberado e usuários administradores.',
          'Revise marca, páginas, filtros, imóveis publicados e dados de contato antes de divulgar.',
        ],
        checklist: [
          'Configurar identidade, domínio e informações públicas.',
          'Selecionar quais imóveis aparecem no site.',
          'Testar busca, filtros e formulário antes de publicar.',
        ],
        tourTarget: 'site-settings',
        visible: isAdmin && hasModule('site'),
      },
    ];

    const stepOrder: SetupStepId[] = [
      'dashboard',
      'first_lead',
      'first_property',
      'pipeline',
      'contacts',
      'whatsapp',
      'conversations',
      'agenda',
      'profile',
      'team',
      'teams',
      'distribution',
      'integrations_meta',
      'properties',
      'automations',
      'gamification',
      'financial',
      'ai',
      'site',
    ];

    return allSteps
      .filter((step) => step.visible)
      .sort((left, right) => stepOrder.indexOf(left.id) - stepOrder.indexOf(right.id));
  }, [
    canAccessManagement,
    canAccessFinancial,
    canExportLeads,
    canManageAI,
    canManagePipelines,
    canManageTeam,
    canUseAutomations,
    hasModule,
    isAdmin,
  ]);

  const accessLoading = permissionsLoading || modulesLoading || accessScope.isLoading;
  const steps = resolvedSteps;
  const guideReady = loaded && !accessLoading;

  /* eslint-disable react-hooks/set-state-in-effect -- Hydrates setup-guide state from DB with metadata fallback. */
  useEffect(() => {
    if (!userId || !organizationId) {
      if (!userId) setLoaded(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const data = await settingsAPI.getSetupGuideProgress(organizationId);

        if (cancelled) return;

        if (data) {
          const row = data as SetupGuideProgressRow;
          setProgress(normalizeProgress(row.completed_steps));
          setSkipped(!!row.skipped);
        } else {
          setProgress(metaProgress);
          setSkipped(metaSkipped);
        }
      } catch {
        if (!cancelled) {
          setProgress(metaProgress);
          setSkipped(metaSkipped);
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, organizationId, metaProgress, metaSkipped]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const persist = useCallback(
    (next: { completed_steps?: Record<string, boolean>; skipped?: boolean }) => {
      if (!userId) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);

      saveTimer.current = setTimeout(async () => {
        try {
          await settingsAPI.updateSetupGuideProgress(next, organizationId);
        } catch (dbError) {
          console.warn('[SetupGuide] DB save failed', dbError);
        }
      }, 500);
    },
    [userId, organizationId],
  );

  useEffect(() => {
    if (!userId || !profile || !guideReady) return;
    if (skipped) return;

    if (!sessionShownKey) return;
    const shownThisSession = sessionStorage.getItem(sessionShownKey) === 'true';
    const allDone = steps.length > 0 && steps.every((s) => progress[s.id]);

    if (!shownThisSession && !allDone) {
      const timer = setTimeout(() => {
        setOpen(true);
        sessionStorage.setItem(sessionShownKey, 'true');
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [userId, profile, guideReady, skipped, steps, progress, sessionShownKey]);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('setup-guide:open', handler);
    return () => window.removeEventListener('setup-guide:open', handler);
  }, []);

  const markComplete = useCallback(
    (id: SetupStepId) => {
      if (!userId) return;
      setProgress((prev) => {
        const next = { ...prev, [id]: true };
        persist({ completed_steps: next });
        return next;
      });
      try {
        const active = activeStepStorageKey ? localStorage.getItem(activeStepStorageKey) : null;
        if (active === id) {
          localStorage.removeItem(activeStepStorageKey!);
          window.dispatchEvent(new CustomEvent(SETUP_GUIDE_STEP_EVENT, { detail: null }));
        }
      } catch {
        // ignore
      }
    },
    [activeStepStorageKey, userId, persist],
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<SetupStepId | null>).detail;
      if (!id) return;
      markComplete(id);
      window.setTimeout(() => setOpen(true), 80);
    };

    window.addEventListener(SETUP_GUIDE_COMPLETE_EVENT, handler);
    return () => window.removeEventListener(SETUP_GUIDE_COMPLETE_EVENT, handler);
  }, [markComplete]);

  const markIncomplete = useCallback(
    (id: SetupStepId) => {
      if (!userId) return;
      setProgress((prev) => {
        const next = { ...prev };
        delete next[id];
        persist({ completed_steps: next });
        return next;
      });
    },
    [userId, persist],
  );

  const dismiss = useCallback(() => {
    if (!userId) {
      setOpen(false);
      return;
    }
    setSkipped(true);
    persist({ skipped: true });
    setOpen(false);
  }, [persist, userId]);

  const skipAll = useCallback(() => {
    dismiss();
  }, [dismiss]);

  const restart = useCallback(() => {
    if (!userId) return;
    setProgress({});
    setSkipped(false);
    persist({ completed_steps: {}, skipped: false });
    try {
      if (activeStepStorageKey) localStorage.removeItem(activeStepStorageKey);
      window.dispatchEvent(new CustomEvent(SETUP_GUIDE_STEP_EVENT, { detail: null }));
    } catch {
      // ignore
    }
    if (sessionShownKey) sessionStorage.removeItem(sessionShownKey);
  }, [activeStepStorageKey, userId, persist, sessionShownKey]);

  const setActiveStepId = useCallback(
    (id: string | null) => {
      if (!userId) return;
      try {
        if (id && activeStepStorageKey) {
          localStorage.setItem(activeStepStorageKey, id);
        } else {
          if (activeStepStorageKey) localStorage.removeItem(activeStepStorageKey);
        }
        window.dispatchEvent(new CustomEvent(SETUP_GUIDE_STEP_EVENT, { detail: id }));
      } catch {
        // ignore
      }
    },
    [activeStepStorageKey, userId],
  );

  const activeStepId = (() => {
    if (!userId) return null;
    try {
      const fromMeta = user?.user_metadata?.setup_active_step;
      const fromLS = activeStepStorageKey ? localStorage.getItem(activeStepStorageKey) : null;
      return fromMeta || fromLS || null;
    } catch {
      return user?.user_metadata?.setup_active_step || null;
    }
  })();

  const completedCount = steps.filter((s) => progress[s.id]).length;
  const totalCount = steps.length;
  const percent = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

  return {
    steps,
    progress,
    open,
    setOpen,
    markComplete,
    markIncomplete,
    skipAll,
    dismiss,
    restart,
    completedCount,
    totalCount,
    percent,
    activeStepId,
    setActiveStepId,
    isNewUser,
    skipped,
    guideReady,
  };
}
