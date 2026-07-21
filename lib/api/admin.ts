import {
  adminFeatureRequestInputSchema,
  adminInvitationInputSchema,
  adminListLimitSchema,
  adminModuleAccessInputSchema,
  adminOrganizationAccessInputSchema,
  adminOrganizationMutationInputSchema,
  adminOrganizationQuerySchema,
  adminPeriodSchema,
  adminUserMutationInputSchema,
  apiAdminOrganizationMutationResponseSchema,
  apiCountResponseSchema,
  apiDynamicRecordListResponseSchema,
  apiDynamicRecordResponseSchema,
  apiOptionalDynamicRecordResponseSchema,
  nonEmptyDynamicRecordSchema,
  okResponseSchema,
  opaqueTokenSchema,
  parseDomainInput,
  safePathSegmentSchema,
  uuidSchema,
  validateDomainResponse,
} from '@/lib/validation';
import { vimobAPIRequest, vimobPublicAPIRequest } from './vimob-client';

type Envelope<T> = {
  data: T;
};

export type AdminJSON = Record<string, unknown>;

export const adminAPI = {
  async listOrganizations(params: { search?: string; status?: string; segment?: string } = {}) {
    const query = parseDomainInput(adminOrganizationQuerySchema, params, 'admin.organizations.list');
    const response = await vimobAPIRequest<Envelope<AdminJSON[]>>('/v1/admin/organizations', {
      query,
    });
    validateDomainResponse(apiDynamicRecordListResponseSchema, response, 'admin.organizations.list');
    return response.data;
  },

  async listUsers() {
    const response = await vimobAPIRequest<Envelope<AdminJSON[]>>('/v1/admin/users');
    validateDomainResponse(apiDynamicRecordListResponseSchema, response, 'admin.users.list');
    return response.data;
  },

  async listActiveAnnouncements<T = AdminJSON>() {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/announcements/active');
    validateDomainResponse(apiDynamicRecordListResponseSchema, response, 'admin.announcements.active');
    return response.data;
  },

  async listMyFeatureRequests<T = AdminJSON>() {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/feature-requests/mine');
    validateDomainResponse(apiDynamicRecordListResponseSchema, response, 'admin.feature-requests.mine');
    return response.data;
  },

  async createFeatureRequest<T = AdminJSON>(body: AdminJSON, organizationId?: string | null) {
    const validatedBody = parseDomainInput(adminFeatureRequestInputSchema, body, 'admin.feature-requests.create');
    const response = await vimobAPIRequest<Envelope<T>>('/v1/feature-requests', {
      method: 'POST',
      organizationId,
      body: validatedBody,
    });
    validateDomainResponse(apiDynamicRecordResponseSchema, response, 'admin.feature-requests.create');
    return response.data;
  },

  async listFeatureRequestsAdmin<T = AdminJSON>() {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/admin/feature-requests');
    validateDomainResponse(apiDynamicRecordListResponseSchema, response, 'admin.feature-requests.list');
    return response.data;
  },

  async respondFeatureRequestAdmin<T = AdminJSON>(id: string, body: AdminJSON) {
    const validatedBody = parseDomainInput(nonEmptyDynamicRecordSchema, body, 'admin.feature-requests.respond');
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/admin/feature-requests/${id}`, {
      method: 'PATCH',
      body: validatedBody,
    });
    validateDomainResponse(apiDynamicRecordResponseSchema, response, 'admin.feature-requests.respond');
    return response.data;
  },

  async listInvitations<T = AdminJSON>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/invitations', {
      query: { organizationId },
    });
    validateDomainResponse(apiDynamicRecordListResponseSchema, response, 'admin.invitations.list');
    return response.data;
  },

  async createInvitation<T = AdminJSON>(body: AdminJSON) {
    const validatedBody = parseDomainInput(adminInvitationInputSchema, body, 'admin.invitations.create');
    const response = await vimobAPIRequest<Envelope<T>>('/v1/invitations', {
      method: 'POST',
      body: validatedBody,
    });
    validateDomainResponse(apiDynamicRecordResponseSchema, response, 'admin.invitations.create');
    return response.data;
  },

  async deleteInvitation(id: string) {
    const validatedId = parseDomainInput(uuidSchema, id, 'admin.invitations.delete');
    const response = await vimobAPIRequest<{ ok: boolean }>(`/v1/invitations/${validatedId}`, {
      method: 'DELETE',
    });
    validateDomainResponse(okResponseSchema, response, 'admin.invitations.delete');
    return response;
  },

  async resendInvitation<T = AdminJSON>(id: string) {
    const validatedId = parseDomainInput(uuidSchema, id, 'admin.invitations.resend');
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/invitations/${validatedId}/resend`, {
      method: 'POST',
    });
    validateDomainResponse(apiDynamicRecordResponseSchema, response, 'admin.invitations.resend');
    return response.data;
  },

  async invitationByToken<T = AdminJSON>(token: string) {
    const validatedToken = parseDomainInput(opaqueTokenSchema, token, 'admin.invitations.token');
    const response = await vimobPublicAPIRequest<Envelope<T | null>>(`/v1/public/invitations/${validatedToken}`);
    validateDomainResponse(apiOptionalDynamicRecordResponseSchema, response, 'admin.invitations.token');
    return response.data;
  },

  async acceptInvitationPublic<T = AdminJSON>(token: string, body: AdminJSON) {
    const validatedToken = parseDomainInput(opaqueTokenSchema, token, 'admin.invitations.accept-public.token');
    const validatedBody = parseDomainInput(nonEmptyDynamicRecordSchema, body, 'admin.invitations.accept-public');
    const response = await vimobPublicAPIRequest<Envelope<T>>(`/v1/public/invitations/${validatedToken}/accept`, {
      method: 'POST',
      body: validatedBody,
    });
    validateDomainResponse(apiDynamicRecordResponseSchema, response, 'admin.invitations.accept-public');
    return response.data;
  },

  async acceptInvitationAuthenticated<T = AdminJSON>(token: string) {
    const validatedToken = parseDomainInput(opaqueTokenSchema, token, 'admin.invitations.accept.token');
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/invitations/${validatedToken}/accept`, {
      method: 'POST',
    });
    validateDomainResponse(apiDynamicRecordResponseSchema, response, 'admin.invitations.accept');
    return response.data;
  },

  async myOnboardingRequest<T = AdminJSON | null>() {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/onboarding-requests/mine');
    validateDomainResponse(apiOptionalDynamicRecordResponseSchema, response, 'admin.onboarding.mine');
    return response.data;
  },

  async createOnboardingRequest<T = AdminJSON>(body: AdminJSON) {
    const validatedBody = parseDomainInput(nonEmptyDynamicRecordSchema, body, 'admin.onboarding.create');
    const response = await vimobAPIRequest<Envelope<T>>('/v1/onboarding-requests', {
      method: 'POST',
      body: validatedBody,
    });
    validateDomainResponse(apiDynamicRecordResponseSchema, response, 'admin.onboarding.create');
    return response.data;
  },

  async listOnboardingRequestsAdmin<T = AdminJSON>() {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/admin/onboarding-requests');
    validateDomainResponse(apiDynamicRecordListResponseSchema, response, 'admin.onboarding.list');
    return response.data;
  },

  async updateOnboardingRequestAdmin<T = AdminJSON>(id: string, body: AdminJSON) {
    const validatedId = parseDomainInput(uuidSchema, id, 'admin.onboarding.update.id');
    const validatedBody = parseDomainInput(nonEmptyDynamicRecordSchema, body, 'admin.onboarding.update');
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/admin/onboarding-requests/${validatedId}`, {
      method: 'PATCH',
      body: validatedBody,
    });
    validateDomainResponse(apiDynamicRecordResponseSchema, response, 'admin.onboarding.update');
    return response.data;
  },

  async listActiveSubscriptionPlans<T = AdminJSON>() {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/subscription-plans/active');
    validateDomainResponse(apiDynamicRecordListResponseSchema, response, 'admin.plans.active');
    return response.data;
  },

  async listTableRows(table: string, limit = 60) {
    const validatedTable = parseDomainInput(safePathSegmentSchema, table, 'admin.tables.list.table');
    const validatedLimit = parseDomainInput(adminListLimitSchema, limit, 'admin.tables.list.limit');
    const response = await vimobAPIRequest<Envelope<AdminJSON[]>>(`/v1/admin/tables/${validatedTable}`, {
      query: { limit: validatedLimit },
    });
    validateDomainResponse(apiDynamicRecordListResponseSchema, response, 'admin.tables.list');
    return response.data;
  },

  async countTableRows(table: string) {
    const validatedTable = parseDomainInput(safePathSegmentSchema, table, 'admin.tables.count.table');
    const response = await vimobAPIRequest<{ count: number }>(`/v1/admin/tables/${validatedTable}/count`);
    validateDomainResponse(apiCountResponseSchema, response, 'admin.tables.count');
    return response;
  },

  async createTableRow<T = AdminJSON>(table: string, body: AdminJSON) {
    const validatedTable = parseDomainInput(safePathSegmentSchema, table, 'admin.tables.create.table');
    const validatedBody = parseDomainInput(nonEmptyDynamicRecordSchema, body, 'admin.tables.create');
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/admin/tables/${validatedTable}`, {
      method: 'POST',
      body: validatedBody,
    });
    validateDomainResponse(apiDynamicRecordResponseSchema, response, 'admin.tables.create');
    return response.data;
  },

  async updateTableRow<T = AdminJSON>(table: string, id: string, body: AdminJSON) {
    const validatedTable = parseDomainInput(safePathSegmentSchema, table, 'admin.tables.update.table');
    const validatedId = parseDomainInput(safePathSegmentSchema, id, 'admin.tables.update.id');
    const validatedBody = parseDomainInput(nonEmptyDynamicRecordSchema, body, 'admin.tables.update');
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/admin/tables/${validatedTable}/${validatedId}`, {
      method: 'PATCH',
      body: validatedBody,
    });
    validateDomainResponse(apiDynamicRecordResponseSchema, response, 'admin.tables.update');
    return response.data;
  },

  async deleteTableRow(table: string, id: string) {
    const validatedTable = parseDomainInput(safePathSegmentSchema, table, 'admin.tables.delete.table');
    const validatedId = parseDomainInput(safePathSegmentSchema, id, 'admin.tables.delete.id');
    const response = await vimobAPIRequest<{ ok: boolean }>(`/v1/admin/tables/${validatedTable}/${validatedId}`, {
      method: 'DELETE',
    });
    validateDomainResponse(okResponseSchema, response, 'admin.tables.delete');
    return response;
  },

  async orphanMemberStats<T = AdminJSON>() {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/admin/orphan-members');
    validateDomainResponse(apiDynamicRecordResponseSchema, response, 'admin.orphans.stats');
    return response.data;
  },

  async cleanupOrphanMembers<T = AdminJSON>() {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/admin/orphan-members/cleanup', {
      method: 'POST',
    });
    validateDomainResponse(apiDynamicRecordResponseSchema, response, 'admin.orphans.cleanup');
    return response.data;
  },

  async createOrganization(input: AdminJSON) {
    const body = parseDomainInput(adminOrganizationMutationInputSchema, input, 'admin.organizations.create');
    const response = await vimobAPIRequest<{ organization: AdminJSON }>('/v1/admin/organizations', {
      method: 'POST',
      body,
    });
    validateDomainResponse(apiAdminOrganizationMutationResponseSchema, response, 'admin.organizations.create');
    return response;
  },

  async updateOrganization(input: AdminJSON & { id: string }) {
    const { id, ...body } = input;
    const validatedId = parseDomainInput(uuidSchema, id, 'admin.organizations.update.id');
    const validatedBody = parseDomainInput(adminOrganizationMutationInputSchema, body, 'admin.organizations.update');
    const response = await vimobAPIRequest<{ ok: boolean }>(`/v1/admin/organizations/${validatedId}`, {
      method: 'PATCH',
      body: validatedBody,
    });
    validateDomainResponse(okResponseSchema, response, 'admin.organizations.update');
    return response;
  },

  async deleteOrganization(id: string) {
    const validatedId = parseDomainInput(uuidSchema, id, 'admin.organizations.delete.id');
    const response = await vimobAPIRequest<{ ok: boolean }>(`/v1/admin/organizations/${validatedId}`, {
      method: 'DELETE',
    });
    validateDomainResponse(okResponseSchema, response, 'admin.organizations.delete');
    return response;
  },

  async updateModuleAccess(input: { organizationId: string; moduleName: string; isEnabled: boolean }) {
    const body = parseDomainInput(adminModuleAccessInputSchema, input, 'admin.modules.update');
    const response = await vimobAPIRequest<{ ok: boolean }>('/v1/admin/modules', {
      method: 'POST',
      body,
    });
    validateDomainResponse(okResponseSchema, response, 'admin.modules.update');
    return response;
  },

  async listOrganizationModules(organizationId: string) {
    const validatedId = parseDomainInput(uuidSchema, organizationId, 'admin.modules.list.organization-id');
    const response = await vimobAPIRequest<Envelope<AdminJSON[]>>(`/v1/admin/organizations/${validatedId}/modules`);
    validateDomainResponse(apiDynamicRecordListResponseSchema, response, 'admin.modules.list');
    return response.data;
  },

  async listOrganizationPayments(organizationId: string) {
    const validatedId = parseDomainInput(uuidSchema, organizationId, 'admin.payments.list.organization-id');
    const response = await vimobAPIRequest<Envelope<AdminJSON[]>>(`/v1/admin/organizations/${validatedId}/payments`);
    validateDomainResponse(apiDynamicRecordListResponseSchema, response, 'admin.payments.list');
    return response.data;
  },

  async updateOrganizationAccess(input: {
    organizationId: string;
    organizationUpdates: AdminJSON;
    modules: string[];
  }) {
    const organizationId = parseDomainInput(uuidSchema, input.organizationId, 'admin.access.organization-id');
    const body = parseDomainInput(adminOrganizationAccessInputSchema, {
      organizationUpdates: input.organizationUpdates,
      modules: input.modules,
    }, 'admin.access.update');
    const response = await vimobAPIRequest<{ ok: boolean }>(`/v1/admin/organizations/${organizationId}/access`, {
      method: 'POST',
      body,
    });
    validateDomainResponse(okResponseSchema, response, 'admin.access.update');
    return response;
  },

  async updateUser(input: AdminJSON & { userId: string }) {
    const { userId, ...body } = input;
    const validatedUserId = parseDomainInput(uuidSchema, userId, 'admin.users.update.id');
    const validatedBody = parseDomainInput(adminUserMutationInputSchema, body, 'admin.users.update');
    const response = await vimobAPIRequest<{ ok: boolean }>(`/v1/admin/users/${validatedUserId}`, {
      method: 'PATCH',
      body: validatedBody,
    });
    validateDomainResponse(okResponseSchema, response, 'admin.users.update');
    return response;
  },

  async deleteUser(userId: string) {
    const validatedUserId = parseDomainInput(uuidSchema, userId, 'admin.users.delete.id');
    const response = await vimobAPIRequest<{ ok: boolean }>(`/v1/admin/users/${validatedUserId}`, {
      method: 'DELETE',
    });
    validateDomainResponse(okResponseSchema, response, 'admin.users.delete');
    return response;
  },

  async resetUserPassword(userId: string) {
    const validatedUserId = parseDomainInput(uuidSchema, userId, 'admin.users.reset-password.id');
    const response = await vimobAPIRequest<Envelope<AdminJSON>>(`/v1/admin/users/${validatedUserId}/reset-password`, {
      method: 'POST',
    });
    validateDomainResponse(apiDynamicRecordResponseSchema, response, 'admin.users.reset-password');
    return response.data;
  },

  async dashboardOverview(period: number) {
    const validatedPeriod = parseDomainInput(adminPeriodSchema, period, 'admin.dashboard.overview.period');
    const response = await vimobAPIRequest<Envelope<AdminJSON>>('/v1/admin/dashboard/overview', {
      query: { period: validatedPeriod },
    });
    validateDomainResponse(apiDynamicRecordResponseSchema, response, 'admin.dashboard.overview');
    return response.data;
  },

  async dashboardTimeseries(period: number) {
    const validatedPeriod = parseDomainInput(adminPeriodSchema, period, 'admin.dashboard.timeseries.period');
    const response = await vimobAPIRequest<Envelope<AdminJSON>>('/v1/admin/dashboard/timeseries', {
      query: { period: validatedPeriod },
    });
    validateDomainResponse(apiDynamicRecordResponseSchema, response, 'admin.dashboard.timeseries');
    return response.data;
  },

  async dashboardPending() {
    const response = await vimobAPIRequest<Envelope<AdminJSON>>('/v1/admin/dashboard/pending');
    validateDomainResponse(apiDynamicRecordResponseSchema, response, 'admin.dashboard.pending');
    return response.data;
  },

  async dashboardFeed(limit = 30) {
    const validatedLimit = parseDomainInput(adminListLimitSchema, limit, 'admin.dashboard.feed.limit');
    const response = await vimobAPIRequest<Envelope<AdminJSON[]>>('/v1/admin/dashboard/feed', {
      query: { limit: validatedLimit },
    });
    validateDomainResponse(apiDynamicRecordListResponseSchema, response, 'admin.dashboard.feed');
    return response.data;
  },
};
