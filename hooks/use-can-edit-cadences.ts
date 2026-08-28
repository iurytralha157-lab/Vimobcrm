import { useUserPermissions } from '@/hooks/use-user-permissions';

/**
 * Hook para verificar se o usuario pode editar cadencias e pipelines.
 * Mantem a UI alinhada com a mesma permissao exigida pelo backend.
 */
export function useCanEditCadences(options?: { enabled?: boolean }) {
  const { hasPermission } = useUserPermissions();
  const enabled = options?.enabled ?? true;

  return enabled && hasPermission('pipeline_manage');
}
