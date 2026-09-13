import {
  BarChart3,
  Building2,
  CalendarDays,
  CircleHelp,
  ContactRound,
  CreditCard,
  KanbanSquare,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";

import type { SystemModuleKey } from "@/config/constants";
import type { HomePublicationCard } from "@/lib/api/home";

export type HomeQuickAction = {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  module?: SystemModuleKey;
  permission?: string;
  anyPermissions?: string[];
};

export const HOME_PAGE_SECTIONS = {
  focus: false,
  publications: true,
} as const;

export const HOME_QUICK_ACTIONS: HomeQuickAction[] = [
  {
    label: "Pipeline",
    description: "Acompanhar oportunidades",
    href: "/crm/pipelines",
    icon: KanbanSquare,
    module: "crm",
    anyPermissions: ["lead_view_own", "lead_view_team", "lead_view_all"],
  },
  {
    label: "Contatos",
    description: "Buscar leads e clientes",
    href: "/crm/contacts",
    icon: ContactRound,
    module: "crm",
    anyPermissions: ["lead_view_own", "lead_view_team", "lead_view_all"],
  },
  {
    label: "Agenda",
    description: "Ver compromissos",
    href: "/agenda",
    icon: CalendarDays,
    module: "agenda",
    permission: "schedule_view",
  },
  {
    label: "Conversas",
    description: "Atender pelo WhatsApp",
    href: "/crm/conversas",
    icon: MessageCircle,
    module: "whatsapp",
    permission: "whatsapp_view",
  },
  {
    label: "Imóveis",
    description: "Consultar o portfólio",
    href: "/properties",
    icon: Building2,
    module: "properties",
    anyPermissions: ["property_view", "property_manage"],
  },
  {
    label: "Dashboard",
    description: "Analisar os resultados",
    href: "/dashboard",
    icon: BarChart3,
    permission: "dashboard_view",
  },
  {
    label: "Ajuda",
    description: "Abrir a central de ajuda",
    href: "/suporte",
    icon: CircleHelp,
  },
];

export const HOME_BILLING_ACTION: HomeQuickAction = {
  label: "Assinatura",
  description: "Regularizar o acesso",
  href: "/settings?tab=subscription",
  icon: CreditCard,
};

export const HOME_PUBLICATION_CTA_OPTIONS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Pipeline", href: "/crm/pipelines" },
  { label: "Contatos", href: "/crm/contacts" },
  { label: "Conversas", href: "/crm/conversas" },
  { label: "Agenda", href: "/agenda" },
  { label: "Automações", href: "/automations" },
  { label: "Automações — fluxos", href: "/automations?tab=automations" },
  { label: "Automações — modelos", href: "/automations?tab=templates" },
  { label: "Automações — histórico", href: "/automations?tab=history" },
  { label: "Imóveis", href: "/properties" },
  { label: "Arena", href: "/gamificacao" },
  { label: "Notificações", href: "/notifications" },
  { label: "Configurações", href: "/settings" },
  { label: "Central de ajuda", href: "/suporte" },
] as const satisfies ReadonlyArray<{
  label: string;
  href: HomePublicationCard["ctaHref"];
}>;
