import { vimobAPIRequest, vimobPublicAPIRequest } from './vimob-client';

type Envelope<T> = {
  data: T;
};

export type AdminJSON = Record<string, unknown>;

export const adminAPI = {
  async listOrganizations(params: { search?: string; status?: string; segment?: string } = {}) {
    const response = await vimobAPIRequest<Envelope<AdminJSON[]>>('/v1/admin/organizations', {
      query: params,
    });
    return response.data;
  },

  async listUsers() {
    const response = await vimobAPIRequest<Envelope<AdminJSON[]>>('/v1/admin/users');
    return response.data;
  },

  async listActiveAnnouncements<T = AdminJSON>() {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/announcements/active');
    return response.data;
  },

  async listMyFeatureRequests<T = AdminJSON>() {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/feature-requests/mine');
    return response.data;
  },

  async createFeatureRequest<T = AdminJSON>(body: AdminJSON, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/feature-requests', {
      method: 'POST',
      organizationId,
      body,
    });
    return response.data;
  },

  async listFeatureRequestsAdmin<T = AdminJSON>() {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/admin/feature-requests');
    return response.data;
  },

  async respondFeatureRequestAdmin<T = AdminJSON>(id: string, body: AdminJSON) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/admin/feature-requests/${id}`, {
      method: 'PATCH',
      body,
    });
    return response.data;
  },

  async listInvitations<T = AdminJSON>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/invitations', {
      query: { organizationId },
    });
    return response.data;
  },

  async createInvitation<T = AdminJSON>(body: AdminJSON) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/invitations', {
      method: 'POST',
      body,
    });
    return response.data;
  },

  async deleteInvitation(id: string) {
    return vimobAPIRequest<{ ok: boolean }>(`/v1/invitations/${id}`, {
      method: 'DELETE',
    });
  },

  async invitationByToken<T = AdminJSON>(token: string) {
    const response = await vimobPublicAPIRequest<Envelope<T | null>>(`/v1/public/invitations/${token}`);
    return response.data;
  },

  async acceptInvitationPublic<T = AdminJSON>(token: string, body: AdminJSON) {
    const response = await vimobPublicAPIRequest<Envelope<T>>(`/v1/public/invitations/${token}/accept`, {
      method: 'POST',
      body,
    });
    return response.data;
  },

  async acceptInvitationAuthenticated<T = AdminJSON>(token: string) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/invitations/${token}/accept`, {
      method: 'POST',
    });
    return response.data;
  },

  async myOnboardingRequest<T = AdminJSON | null>() {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/onboarding-requests/mine');
    return response.data;
  },

  async createOnboardingRequest<T = AdminJSON>(body: AdminJSON) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/onboarding-requests', {
      method: 'POST',
      body,
    });
    return response.data;
  },

  async listOnboardingRequestsAdmin<T = AdminJSON>() {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/admin/onboarding-requests');
    return response.data;
  },

  async updateOnboardingRequestAdmin<T = AdminJSON>(id: string, body: AdminJSON) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/admin/onboarding-requests/${id}`, {
      method: 'PATCH',
      body,
    });
    return response.data;
  },

  async listActiveSubscriptionPlans<T = AdminJSON>() {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/subscription-plans/active');
    return response.data;
  },

  async listTableRows(table: string, limit = 60) {
    const response = await vimobAPIRequest<Envelope<AdminJSON[]>>(`/v1/admin/tables/${table}`, {
      query: { limit },
    });
    return response.data;
  },

  async countTableRows(table: string) {
    return vimobAPIRequest<{ count: number }>(`/v1/admin/tables/${table}/count`);
  },

  async createTableRow<T = AdminJSON>(table: string, body: AdminJSON) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/admin/tables/${table}`, {
      method: 'POST',
      body,
    });
    return response.data;
  },

  async updateTableRow<T = AdminJSON>(table: string, id: string, body: AdminJSON) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/admin/tables/${table}/${id}`, {
      method: 'PATCH',
      body,
    });
    return response.data;
  },

  async deleteTableRow(table: string, id: string) {
    return vimobAPIRequest<{ ok: boolean }>(`/v1/admin/tables/${table}/${id}`, {
      method: 'DELETE',
    });
  },

  async databaseStats<T = AdminJSON>() {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/admin/database-stats');
    return response.data;
  },

  async orphanMemberStats<T = AdminJSON>() {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/admin/orphan-members');
    return response.data;
  },

  async cleanupOrphanMembers<T = AdminJSON>() {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/admin/orphan-members/cleanup', {
      method: 'POST',
    });
    return response.data;
  },

  async createOrganization(input: AdminJSON) {
    return vimobAPIRequest<{ organization: AdminJSON }>('/v1/admin/organizations', {
      method: 'POST',
      body: input,
    });
  },

  async updateOrganization(input: AdminJSON & { id: string }) {
    const { id, ...body } = input;
    return vimobAPIRequest<{ ok: boolean }>(`/v1/admin/organizations/${id}`, {
      method: 'PATCH',
      body,
    });
  },

  async deleteOrganization(id: string) {
    return vimobAPIRequest<{ ok: boolean }>(`/v1/admin/organizations/${id}`, {
      method: 'DELETE',
    });
  },

  async updateModuleAccess(input: { organizationId: string; moduleName: string; isEnabled: boolean }) {
    return vimobAPIRequest<{ ok: boolean }>('/v1/admin/modules', {
      method: 'POST',
      body: input,
    });
  },

  async listOrganizationModules(organizationId: string) {
    const response = await vimobAPIRequest<Envelope<AdminJSON[]>>(`/v1/admin/organizations/${organizationId}/modules`);
    return response.data;
  },

  async updateOrganizationAccess(input: {
    organizationId: string;
    organizationUpdates: AdminJSON;
    modules: string[];
  }) {
    return vimobAPIRequest<{ ok: boolean }>(`/v1/admin/organizations/${input.organizationId}/access`, {
      method: 'POST',
      body: {
        organizationUpdates: input.organizationUpdates,
        modules: input.modules,
      },
    });
  },

  async updateUser(input: AdminJSON & { userId: string }) {
    const { userId, ...body } = input;
    return vimobAPIRequest<{ ok: boolean }>(`/v1/admin/users/${userId}`, {
      method: 'PATCH',
      body,
    });
  },

  async deleteUser(userId: string) {
    return vimobAPIRequest<{ ok: boolean }>(`/v1/admin/users/${userId}`, {
      method: 'DELETE',
    });
  },

  async dashboardOverview(period: number) {
    const response = await vimobAPIRequest<Envelope<AdminJSON>>('/v1/admin/dashboard/overview', {
      query: { period },
    });
    return response.data;
  },

  async dashboardTimeseries(period: number) {
    const response = await vimobAPIRequest<Envelope<AdminJSON>>('/v1/admin/dashboard/timeseries', {
      query: { period },
    });
    return response.data;
  },

  async dashboardPending() {
    const response = await vimobAPIRequest<Envelope<AdminJSON>>('/v1/admin/dashboard/pending');
    return response.data;
  },

  async dashboardFeed(limit = 30) {
    const response = await vimobAPIRequest<Envelope<AdminJSON[]>>('/v1/admin/dashboard/feed', {
      query: { limit },
    });
    return response.data;
  },
};
