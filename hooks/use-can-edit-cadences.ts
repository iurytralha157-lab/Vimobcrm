import { useUserPermissions } from '@/hooks/use-user-permissions';
import { canEditStageOperationalRules } from '@/lib/access/pipeline-settings-access';

/**
 * A edição das regras operacionais aceita pipeline_manage ou automations_manage.
 * Alterações da coluna e automações têm permissões próprias.
 */
export function useCanEditCadences(options?: { enabled?: boolean }) {
  const { hasPermission } = useUserPermissions();
  const enabled = options?.enabled ?? true;

  return enabled && canEditStageOperationalRules(hasPermission);
}
