import SiteSettingsScreen from '@/components/features/site/SiteSettingsScreen'
import { PermissionBoundary } from '@/components/shared/access/PermissionBoundary'

export default function SiteSettingsPage() {
  return (
    <PermissionBoundary module="site" title="Configuracao do site" permission="settings_site">
      <SiteSettingsScreen />
    </PermissionBoundary>
  )
}
