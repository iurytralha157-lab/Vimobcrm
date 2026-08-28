import {
  apiCreateUserResponseSchema,
  apiDeleteUserImpactResponseSchema,
  apiDeleteUserResponseSchema,
  apiUpdateUserResponseSchema,
  apiUserListResponseSchema,
  apiUserOrganizationListResponseSchema,
  createUserInputSchema,
  deleteUserInputSchema,
  parseDomainInput,
  updateUserInputSchema,
  uuidSchema,
  validateDomainResponse,
} from '@/lib/validation';
import { vimobAPIRequest } from './vimob-client';

type Envelope<T> = {
  data: T;
};

export type User = {
  id: string;
  organization_id: string | null;
  name: string;
  email: string;
  role: 'super_admin' | 'admin' | 'manager' | 'user' | string;
  avatar_url: string | null;
  is_active: boolean;
  whatsapp: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateUserInput = {
  name: string;
  email: string;
  phone?: string | null;
  whatsapp?: string | null;
  endereco?: string | null;
  role: 'admin' | 'manager' | 'user';
};

export type CreateUserResult = {
  success: boolean;
  user: User;
  generatedPassword?: string;
  whatsappSent: boolean;
  wasMultiOrg: boolean;
  wasOrphan: boolean;
  message?: string;
};

export type UpdateUserInput = Partial<Pick<User, 'name' | 'role' | 'is_active' | 'avatar_url' | 'whatsapp'>> & {
  id: string;
};

export type DeleteUserImpact = {
  leads: number;
  properties: number;
  whatsapp_sessions: number;
};

export type DeleteUserInput = {
  userId: string;
  transferLeadsToUserId?: string | null;
  transferPropertiesToUserId?: string | null;
};

export type DeleteUserResult = {
  success: boolean;
  impact: DeleteUserImpact;
};

export type UserOrganization = {
  organization_id: string;
  organization_name: string;
  organization_logo: string | null;
  member_role: string;
  is_active: boolean;
  joined_at: string;
  last_accessed_at: string | null;
};

export type OrganizationUsersScope = 'active' | 'management' | 'filters';

export const usersAPI = {
  async listUserOrganizations() {
    const response = await vimobAPIRequest<Envelope<UserOrganization[]>>('/v1/user-organizations');
    validateDomainResponse(apiUserOrganizationListResponseSchema, response, 'users.organizations');
    return response.data;
  },

  async listUsers(organizationId?: string | null, options?: { scope?: OrganizationUsersScope }) {
    const scope = options?.scope ?? 'active';
    const query = scope === 'active'
      ? ''
      : `?include_inactive=${scope === 'management' ? 'true' : 'filters'}`;
    const response = await vimobAPIRequest<Envelope<User[]>>(`/v1/users${query}`, {
      organizationId,
    });
    validateDomainResponse(apiUserListResponseSchema, response, 'users.list');
    return response.data;
  },

  async createUser(input: CreateUserInput, organizationId?: string | null) {
    const body = parseDomainInput(createUserInputSchema, input, 'users.create');
    const response = await vimobAPIRequest<CreateUserResult>('/v1/users', {
      method: 'POST',
      organizationId,
      body,
    });
    validateDomainResponse(apiCreateUserResponseSchema, response, 'users.create');
    return response;
  },

  async updateUser(input: UpdateUserInput, organizationId?: string | null) {
    const validated = parseDomainInput(updateUserInputSchema, input, 'users.update');
    const { id, ...updates } = validated;
    const response = await vimobAPIRequest<{ success: boolean; user: User }>(`/v1/users/${id}`, {
      method: 'PATCH',
      organizationId,
      body: { updates },
    });
    validateDomainResponse(apiUpdateUserResponseSchema, response, 'users.update');
    return response.user;
  },

  async getDeleteUserImpact(userId: string, organizationId?: string | null) {
    const validatedUserId = parseDomainInput(uuidSchema, userId, 'users.delete-impact');
    const response = await vimobAPIRequest<Envelope<DeleteUserImpact>>(`/v1/users/${validatedUserId}/delete-impact`, {
      organizationId,
    });
    validateDomainResponse(apiDeleteUserImpactResponseSchema, response, 'users.delete-impact');
    return response.data;
  },

  async deleteUser(input: DeleteUserInput, organizationId?: string | null) {
    const validated = parseDomainInput(deleteUserInputSchema, input, 'users.delete');
    const response = await vimobAPIRequest<DeleteUserResult>(`/v1/users/${validated.userId}`, {
      method: 'DELETE',
      organizationId,
      body: {
        transfer_leads_to_user_id: validated.transferLeadsToUserId || null,
        transfer_properties_to_user_id: validated.transferPropertiesToUserId || null,
      },
    });
    validateDomainResponse(apiDeleteUserResponseSchema, response, 'users.delete');
    return response;
  },
};
