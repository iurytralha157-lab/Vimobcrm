import type { ElementType } from "react";
import {
  Bell,
  Bot,
  Bug,
  Building2,
  ClipboardList,
  CreditCard,
  Database,
  FileText,
  Gauge,
  Inbox,
  LifeBuoy,
  Mail,
  Megaphone,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

export type AdminSection =
  | "dashboard"
  | "organizations"
  | "organization-detail"
  | "users"
  | "plans"
  | "onboarding"
  | "requests"
  | "notifications"
  | "email-templates"
  | "email-logs"
  | "announcements"
  | "help"
  | "audit"
  | "error-logs"
  | "database"
  | "ai"
  | "settings"
  | "system-settings";

export type AdminNavGroup = "main" | "settings";

export type AdminNavItem = {
  section: Exclude<AdminSection, "organization-detail">;
  title: string;
  shortTitle?: string;
  description: string;
  href: string;
  icon: ElementType;
  group: AdminNavGroup;
};

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    section: "dashboard",
    title: "Dashboard Super Admin",
    shortTitle: "Dashboard",
    description: "Visão executiva da plataforma, clientes, usuários e uso.",
    href: "/admin",
    icon: Gauge,
    group: "main",
  },
  {
    section: "organizations",
    title: "Organizações",
    description: "Carteira de empresas, status, plano e sinais operacionais.",
    href: "/admin/organizations",
    icon: Building2,
    group: "main",
  },
  {
    section: "users",
    title: "Usuários",
    description: "Contas, perfis, vínculos e usuários sem organização.",
    href: "/admin/users",
    icon: Users,
    group: "main",
  },
  {
    section: "plans",
    title: "Planos",
    description: "Planos comerciais, limites e módulos liberados.",
    href: "/admin/plans",
    icon: CreditCard,
    group: "main",
  },
  {
    section: "requests",
    title: "Solicitações",
    description: "Pedidos de melhoria enviados pelas organizações.",
    href: "/admin/requests",
    icon: Inbox,
    group: "main",
  },
  {
    section: "notifications",
    title: "Notificações",
    description: "Fila e histórico das notificações sistêmicas.",
    href: "/admin/notifications",
    icon: Bell,
    group: "settings",
  },
  {
    section: "onboarding",
    title: "Onboarding",
    description: "Solicitações de cadastro, trial e aprovação comercial.",
    href: "/admin/onboarding",
    icon: ClipboardList,
    group: "settings",
  },
  {
    section: "announcements",
    title: "Comunicados",
    description: "Banners e avisos globais da plataforma.",
    href: "/admin/announcements",
    icon: Megaphone,
    group: "main",
  },
  {
    section: "email-templates",
    title: "Templates de e-mail",
    shortTitle: "Templates",
    description: "Modelos transacionais e variáveis de e-mail.",
    href: "/admin/email-templates",
    icon: Mail,
    group: "settings",
  },
  {
    section: "email-logs",
    title: "Logs de e-mail",
    shortTitle: "Logs e-mail",
    description: "Envios recentes, falhas e rastreabilidade.",
    href: "/admin/email-logs",
    icon: FileText,
    group: "settings",
  },
  {
    section: "help",
    title: "Editor da Ajuda",
    shortTitle: "Ajuda",
    description: "Artigos e categorias da central de ajuda.",
    href: "/admin/help",
    icon: LifeBuoy,
    group: "settings",
  },
  {
    section: "audit",
    title: "Auditoria",
    description: "Eventos sensíveis, acessos e alterações críticas.",
    href: "/admin/audit",
    icon: ShieldCheck,
    group: "settings",
  },
  {
    section: "error-logs",
    title: "Logs de erro",
    shortTitle: "Erros",
    description: "Falhas de frontend, API e backend agrupadas por fingerprint.",
    href: "/admin/error-logs",
    icon: Bug,
    group: "settings",
  },
  {
    section: "database",
    title: "Banco de dados",
    description: "Saúde visual das estruturas esperadas, sem executar SQL.",
    href: "/admin/database",
    icon: Database,
    group: "settings",
  },
  {
    section: "ai",
    title: "IA e agentes",
    shortTitle: "IA",
    description: "Preparação visual para agentes, memória e automações futuras.",
    href: "/admin/ai",
    icon: Bot,
    group: "main",
  },
  {
    section: "settings",
    title: "Configurações admin",
    shortTitle: "Config admin",
    description: "Branding, comunicação, manutenção e flags operacionais.",
    href: "/admin/settings",
    icon: Settings,
    group: "settings",
  },
  {
    section: "system-settings",
    title: "Configurações do sistema",
    shortTitle: "Sistema",
    description: "Resumo técnico das configurações globais da plataforma.",
    href: "/admin/system-settings",
    icon: Sparkles,
    group: "settings",
  },
];

export const ADMIN_MAIN_NAV_ITEMS = ADMIN_NAV_ITEMS.filter((item) => item.group === "main");
export const ADMIN_SETTINGS_NAV_ITEMS = ADMIN_NAV_ITEMS.filter((item) => item.group === "settings");

export function getAdminSectionConfig(section: AdminSection) {
  const normalizedSection = section === "organization-detail" ? "organizations" : section;
  return ADMIN_NAV_ITEMS.find((item) => item.section === normalizedSection) || ADMIN_NAV_ITEMS[0];
}

export function isAdminSection(section: AdminSection, item: AdminNavItem) {
  const normalizedSection = section === "organization-detail" ? "organizations" : section;
  return normalizedSection === item.section;
}
