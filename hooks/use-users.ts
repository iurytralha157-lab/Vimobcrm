import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { usersAPI, type CreateUserInput, type DeleteUserInput, type UpdateUserInput, type User } from '@/lib/api/users';

export type { CreateUserInput, DeleteUserImpact, DeleteUserInput, UpdateUserInput, User } from '@/lib/api/users';

export function useOrganizationUsers() {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

  return useQuery({
    queryKey: ['organization-users', orgId],
    queryFn: () => usersAPI.listUsers(orgId),
    enabled: !!orgId,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  });
}

// Alias for backward compatibility
export const useUsers = useOrganizationUsers;

export function useDeleteUserImpact(userId?: string | null, enabled = true) {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

  return useQuery({
    queryKey: ['organization-user-delete-impact', orgId, userId],
    queryFn: () => usersAPI.getDeleteUserImpact(userId as string, orgId),
    enabled: enabled && !!orgId && !!userId,
    staleTime: 1000 * 15,
  });
}

export function useCreateUser() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const orgId = profile?.organization_id;

  return useMutation({
    mutationFn: (input: CreateUserInput) => usersAPI.createUser(input, orgId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-users'] });
    },
  });
}

export function useUpdateUser() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const orgId = profile?.organization_id;

  return useMutation({
    mutationFn: (input: UpdateUserInput) => usersAPI.updateUser(input, orgId),
    onSuccess: (updatedUser: User) => {
      queryClient.setQueriesData<User[]>({ queryKey: ['organization-users'] }, (current) => {
        if (!Array.isArray(current)) return current;
        return current.map((user) => (user.id === updatedUser.id ? { ...user, ...updatedUser } : user));
      });
      queryClient.invalidateQueries({ queryKey: ['organization-users'] });
      toast.success('Usuario atualizado!');
    },
    onError: (error) => {
      toast.error('Erro ao atualizar usuario: ' + error.message);
    },
  });
}

export function useDeleteUser() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const orgId = profile?.organization_id;

  return useMutation({
    mutationFn: (input: DeleteUserInput) => usersAPI.deleteUser(input, orgId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-users'] });
    },
  });
}
