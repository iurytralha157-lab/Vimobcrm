import UserPermissionsScreen from '@/components/features/settings/UserPermissionsScreen'
import { PermissionBoundary } from '@/components/shared/access/PermissionBoundary'

export default async function UserPermissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <PermissionBoundary title="Permissoes do usuario" permission="permissions_manage">
      <UserPermissionsScreen userId={id} />
    </PermissionBoundary>
  )
}
