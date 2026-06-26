import { vimobAPIRequest } from './vimob-client';

type Envelope<T> = {
  data: T;
};

export type User = {
  id: string;
  organization_id: string | null;
  name: string;
  email: string;
  role: 'super_admin' | 'admin' | 'user' | string;
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
  role: 'admin' | 'user';
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

export type UserOrganization = {
  organization_id: string;
  organization_name: string;
  organization_logo: string | null;
  member_role: string;
  is_active: boolean;
  joined_at: string;
  last_accessed_at: string | null;
};

export const usersAPI = {
  async listUserOrganizations() {
    const response = await vimobAPIRequest<Envelope<UserOrganization[]>>('/v1/user-organizations');
    return response.data;
  },

  async listUsers(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<User[]>>('/v1/users', {
      organizationId,
    });
    return response.data;
  },

  async createUser(input: CreateUserInput, organizationId?: string | null) {
    return vimobAPIRequest<CreateUserResult>('/v1/users', {
      method: 'POST',
      organizationId,
      body: input,
    });
  },

  async updateUser(input: UpdateUserInput, organizationId?: string | null) {
    const { id, ...updates } = input;
    const response = await vimobAPIRequest<{ success: boolean; user: User }>(`/v1/users/${id}`, {
      method: 'PATCH',
      organizationId,
      body: { updates },
    });
    return response.user;
  },

  async deleteUser(userId: string, organizationId?: string | null) {
    return vimobAPIRequest<{ success: boolean }>(`/v1/users/${userId}`, {
      method: 'DELETE',
      organizationId,
    });
  },
};
