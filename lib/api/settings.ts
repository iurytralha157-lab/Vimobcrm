import { vimobAPIRequest, vimobPublicAPIRequest } from './vimob-client';

type Envelope<T> = {
  data: T;
};

export type OrganizationApiKey = {
  id: string;
  organization_id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type OrganizationModule = {
  id: string;
  organization_id: string;
  module_name: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type SetupGuideProgress = {
  completed_steps: Record<string, boolean>;
  skipped: boolean;
};

export type CreateApiKeyResult = {
  apiKey: string;
  key: OrganizationApiKey;
};

export type UpdateProfileInput = {
  name?: string | null;
  whatsapp?: string | null;
  cpf?: string | null;
  theme_mode?: 'light' | 'dark' | 'system' | null;
  language?: string | null;
};

export type UpdateOrganizationInput = {
  name?: string | null;
  cnpj?: string | null;
  creci?: string | null;
  inscricao_estadual?: string | null;
  razao_social?: string | null;
  nome_fantasia?: string | null;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  telefone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  default_commission_percentage?: number | null;
};

export type AssetUpload = {
  url: string;
  path: string;
  bucket: string;
  contentType: string;
  size: number;
};

export type SubscriptionOrganization = UpdateOrganizationInput & {
  id: string;
  name: string;
  plan_id: string | null;
  plan_name?: string | null;
  subscription_status: string;
  subscription_type: string | null;
  subscription_value: number | null;
  next_billing_date: string | null;
  max_users: number;
  max_whatsapp_sessions_override: number | null;
};

export type SubscriptionPlan = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  billing_cycle: string | null;
  max_users: number | null;
  max_leads: number | null;
  max_whatsapp_sessions: number | null;
  modules: string[] | null;
  is_active: boolean | null;
  trial_enabled: boolean | null;
  trial_days: number | null;
};

export type PaymentHistoryItem = {
  id: string;
  organization_id: string;
  asaas_payment_id: string;
  asaas_subscription_id: string | null;
  asaas_customer_id: string | null;
  billing_type: string | null;
  status: string | null;
  value: number | null;
  net_value: number | null;
  due_date: string | null;
  payment_date: string | null;
  invoice_url: string | null;
};

export type SubscriptionOverview = {
  org: SubscriptionOrganization | null;
  plan: SubscriptionPlan | null;
  availablePlans: SubscriptionPlan[];
  history: PaymentHistoryItem[];
};

export type UpdateSubscriptionBillingInput = {
  razao_social?: string | null;
  cnpj?: string | null;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  email?: string | null;
  telefone?: string | null;
};

export type SettingsJSON = Record<string, unknown>;

export const settingsAPI = {
  async getSystemSettings<T = SettingsJSON>() {
    const response = await vimobPublicAPIRequest<Envelope<T | null>>('/v1/public/system-settings');
    return response.data;
  },

  async updateProfile(input: UpdateProfileInput, organizationId?: string | null) {
    return vimobAPIRequest<{ ok: boolean }>('/v1/settings/profile', {
      method: 'PATCH',
      organizationId,
      body: input,
    });
  },

  async uploadProfileAvatar(file: Blob, organizationId?: string | null) {
    const formData = new FormData();
    formData.append('file', file, 'avatar.png');

    const response = await vimobAPIRequest<Envelope<AssetUpload>>('/v1/settings/profile/avatar', {
      method: 'POST',
      organizationId,
      body: formData,
    });
    return response.data;
  },

  async updateOrganization(input: UpdateOrganizationInput, organizationId?: string | null) {
    return vimobAPIRequest<{ ok: boolean }>('/v1/settings/organization', {
      method: 'PATCH',
      organizationId,
      body: input,
    });
  },

  async uploadOrganizationLogo(file: Blob, organizationId?: string | null) {
    const formData = new FormData();
    formData.append('file', file, 'logo.png');

    const response = await vimobAPIRequest<Envelope<AssetUpload>>('/v1/settings/organization/logo', {
      method: 'POST',
      organizationId,
      body: formData,
    });
    return response.data;
  },

  async changePassword(input: { password: string; source?: string }, organizationId?: string | null) {
    return vimobAPIRequest<{ allowed: boolean; message: string }>('/v1/settings/password', {
      method: 'POST',
      organizationId,
      body: input,
    });
  },

  async passwordStatus<T>() {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/settings/password/status');
    return response.data;
  },

  async listApiKeys(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<OrganizationApiKey[]>>('/v1/settings/api-keys', {
      organizationId,
    });
    return response.data;
  },

  async listModules(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<OrganizationModule[]>>('/v1/settings/modules', {
      organizationId,
    });
    return response.data;
  },

  async getSetupGuideProgress(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<SetupGuideProgress>>('/v1/settings/setup-guide-progress', {
      organizationId,
    });
    return response.data;
  },

  async updateSetupGuideProgress(input: Partial<SetupGuideProgress>, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<SetupGuideProgress>>('/v1/settings/setup-guide-progress', {
      method: 'PUT',
      organizationId,
      body: input,
    });
    return response.data;
  },

  async savePushToken(input: {
    endpoint: string;
    p256dh?: string | null;
    auth?: string | null;
    userAgent?: string | null;
  }, organizationId?: string | null) {
    return vimobAPIRequest<{ ok: boolean }>('/v1/settings/push-tokens', {
      method: 'POST',
      organizationId,
      body: input,
    });
  },

  async deactivatePushToken(endpoint?: string | null) {
    return vimobAPIRequest<{ ok: boolean }>('/v1/settings/push-tokens/deactivate', {
      method: 'POST',
      body: { endpoint },
    });
  },

  async createApiKey(input: { name?: string }, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<CreateApiKeyResult>>('/v1/settings/api-keys', {
      method: 'POST',
      organizationId,
      body: input,
    });
    return response.data;
  },

  async deleteApiKey(id: string, organizationId?: string | null) {
    await vimobAPIRequest<null>(`/v1/settings/api-keys/${id}`, {
      method: 'DELETE',
      organizationId,
    });
  },

  async getSubscription(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<SubscriptionOverview>>('/v1/settings/subscription', {
      organizationId,
    });
    return response.data;
  },

  async updateSubscriptionBilling(input: UpdateSubscriptionBillingInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<SubscriptionOverview>>('/v1/settings/subscription/billing', {
      method: 'PATCH',
      organizationId,
      body: input,
    });
    return response.data;
  },

  async selectSubscriptionPlan(input: { plan_id: string }, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<SubscriptionOverview>>('/v1/settings/subscription/plan', {
      method: 'PATCH',
      organizationId,
      body: input,
    });
    return response.data;
  },

  async listRoles<T = SettingsJSON>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/settings/roles', {
      organizationId,
    });
    return response.data;
  },

  async createRole<T = SettingsJSON>(input: SettingsJSON, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/settings/roles', {
      method: 'POST',
      organizationId,
      body: input,
    });
    return response.data;
  },

  async updateRole<T = SettingsJSON>(id: string, input: SettingsJSON, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/settings/roles/${id}`, {
      method: 'PATCH',
      organizationId,
      body: input,
    });
    return response.data;
  },

  async deleteRole(id: string, organizationId?: string | null) {
    await vimobAPIRequest<null>(`/v1/settings/roles/${id}`, {
      method: 'DELETE',
      organizationId,
    });
  },

  async listPermissions<T = SettingsJSON>() {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/settings/permissions');
    return response.data;
  },

  async listRolePermissions<T = SettingsJSON>(roleId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T[]>>(`/v1/settings/roles/${roleId}/permissions`, {
      organizationId,
    });
    return response.data;
  },

  async replaceRolePermissions(roleId: string, permissions: string[], organizationId?: string | null) {
    return vimobAPIRequest<{ ok: boolean }>(`/v1/settings/roles/${roleId}/permissions`, {
      method: 'PUT',
      organizationId,
      body: { permissions },
    });
  },

  async listUserRoles<T = SettingsJSON>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/settings/user-roles', {
      organizationId,
    });
    return response.data;
  },

  async assignUserRole(input: { userId: string; roleId: string | null }, organizationId?: string | null) {
    return vimobAPIRequest<{ ok: boolean }>('/v1/settings/user-roles', {
      method: 'PUT',
      organizationId,
      body: input,
    });
  },

  async hasPermission(permissionKey: string) {
    const response = await vimobAPIRequest<Envelope<boolean>>('/v1/settings/has-permission', {
      query: { permissionKey },
    });
    return response.data;
  },
};
