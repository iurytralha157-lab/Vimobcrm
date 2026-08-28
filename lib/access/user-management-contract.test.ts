import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const readSource = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

test('gestao de usuarios solicita inativos sem contaminar caches de outras organizacoes', () => {
  const teamSource = readSource('components/features/settings/TeamTab.tsx')
  const hookSource = readSource('hooks/use-users.ts')

  assert.match(teamSource, /scope:\s*canManageUsers \? 'management' : 'active'/)
  assert.match(teamSource, /grid-cols-1[^"']*sm:grid-cols-2[^"']*xl:grid-cols-3[^"']*2xl:grid-cols-4/)
  assert.match(hookSource, /\['organization-users',\s*orgId,\s*scope\]/)
  assert.match(hookSource, /setQueriesData<User\[]>\(\{ queryKey: \['organization-users', orgId\] \}/)
})

test('filtros historicos incluem inativos sem liberar novas atribuicoes', () => {
  const sharedFiltersSource = readSource('components/shared/SharedFilters.tsx')
  const propertiesSource = readSource('components/features/properties/PropertiesScreen.tsx')
  const createLeadSource = readSource('components/features/leads/CreateLeadDialog.tsx')
  const propertyFormSource = readSource('components/features/properties/PropertyFormScreen.tsx')

  assert.match(sharedFiltersSource, /scope:\s*'filters'/)
  assert.match(propertiesSource, /useUsers\(\{ scope: 'filters' \}\)/)
  assert.match(sharedFiltersSource, /getUserFilterLabel/)
  assert.match(propertiesSource, /getUserFilterLabel/)
  assert.doesNotMatch(createLeadSource, /scope:\s*'filters'/)
  assert.doesNotMatch(propertyFormSource, /scope:\s*'filters'/)
})

test('usuario sem organizacao ativa permanece autenticado na tela de selecao', () => {
  const authSource = readSource('contexts/AuthContext.tsx')
  const layoutSource = readSource('components/shared/layout/AppLayout.tsx')
  const appSource = readSource('apps/api/internal/app/app.go')

  assert.match(appSource, /GET \/v1\/user-organizations", withAuth\(/)
  assert.doesNotMatch(appSource, /GET \/v1\/user-organizations", withAuthTenant\(/)
  assert.match(authSource, /if \(count === 0\)[\s\S]*setOrganization\(null\)[\s\S]*setTenantContext\(null\)/)
  assert.match(layoutSource, /if \(!hasSelectableOrganization\)[\s\S]*router\.replace\('\/select-organization'\)/)
})

test('membership removida nao reabre acesso por tenant, troca de organizacao ou helpers legados', () => {
  const tenantSource = readSource('apps/api/internal/tenant/repository.go')
  const meSource = readSource('apps/api/internal/me/repository.go')
  const migrationSource = readSource(
    'supabase/migrations/20260827000000_distinguish_disabled_and_deleted_organization_members.sql',
  )

  assert.equal((tenantSource.match(/om\.deleted_at is null/g) ?? []).length, 3)
  assert.equal((meSource.match(/deleted_at is null/g) ?? []).length, 2)
  assert.match(migrationSource, /private\.is_org_member\(session\.organization_id\)/)
  assert.match(
    migrationSource,
    /revoke insert, update, delete on table public\.user_roles from anon, authenticated;/,
  )
})
