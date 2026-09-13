import { PropertyDevelopmentWorkspaceScreen } from '@/components/features/properties'
import { PermissionBoundary } from '@/components/shared/access/PermissionBoundary'

export default function PropertyDevelopmentWorkspacePage() {
  return (
    <PermissionBoundary
      title="Ficha do lançamento"
      permission="property_manage"
    >
      <PropertyDevelopmentWorkspaceScreen />
    </PermissionBoundary>
  )
}
