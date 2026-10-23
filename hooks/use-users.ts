import { useQueryWithDataTrust, type QueryDataTrustScope } from '@/hooks/shared/use-query-data-trust';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { usersAPI, type DeleteUserInput, type UpdateUserInput, type User } from '@/lib/api/users';

export type { DeleteUserImpact, DeleteUserInput, UpdateUserInput, User } from '@/lib/api/users';

export type OrganizationUsersScope = 'active' | 'management' | 'filters';

export function useOrganizationUsers(options?: { enabled?: boolean; scope?: OrganizationUsersScope; cacheTrustScope?: QueryDataTrustScope }) {
  const { activeOrganization } = useAuth();
  const orgId = activeOrganization.organizationId;
  const scope = options?.scope ?? 'active';

  return useQueryWithDataTrust({
    queryKey: ['organization-users', orgId, scope],
    queryFn: () => usersAPI.listUsers(orgId, { scope }),
    enabled: !!orgId && (options?.enabled ?? true),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  }, options?.cacheTrustScope);
}

// Alias for backward compatibility
export const useUsers = useOrganizationUsers;

export function useDeleteUserImpact(userId?: string | null, enabled = true) {
  const { activeOrganization } = useAuth();
  const orgId = activeOrganization.organizationId;

  return useQuery({
    queryKey: ['organization-user-delete-impact', orgId, userId],
    queryFn: () => usersAPI.getDeleteUserImpact(userId as string, orgId),
    enabled: enabled && !!orgId && !!userId,
    staleTime: 1000 * 15,
  });
}

export function useUpdateUser() {
  const { activeOrganization } = useAuth();
  const queryClient = useQueryClient();
  const orgId = activeOrganization.organizationId;

  return useMutation({
    mutationFn: (input: UpdateUserInput) => usersAPI.updateUser(input, orgId),
    onSuccess: (updatedUser: User) => {
      queryClient.setQueriesData<User[]>({ queryKey: ['organization-users', orgId] }, (current) => {
        if (!Array.isArray(current)) return current;
        return current.map((user) => (user.id === updatedUser.id ? { ...user, ...updatedUser } : user));
      });
      queryClient.invalidateQueries({ queryKey: ['organization-users', orgId] });
      toast.success('Usuário atualizado!');
    },
    onError: (error) => {
      toast.error('Erro ao atualizar usuario: ' + error.message);
    },
  });
}

export function useDeleteUser() {
  const { activeOrganization } = useAuth();
  const queryClient = useQueryClient();
  const orgId = activeOrganization.organizationId;

  return useMutation({
    mutationFn: (input: DeleteUserInput) => usersAPI.deleteUser(input, orgId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-users', orgId] });
    },
  });
}
