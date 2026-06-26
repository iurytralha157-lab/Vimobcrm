import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { useOrganizationModules } from '@/hooks/use-organization-modules';
import { settingsAPI } from '@/lib/api/settings';

export type SetupStepId =
  | 'whatsapp'
  | 'profile'
  | 'contacts'
  | 'conversations'
  | 'first_lead'
  | 'pipeline'
  | 'dashboard'
  | 'add_broker'
  | 'create_queue'
  | 'meta_integration'
  | 'configure_meta_forms'
  | 'add_property'
  | 'create_site'
  | 'create_automation';

export interface SetupStep {
  id: SetupStepId;
  title: string;
  description: string;
  icon: string;
  route: string;
  ctaLabel: string;
  section: string;
  tourTarget?: string;
}

const GUIDE_CUTOFF_DATE = new Date('2024-01-01T00:00:00Z');
const SESSION_SHOWN_KEY = 'setup_guide_shown_this_session';
const ACTIVE_STEP_LS_PREFIX = 'setup_guide_active_step_';
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
  const { user, profile } = useAuth();
  const { hasPermission } = useUserPermissions();
  const { hasModule } = useOrganizationModules();

  const [progress, setProgress] = useState<Record<string, boolean>>({});
  const [skipped, setSkipped] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const userId = user?.id;
  const organizationId = profile?.organization_id;
  const isNewUser = !!user?.created_at && new Date(user.created_at) >= GUIDE_CUTOFF_DATE;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const metaProgress = normalizeProgress(user?.user_metadata?.setup_progress);
  const metaSkipped = user?.user_metadata?.setup_skipped === true;
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';

  const brokerSteps: SetupStep[] = [
    {
      id: 'whatsapp',
      title: 'Conectar WhatsApp',
      description: 'Crie uma nova conexão e escaneie o QR Code no WhatsApp.',
      icon: 'MessageCircle',
      route: '/settings?tab=whatsapp',
      ctaLabel: 'Iniciar',
      section: 'Comunicação',
      tourTarget: 'whatsapp-new-session',
    },
    {
      id: 'profile',
      title: 'Completar meu perfil',
      description: 'Edite seus dados, foto, senha e mantenha o WhatsApp preenchido.',
      icon: 'UserCircle',
      route: '/settings?tab=account',
      ctaLabel: 'Abrir',
      section: 'Conta',
      tourTarget: 'account-profile',
    },
    {
      id: 'contacts',
      title: 'Conhecer contatos',
      description: 'Veja seus contatos, importe leads e organize sua base.',
      icon: 'Contact',
      route: '/crm/contacts',
      ctaLabel: 'Abrir',
      section: 'CRM',
      tourTarget: 'contacts-overview',
    },
    {
      id: 'conversations',
      title: 'Abrir conversas',
      description: 'Veja conversas do WhatsApp, grupos, arquivadas e leads vinculados.',
      icon: 'MessagesSquare',
      route: '/crm/conversas',
      ctaLabel: 'Abrir',
      section: 'Comunicação',
      tourTarget: 'conversations-overview',
    },
    {
      id: 'first_lead',
      title: 'Criar primeiro lead',
      description: 'Crie um lead manual para testar o fluxo de atendimento.',
      icon: 'UserPlus',
      route: '/crm/pipelines?new=lead',
      ctaLabel: 'Iniciar',
      section: 'CRM',
      tourTarget: 'pipeline-new-lead',
    },
    {
      id: 'pipeline',
      title: 'Conhecer a pipeline',
      description: 'Entenda colunas, cards, filtros, atualização e configurações.',
      icon: 'Columns3',
      route: '/crm/pipelines',
      ctaLabel: 'Abrir',
      section: 'CRM',
      tourTarget: 'pipeline-overview',
    },
    {
      id: 'dashboard',
      title: 'Ver minha dashboard',
      description: 'Entenda KPIs, ganhos, funil, origens e evolução do período.',
      icon: 'LayoutDashboard',
      route: '/dashboard',
      ctaLabel: 'Abrir',
      section: 'Relatórios',
      tourTarget: 'dashboard-overview',
    },
  ];

  const adminSteps: SetupStep[] = [
    ...brokerSteps,
    {
      id: 'add_broker',
      title: 'Adicionar corretor',
      description: 'Adicione corretores à sua equipe de vendas.',
      icon: 'Users',
      route: '/settings?tab=team',
      ctaLabel: 'Iniciar',
      section: 'Equipe',
      tourTarget: 'team-add-user',
    },
    {
      id: 'create_queue',
      title: 'Criar fila de atendimento',
      description: 'Defina como os leads serão distribuídos entre a equipe.',
      icon: 'Workflow',
      route: '/crm/management?tab=distribution',
      ctaLabel: 'Iniciar',
      section: 'Distribuição',
      tourTarget: 'distribution-new-queue',
    },
    {
      id: 'meta_integration',
      title: 'Integrar Meta',
      description: 'Conecte Facebook e Instagram para receber leads de campanha.',
      icon: 'Facebook',
      route: '/settings?tab=integrations',
      ctaLabel: 'Conectar',
      section: 'Integrações',
    },
    {
      id: 'configure_meta_forms',
      title: 'Configurar formulários Meta',
      description: 'Vincule formulários, campanhas e filas de atendimento.',
      icon: 'FileCog',
      route: '/settings?tab=integrations',
      ctaLabel: 'Configurar',
      section: 'Integrações',
    },
    {
      id: 'add_property',
      title: 'Cadastrar imóvel',
      description: 'Cadastre seu primeiro imóvel no sistema.',
      icon: 'Building2',
      route: '/properties/new',
      ctaLabel: 'Iniciar',
      section: 'Imóveis',
    },
    {
      id: 'create_site',
      title: 'Criar seu site',
      description: 'Personalize e publique o site da sua imobiliária.',
      icon: 'Globe',
      route: '/settings/site',
      ctaLabel: 'Iniciar',
      section: 'Site',
    },
    {
      id: 'create_automation',
      title: 'Criar automação',
      description: 'Automatize mensagens e ações para seus leads.',
      icon: 'Zap',
      route: '/automations',
      ctaLabel: 'Iniciar',
      section: 'Automações',
      tourTarget: 'automations-new',
    },
  ];

  const steps: SetupStep[] = (isAdmin ? adminSteps : brokerSteps).filter((step) => {
    switch (step.id) {
      case 'whatsapp':
      case 'conversations':
        return hasModule('whatsapp');
      case 'profile':
      case 'dashboard':
        return true;
      case 'contacts':
      case 'first_lead':
      case 'pipeline':
        return hasModule('crm');
      case 'add_broker':
        return isAdmin;
      case 'create_queue':
        return isAdmin && hasModule('round_robin');
      case 'meta_integration':
      case 'configure_meta_forms':
        return isAdmin && hasModule('campaigns');
      case 'add_property':
        return isAdmin && hasModule('properties');
      case 'create_site':
        return isAdmin && hasModule('site');
      case 'create_automation':
        return isAdmin && hasModule('automations') && hasPermission('automations_view');
      default:
        return true;
    }
  });

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
    if (!userId || !profile || !loaded) return;
    if (!isNewUser) return;
    if (skipped) return;

    const shownThisSession = sessionStorage.getItem(SESSION_SHOWN_KEY) === 'true';
    const allDone = steps.length > 0 && steps.every((s) => progress[s.id]);

    if (!shownThisSession && !allDone) {
      const timer = setTimeout(() => {
        setOpen(true);
        sessionStorage.setItem(SESSION_SHOWN_KEY, 'true');
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [userId, profile, loaded, isNewUser, skipped, steps, progress]);

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
        const active = localStorage.getItem(ACTIVE_STEP_LS_PREFIX + userId);
        if (active === id) localStorage.removeItem(ACTIVE_STEP_LS_PREFIX + userId);
      } catch {
        // ignore
      }
    },
    [userId, persist],
  );

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

  const skipAll = useCallback(() => {
    if (!userId) return;
    const next: Record<string, boolean> = {};
    steps.forEach((s) => (next[s.id] = true));
    setProgress(next);
    setSkipped(true);
    persist({ completed_steps: next, skipped: true });
    setOpen(false);
  }, [userId, steps, persist]);

  const restart = useCallback(() => {
    if (!userId) return;
    setProgress({});
    setSkipped(false);
    persist({ completed_steps: {}, skipped: false });
    try {
      localStorage.removeItem(ACTIVE_STEP_LS_PREFIX + userId);
    } catch {
      // ignore
    }
    sessionStorage.removeItem(SESSION_SHOWN_KEY);
  }, [userId, persist]);

  const setActiveStepId = useCallback(
    (id: string | null) => {
      if (!userId) return;
      try {
        if (id) {
          localStorage.setItem(ACTIVE_STEP_LS_PREFIX + userId, id);
        } else {
          localStorage.removeItem(ACTIVE_STEP_LS_PREFIX + userId);
        }
      } catch {
        // ignore
      }

    },
    [userId],
  );

  const activeStepId = (() => {
    if (!userId) return null;
    try {
      const fromMeta = user?.user_metadata?.setup_active_step;
      const fromLS = localStorage.getItem(ACTIVE_STEP_LS_PREFIX + userId);
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
    restart,
    completedCount,
    totalCount,
    percent,
    activeStepId,
    setActiveStepId,
    isNewUser,
  };
}
