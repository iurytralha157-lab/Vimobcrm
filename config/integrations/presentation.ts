import type {
  IntegrationCapability,
  IntegrationCategoryId,
} from "./types";

export const INTEGRATION_CATEGORY_CATALOG = {
  "customer-engagement": {
    title: "Atendimento e captação",
    description: "Canais que recebem, qualificam e acompanham novos contatos.",
  },
  "real-estate-portals": {
    title: "Portais imobiliários",
    description: "Publicação de imóveis e entrada de leads vindos dos portais.",
  },
  "automation-data": {
    title: "Agenda, API e automação",
    description: "Conectores para sincronização e troca segura de dados.",
  },
  "site-measurement": {
    title: "Site e mensuração",
    description: "Ferramentas instaladas no site publicado pela imobiliária.",
  },
  roadmap: {
    title: "Em planejamento",
    description: "Conectores visíveis no roadmap, ainda sem ativação disponível.",
  },
} as const satisfies Record<
  IntegrationCategoryId,
  { readonly title: string; readonly description: string }
>;

export const INTEGRATION_CAPABILITY_LABELS = {
  "connection-management": "Conexão",
  "session-management": "Sessões",
  "lead-ingestion": "Entrada de leads",
  messaging: "Mensagens",
  "ai-assistance": "Atendimento com IA",
  automation: "Automação",
  "form-management": "Formulários",
  "marketing-sync": "Marketing",
  "property-publication": "Publicação de imóveis",
  "calendar-sync": "Agenda",
  "webhook-ingestion": "Recebe webhooks",
  "webhook-delivery": "Envia webhooks",
  "api-access": "API",
  "site-measurement": "Mensuração",
  "social-sync": "Redes sociais",
} as const satisfies Record<IntegrationCapability, string>;
