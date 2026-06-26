import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { settingsAPI, type SettingsJSON } from '@/lib/api/settings';
import { toast } from 'sonner';

export interface OrganizationRole {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  color: string;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AvailablePermission {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: 'modules' | 'leads' | 'data' | 'settings';
}

export interface RolePermission {
  id: string;
  organization_role_id: string;
  permission_key: string;
}

export interface UserOrganizationRole {
  id: string;
  user_id: string;
  organization_role_id: string;
  created_at: string;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useOrganizationRoles() {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['organization-roles', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      return settingsAPI.listRoles<OrganizationRole>(organization.id);
    },
    enabled: !!organization?.id,
  });
}

export function useAvailablePermissions() {
  return useQuery({
    queryKey: ['available-permissions'],
    queryFn: () => settingsAPI.listPermissions<AvailablePermission>(),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

export function useRolePermissions(roleId: string | null) {
  return useQuery({
    queryKey: ['role-permissions', roleId],
    queryFn: async () => {
      if (!roleId) return [];
      return settingsAPI.listRolePermissions<RolePermission>(roleId);
    },
    enabled: !!roleId,
  });
}

export function useUserOrganizationRoles() {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['user-organization-roles', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      return settingsAPI.listUserRoles<UserOrganizationRole>(organization.id);
    },
    enabled: !!organization?.id,
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      color?: string;
      permissions?: string[];
    }) => {
      if (!organization?.id) throw new Error('Organização não encontrada');
      return settingsAPI.createRole<OrganizationRole>(data as unknown as SettingsJSON, organization.id);
    },
    onSuccess: () => {
      toast.success('Função criada com sucesso!');
      queryClient.invalidateQueries({ queryKey: ['organization-roles'] });
    },
    onError: (error: unknown) => {
      toast.error('Erro ao criar função: ' + getErrorMessage(error));
    },
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();

  return useMutation({
    mutationFn: async (data: {
      id: string;
      name?: string;
      description?: string;
      color?: string;
      is_active?: boolean;
    }) => {
      const { id, ...updates } = data;
      return settingsAPI.updateRole<OrganizationRole>(id, updates as SettingsJSON, organization?.id);
    },
    onSuccess: () => {
      toast.success('Função atualizada!');
      queryClient.invalidateQueries({ queryKey: ['organization-roles'] });
    },
    onError: (error: unknown) => {
      toast.error('Erro ao atualizar função: ' + getErrorMessage(error));
    },
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();

  return useMutation({
    mutationFn: (roleId: string) => settingsAPI.deleteRole(roleId, organization?.id),
    onSuccess: () => {
      toast.success('Função excluída!');
      queryClient.invalidateQueries({ queryKey: ['organization-roles'] });
      queryClient.invalidateQueries({ queryKey: ['user-organization-roles'] });
    },
    onError: (error: unknown) => {
      toast.error('Erro ao excluir função: ' + getErrorMessage(error));
    },
  });
}

export function useUpdateRolePermissions() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();

  return useMutation({
    mutationFn: (data: { roleId: string; permissions: string[] }) =>
      settingsAPI.replaceRolePermissions(data.roleId, data.permissions, organization?.id),
    onSuccess: (_, variables) => {
      toast.success('Permissões atualizadas!');
      queryClient.invalidateQueries({ queryKey: ['role-permissions', variables.roleId] });
    },
    onError: (error: unknown) => {
      toast.error('Erro ao atualizar permissões: ' + getErrorMessage(error));
    },
  });
}

export function useAssignUserRole() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();

  return useMutation({
    mutationFn: (data: { userId: string; roleId: string | null }) =>
      settingsAPI.assignUserRole(data, organization?.id),
    onSuccess: () => {
      toast.success('Função do usuário atualizada!');
      queryClient.invalidateQueries({ queryKey: ['user-organization-roles'] });
      queryClient.invalidateQueries({ queryKey: ['organization-users'] });
    },
    onError: (error: unknown) => {
      toast.error('Erro ao atribuir função: ' + getErrorMessage(error));
    },
  });
}

export function useHasPermission(permissionKey: string) {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ['has-permission', profile?.id, permissionKey],
    queryFn: async () => {
      if (!profile?.id) return false;
      if (profile.role === 'admin' || profile.role === 'super_admin') return true;
      return settingsAPI.hasPermission(permissionKey);
    },
    enabled: !!profile?.id,
  });
}
