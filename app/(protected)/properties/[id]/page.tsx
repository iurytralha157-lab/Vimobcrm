import PropertyWorkspaceScreen, {
  type PropertyWorkspaceTab,
} from '@/components/features/properties/PropertyWorkspaceScreen'

const WORKSPACE_TABS = new Set<PropertyWorkspaceTab>([
  'overview',
  'technical',
  'commercial',
  'responsibles',
  'media',
  'publication',
  'keys',
  'history',
])

type PropertyWorkspacePageProps = {
  searchParams: Promise<{ tab?: string | string[] }>
}

export default async function PropertyWorkspacePage({ searchParams }: PropertyWorkspacePageProps) {
  const requestedTab = (await searchParams).tab
  const candidate = Array.isArray(requestedTab) ? requestedTab[0] : requestedTab
  const initialTab = candidate && WORKSPACE_TABS.has(candidate as PropertyWorkspaceTab)
    ? candidate as PropertyWorkspaceTab
    : 'overview'

  return <PropertyWorkspaceScreen initialTab={initialTab} />
}
