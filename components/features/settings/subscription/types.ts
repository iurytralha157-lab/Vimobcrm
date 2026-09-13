import type {
  BillingPlanChange,
  SubscriptionOrganization,
  SubscriptionPlan,
} from "@/lib/api/settings";

export type CheckoutNotice = "success" | "cancelled" | "expired" | null;

export type SubscriptionData = {
  org: SubscriptionOrganization | null;
  plan: SubscriptionPlan | null;
  pendingPlan: SubscriptionPlan | null;
  planChange: BillingPlanChange | null;
  billingCheckoutReady: boolean;
};

export type BillingInfo = {
  name: string;
  taxId: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  email: string;
  telefone: string;
};
