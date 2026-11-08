import PropertyWorkspaceScreen, {
  type PropertyWorkspaceTab,
} from '@/components/features/properties/PropertyWorkspaceScreen'
import { PermissionBoundary } from '@/components/shared/access/PermissionBoundary'

const WORKSPACE_TABS = new Set<PropertyWorkspaceTab>([
  'overview',
  'technical',
  'commercial',
  'media',
  'publication',
  'keys',
  'history',
])

/** Older links open the tab that replaced them. */
const LEGACY_WORKSPACE_TABS: Record<string, PropertyWorkspaceTab> = {
  responsibles: 'commercial',
}

type PropertyWorkspacePageProps = {
  searchParams: Promise<{ tab?: string | string[] }>
}

export default async function PropertyWorkspacePage({ searchParams }: PropertyWorkspacePageProps) {
  const requestedTab = (await searchParams).tab
  const requested = Array.isArray(requestedTab) ? requestedTab[0] : requestedTab
  const candidate = requested ? LEGACY_WORKSPACE_TABS[requested] ?? requested : requested
  const initialTab = candidate && WORKSPACE_TABS.has(candidate as PropertyWorkspaceTab)
    ? candidate as PropertyWorkspaceTab
    : 'overview'

  return (
    <PermissionBoundary
      title="Ficha do imóvel"
      anyOf={["property_view", "property_manage"]}
    >
      <PropertyWorkspaceScreen key={initialTab} initialTab={initialTab} />
    </PermissionBoundary>
  )
}
