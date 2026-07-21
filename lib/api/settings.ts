import {
  apiAssetUploadResponseSchema,
  apiBooleanResponseSchema,
  apiChangePasswordResponseSchema,
  apiCreateApiKeyResponseSchema,
  apiOrganizationApiKeyListResponseSchema,
  apiOrganizationModuleListResponseSchema,
  apiPublicPushConfigResponseSchema,
  apiRecordEnvelopeSchema,
  apiRecordListEnvelopeSchema,
  apiSetupGuideProgressResponseSchema,
  apiSubscriptionOverviewResponseSchema,
  apiUserPermissionProfileResponseSchema,
  apiUnknownEnvelopeSchema,
  assignUserRoleInputSchema,
  changePasswordInputSchema,
  createApiKeyInputSchema,
  deactivatePushTokenInputSchema,
  okResponseSchema,
  parseDomainInput,
  permissionKeySchema,
  pushTokenInputSchema,
  replaceRolePermissionsInputSchema,
  replaceUserPermissionsInputSchema,
  selectSubscriptionPlanInputSchema,
  settingsRoleInputSchema,
  setupGuideProgressInputSchema,
  subscriptionBillingInputSchema,
  updateOrganizationInputSchema,
  updateProfileInputSchema,
  uuidSchema,
  validateDomainResponse,
} from '@/lib/validation';
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

export type PublicPushConfig = {
  enabled: boolean;
  publicKey: string;
  fingerprint: string;
};

export type UserPermissionItem = {
  key: string;
  label: string;
  description: string;
  domain: string;
  allowed: boolean;
  defaultAllowed: boolean;
  override: boolean | null;
};

