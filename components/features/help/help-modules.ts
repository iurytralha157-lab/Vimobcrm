import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  BookOpenText,
  CalendarDays,
  ChartNoAxesCombined,
  ContactRound,
  House,
  Kanban,
  KeyRound,
  MessageCircleMore,
  Settings2,
  UsersRound,
  Workflow,
  Zap,
} from 'lucide-react'

export type HelpModuleDefinition = {
  key: string
  label: string
  description: string
  icon: LucideIcon
}

export const HELP_MODULES: HelpModuleDefinition[] = [
  {
    key: 'getting-started',
    label: 'Primeiros passos',
    description: 'Navegação, configuração inicial e visão geral do CRM.',
    icon: House,
  },
  {
    key: 'pipeline',
    label: 'Pipeline e leads',
    description: 'Cadastro, etapas, cadências, SLA e operação das oportunidades.',
    icon: Kanban,
  },
  {
    key: 'contacts',
    label: 'Contatos',
    description: 'Pesquisa, filtros, importação, exportação e gestão da base.',
    icon: ContactRound,
  },
  {
    key: 'schedule',
    label: 'Agenda',
    description: 'Compromissos, tarefas, visitas e sincronização de calendário.',
    icon: CalendarDays,
  },
  {
    key: 'conversations',
    label: 'Conversas e WhatsApp',
    description: 'Conexões, mensagens, mídia e atendimento dos leads.',
    icon: MessageCircleMore,
  },
  {
    key: 'automations',
    label: 'Automações',
    description: 'Gatilhos, fluxos, modelos, execuções e solução de falhas.',
    icon: Zap,
  },
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: 'Filtros, indicadores, funil, evolução e origens.',
    icon: ChartNoAxesCombined,
  },
  {
    key: 'management',
    label: 'Gestão',
    description: 'Equipes, distribuição, participantes e acesso operacional.',
    icon: Workflow,
  },
  {
    key: 'users',
    label: 'Usuários e permissões',
    description: 'Convites, funções, acessos e transferência de responsabilidades.',
    icon: UsersRound,
  },
  {
    key: 'properties',
    label: 'Imóveis',
    description: 'Cadastro, mídia, proprietários e publicação.',
    icon: BookOpenText,
  },
  {
    key: 'integrations',
    label: 'Integrações e API',
    description: 'Meta, chaves de API, webhooks e conexões externas.',
    icon: KeyRound,
  },
  {
    key: 'notifications',
    label: 'Notificações',
    description: 'Avisos, itens não lidos e atalhos para o contexto.',
    icon: Bell,
  },
]

const HELP_MODULE_BY_KEY = new Map(
  HELP_MODULES.map((module) => [module.key, module]),
)

const FALLBACK_MODULE: HelpModuleDefinition = {
  key: 'other',
  label: 'Outros recursos',
  description: 'Guias adicionais de uso do Vimob.',
  icon: Settings2,
}

export function getHelpModule(moduleKey: string) {
  return HELP_MODULE_BY_KEY.get(moduleKey) ?? {
    ...FALLBACK_MODULE,
    key: moduleKey,
  }
}

