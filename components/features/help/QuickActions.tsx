'use client';

import type { ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import {
  Kanban,
  UserPlus,
  Building2,
  Calendar,
  Settings,
  Zap,
  Phone,
  MessageCircle,
  ExternalLink,
} from 'lucide-react';
import { useOrganizationModules, type ModuleName } from '@/hooks/use-organization-modules';
import { useAuth } from '@/contexts/AuthContext';

interface QuickAction {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  path: string;
  module?: ModuleName;
  segment?: 'imobiliario';
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    icon: Kanban,
    title: 'Criar Lead no Pipeline',
    description: 'Adicionar um novo lead manualmente',
    path: '/crm/pipelines',
  },
  {
    icon: UserPlus,
    title: 'Importar Contatos',
    description: 'Importar planilha de contatos',
    path: '/crm/contacts',
  },
  {
    icon: Building2,
    title: 'Cadastrar Imóvel',
    description: 'Adicionar novo imóvel ao catálogo',
    path: '/properties',
    module: 'properties',
    segment: 'imobiliario',
  },
  {
    icon: MessageCircle,
    title: 'Configurar WhatsApp',
    description: 'Conectar sessão do WhatsApp',
    path: '/settings?tab=whatsapp',
    module: 'whatsapp',
  },
  {
    icon: Calendar,
    title: 'Conectar Google Agenda',
    description: 'Sincronizar com seu calendário',
    path: '/agenda',
    module: 'agenda',
  },
  {
    icon: Zap,
    title: 'Criar Automação',
    description: 'Configurar fluxos automáticos',
    path: '/automations',
    module: 'automations',
  },
  {
    icon: Settings,
    title: 'Configurar Equipes',
    description: 'Gerenciar times e distribuição',
    path: '/crm/management?tab=teams',
  },
  {
    icon: Phone,
    title: 'Configurar Cadências',
    description: 'Definir sequência de tarefas',
    path: '/crm/management?tab=distribution',
    module: 'cadences',
  },
];

export function QuickActions() {
  const router = useRouter();
  const { hasModule } = useOrganizationModules();
  const { organization } = useAuth();

  const segment = organization?.segment || 'imobiliario';

  // Filter actions based on modules and segment
  const availableActions = QUICK_ACTIONS.filter((action) => {
    // Check module availability
    if (action.module && !hasModule(action.module)) return false;

    // Check segment match
    if (action.segment && action.segment !== segment) return false;

    return true;
  }).slice(0, 6); // Show max 6 actions

  const handleClick = (path: string) => {
    router.push(path);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {availableActions.map((action) => (
        <button
          key={action.path}
          type="button"
          className="group text-left w-full rounded-lg border border-white/[0.055] bg-white/[0.035] hover:border-primary/50 hover:bg-white/[0.055] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          onClick={() => handleClick(action.path)}
        >
          <div className="p-4 flex items-start gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
              <action.icon className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-sm group-hover:text-primary transition-colors">
                  {action.title}
                </h3>
                <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {action.description}
              </p>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