export type UserPermissionProfile = {
  userId: string;
  profile: string;
  locked: boolean;
  permissions: UserPermissionItem[];
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
  property_edit_policy?: 'everyone' | 'responsible_or_admin' | null;
  property_owner_contact_visibility?: 'visible' | 'hidden' | null;
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
  async getPushConfig() {
    const response = await vimobPublicAPIRequest<Envelope<PublicPushConfig>>('/v1/public/push-config', {
      timeoutMs: 4_000,
      skipTelemetry: true,
    });
    validateDomainResponse(apiPublicPushConfigResponseSchema, response, 'settings.push-config.get');
    return response.data;
  },

  async getSystemSettings<T = SettingsJSON>() {
    const response = await vimobPublicAPIRequest<Envelope<T | null>>('/v1/public/system-settings');
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'settings.system.get');
    return response.data;
  },

  async updateProfile(input: UpdateProfileInput, organizationId?: string | null) {
    const body = parseDomainInput(updateProfileInputSchema, input, 'settings.profile.update');
    const response = await vimobAPIRequest<{ ok: boolean }>('/v1/settings/profile', {
      method: 'PATCH',
      organizationId,
      body,
    });
    validateDomainResponse(okResponseSchema, response, 'settings.profile.update');
    return response;
  },

  async uploadProfileAvatar(file: Blob, organizationId?: string | null) {
    const formData = new FormData();
    formData.append('file', file, 'avatar.png');

    const response = await vimobAPIRequest<Envelope<AssetUpload>>('/v1/settings/profile/avatar', {
      method: 'POST',
      organizationId,
      body: formData,
    });
    validateDomainResponse(apiAssetUploadResponseSchema, response, 'settings.profile.avatar');
    return response.data;
  },

  async updateOrganization(input: UpdateOrganizationInput, organizationId?: string | null) {
    const body = parseDomainInput(updateOrganizationInputSchema, input, 'settings.organization.update');
    const response = await vimobAPIRequest<{ ok: boolean }>('/v1/settings/organization', {
      method: 'PATCH',
      organizationId,
      body,
    });
    validateDomainResponse(okResponseSchema, response, 'settings.organization.update');
    return response;
  },

  async uploadOrganizationLogo(file: Blob, organizationId?: string | null) {
    const formData = new FormData();
    formData.append('file', file, 'logo.png');

    const response = await vimobAPIRequest<Envelope<AssetUpload>>('/v1/settings/organization/logo', {
      method: 'POST',
      organizationId,
      body: formData,
    });
    validateDomainResponse(apiAssetUploadResponseSchema, response, 'settings.organization.logo');
    return response.data;
  },

  async changePassword(input: { password: string; source?: string }, organizationId?: string | null) {
    const body = parseDomainInput(changePasswordInputSchema, input, 'settings.password.change');
    const response = await vimobAPIRequest<{ allowed: boolean; message: string; emailNotificationSent?: boolean }>('/v1/settings/password', {
      method: 'POST',
      organizationId,
      body,
    });
    validateDomainResponse(apiChangePasswordResponseSchema, response, 'settings.password.change');
    return response;
  },

  async passwordStatus<T>() {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/settings/password/status');
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'settings.password.status');
    return response.data;
  },

  async listApiKeys(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<OrganizationApiKey[]>>('/v1/settings/api-keys', {
      organizationId,
    });
    validateDomainResponse(apiOrganizationApiKeyListResponseSchema, response, 'settings.api-keys.list');
    return response.data;
  },

  async listModules(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<OrganizationModule[]>>('/v1/settings/modules', {
      organizationId,
      timeoutMs: 4_000,
      skipTelemetry: true,
    });
    validateDomainResponse(apiOrganizationModuleListResponseSchema, response, 'settings.modules.list');
    return response.data;
  },

  async getSetupGuideProgress(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<SetupGuideProgress>>('/v1/settings/setup-guide-progress', {
      organizationId,
    });
    validateDomainResponse(apiSetupGuideProgressResponseSchema, response, 'settings.setup-guide.get');
    return response.data;
  },

  async updateSetupGuideProgress(input: Partial<SetupGuideProgress>, organizationId?: string | null) {
    const body = parseDomainInput(setupGuideProgressInputSchema, input, 'settings.setup-guide.update');
    const response = await vimobAPIRequest<Envelope<SetupGuideProgress>>('/v1/settings/setup-guide-progress', {
      method: 'PUT',
      organizationId,
      body,
    });
    validateDomainResponse(apiSetupGuideProgressResponseSchema, response, 'settings.setup-guide.update');
    return response.data;
  },

  async savePushToken(input: {
    endpoint: string;
    p256dh?: string | null;
    auth?: string | null;
    userAgent?: string | null;
    vapidPublicKey?: string | null;
    syncOnly?: boolean;
  }, organizationId?: string | null) {
    const body = parseDomainInput(pushTokenInputSchema, input, 'settings.push-token.save');
    const response = await vimobAPIRequest<{ ok: boolean; active?: boolean; requiresResubscribe?: boolean }>('/v1/settings/push-tokens', {
      method: 'POST',
      organizationId,
      body,
    });
    validateDomainResponse(okResponseSchema, response, 'settings.push-token.save');
    return response;
  },

  async deactivatePushToken(endpoint?: string | null) {
    const body = parseDomainInput(deactivatePushTokenInputSchema, { endpoint }, 'settings.push-token.deactivate');
    const response = await vimobAPIRequest<{ ok: boolean }>('/v1/settings/push-tokens/deactivate', {
      method: 'POST',
      body,
    });
    validateDomainResponse(okResponseSchema, response, 'settings.push-token.deactivate');
    return response;
  },

  async createApiKey(input: { name?: string }, organizationId?: string | null) {
    const body = parseDomainInput(createApiKeyInputSchema, input, 'settings.api-keys.create');
    const response = await vimobAPIRequest<Envelope<CreateApiKeyResult>>('/v1/settings/api-keys', {
      method: 'POST',
      organizationId,
      body,
    });
    validateDomainResponse(apiCreateApiKeyResponseSchema, response, 'settings.api-keys.create');
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
    validateDomainResponse(apiSubscriptionOverviewResponseSchema, response, 'settings.subscription.get');
    return response.data;
  },

  async updateSubscriptionBilling(input: UpdateSubscriptionBillingInput, organizationId?: string | null) {
    const body = parseDomainInput(subscriptionBillingInputSchema, input, 'settings.subscription.billing');
    const response = await vimobAPIRequest<Envelope<SubscriptionOverview>>('/v1/settings/subscription/billing', {
      method: 'PATCH',
      organizationId,
      body,
    });
    validateDomainResponse(apiSubscriptionOverviewResponseSchema, response, 'settings.subscription.billing');
    return response.data;
  },

  async selectSubscriptionPlan(input: { plan_id: string }, organizationId?: string | null) {
    const body = parseDomainInput(selectSubscriptionPlanInputSchema, input, 'settings.subscription.plan');
    const response = await vimobAPIRequest<Envelope<SubscriptionOverview>>('/v1/settings/subscription/plan', {
      method: 'PATCH',
      organizationId,
      body,
    });
    validateDomainResponse(apiSubscriptionOverviewResponseSchema, response, 'settings.subscription.plan');
    return response.data;
  },

  async listRoles<T = SettingsJSON>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/settings/roles', {
      organizationId,
    });
    validateDomainResponse(apiRecordListEnvelopeSchema, response, 'settings.roles.list');
    return response.data;
  },

  async createRole<T = SettingsJSON>(input: SettingsJSON, organizationId?: string | null) {
    const body = parseDomainInput(settingsRoleInputSchema, input, 'settings.roles.create');
    const response = await vimobAPIRequest<Envelope<T>>('/v1/settings/roles', {
      method: 'POST',
      organizationId,
      body,
    });
    validateDomainResponse(apiRecordEnvelopeSchema, response, 'settings.roles.create');
    return response.data;
  },

  async updateRole<T = SettingsJSON>(id: string, input: SettingsJSON, organizationId?: string | null) {
    const body = parseDomainInput(settingsRoleInputSchema, input, 'settings.roles.update');
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/settings/roles/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    });
    validateDomainResponse(apiRecordEnvelopeSchema, response, 'settings.roles.update');
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
    validateDomainResponse(apiRecordListEnvelopeSchema, response, 'settings.permissions.list');
    return response.data;
  },

  async getUserPermissions(userId: string, organizationId?: string | null) {
    const id = parseDomainInput(uuidSchema, userId, 'settings.user-permissions.user-id');
    const response = await vimobAPIRequest<Envelope<UserPermissionProfile>>(`/v1/settings/users/${id}/permissions`, {
      organizationId,
    });
    validateDomainResponse(apiUserPermissionProfileResponseSchema, response, 'settings.user-permissions.get');
    return response.data;
  },

  async replaceUserPermissions(userId: string, permissions: Record<string, boolean>, organizationId?: string | null) {
    const body = parseDomainInput(replaceUserPermissionsInputSchema, { permissions }, 'settings.user-permissions.replace');
    const response = await vimobAPIRequest<Envelope<UserPermissionProfile>>(`/v1/settings/users/${userId}/permissions`, {
      method: 'PUT',
      organizationId,
      body,
    });
    validateDomainResponse(apiUserPermissionProfileResponseSchema, response, 'settings.user-permissions.replace');
    return response.data;
  },

  async resetUserPermissions(userId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<UserPermissionProfile>>(`/v1/settings/users/${userId}/permissions`, {
      method: 'DELETE',
      organizationId,
    });
    validateDomainResponse(apiUserPermissionProfileResponseSchema, response, 'settings.user-permissions.reset');
    return response.data;
  },

  async listRolePermissions<T = SettingsJSON>(roleId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T[]>>(`/v1/settings/roles/${roleId}/permissions`, {
      organizationId,
    });
    validateDomainResponse(apiRecordListEnvelopeSchema, response, 'settings.role-permissions.list');
    return response.data;
  },

  async replaceRolePermissions(roleId: string, permissions: string[], organizationId?: string | null) {
    const body = parseDomainInput(replaceRolePermissionsInputSchema, { permissions }, 'settings.role-permissions.replace');
    const response = await vimobAPIRequest<{ ok: boolean }>(`/v1/settings/roles/${roleId}/permissions`, {
      method: 'PUT',
      organizationId,
      body,
    });
    validateDomainResponse(okResponseSchema, response, 'settings.role-permissions.replace');
    return response;
  },

  async listUserRoles<T = SettingsJSON>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/settings/user-roles', {
      organizationId,
    });
    validateDomainResponse(apiRecordListEnvelopeSchema, response, 'settings.user-roles.list');
    return response.data;
  },

  async assignUserRole(input: { userId: string; roleId: string | null }, organizationId?: string | null) {
    const body = parseDomainInput(assignUserRoleInputSchema, input, 'settings.user-roles.assign');
    const response = await vimobAPIRequest<{ ok: boolean }>('/v1/settings/user-roles', {
      method: 'PUT',
      organizationId,
      body,
    });
    validateDomainResponse(okResponseSchema, response, 'settings.user-roles.assign');
    return response;
  },

  async hasPermission(permissionKey: string) {
    const validatedPermissionKey = parseDomainInput(permissionKeySchema, permissionKey, 'settings.permissions.check');
    const response = await vimobAPIRequest<Envelope<boolean>>('/v1/settings/has-permission', {
      query: { permissionKey: validatedPermissionKey },
    });
    validateDomainResponse(apiBooleanResponseSchema, response, 'settings.permissions.check');
    return response.data;
  },
};
