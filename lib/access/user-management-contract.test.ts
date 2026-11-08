import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const readSource = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

test('gestao de usuarios solicita inativos sem contaminar caches de outras organizacoes', () => {
  const teamSource = readSource('components/features/settings/TeamTab.tsx')
  const hookSource = readSource('hooks/use-users.ts')

  assert.match(teamSource, /scope:\s*canManageUsers \? 'management' : 'active'/)
  assert.match(teamSource, /const visibleUsers = users\.filter\(\(user\) => \{/)
  assert.match(teamSource, /visibleUsers\.map\(\(user\) =>/)
  assert.match(hookSource, /\['organization-users',\s*orgId,\s*scope\]/)
  assert.match(hookSource, /setQueriesData<User\[]>\(\{ queryKey: \['organization-users', orgId\] \}/)
})

test('convite em lote permanece no BFF e usa dialogo central', () => {
  const teamSource = readSource('components/features/settings/TeamTab.tsx')
  const invitationHookSource = readSource('hooks/use-invitations.ts')

  assert.match(teamSource, /<Dialog[\s\S]*data-tour="team-invite-dialog"/)
  assert.doesNotMatch(teamSource, /<Sheet[\s>]/)
  assert.match(teamSource, /organizationInvitationBatchSchema\.safeParse/)
  assert.match(teamSource, /<form[\s\S]*?noValidate/)
  assert.match(invitationHookSource, /organizationInvitationBatchSchema\.parse\(inputs\)/)
  assert.match(invitationHookSource, /for \(const input of validatedInputs\)/)
  assert.doesNotMatch(invitationHookSource, /Promise\.all\(inputs/)
  assert.match(invitationHookSource, /email: input\.email,[\s\S]*role: input\.role,[\s\S]*organizationId/)
})

test('cartoes e acoes de usuario preservam a hierarquia visual solicitada', () => {
  const teamSource = readSource('components/features/settings/TeamTab.tsx')
  const userCardClass = teamSource.match(
    /<article\s+key=\{user\.id\}\s+className="([^"]+)"/,
  )?.[1]

  assert.ok(userCardClass)
  assert.match(userCardClass, /bg-\[var\(--app-surface-soft\)\]/)
  assert.doesNotMatch(userCardClass, /\bborder(?:-|\b)/)
  assert.doesNotMatch(teamSource, />\s*Perfil\s*</)
  assert.match(teamSource, /bg-emerald-700 text-\[10px\] text-white/)
  assert.match(
    teamSource,
    /className="h-9 min-w-0 flex-1[^\n]*border-0 bg-\[var\(--app-surface-soft\)\][^\n]*"[\s\S]*?<span className="truncate">Permissões<\/span>/,
  )
  assert.match(
    teamSource,
    /className="flex h-9 min-w-0 flex-1[^\n]*bg-\[var\(--app-surface-soft\)\][^\n]*"[\s\S]*?Acesso ativo/,
  )
  assert.match(teamSource, /data-\[state=checked\]:bg-primary/)
  assert.match(teamSource, /data-\[state=unchecked\]:bg-\[var\(--app-border\)\]/)
  assert.match(teamSource, /variant="destructive"[\s\S]*aria-label=\{`Excluir/)
})

test('convites pendentes, expirados e aceitos recentes usam o mesmo card com acoes por estado', () => {
  const teamSource = readSource('components/features/settings/TeamTab.tsx')
  const invitationHookSource = readSource('hooks/use-invitations.ts')
  const invitationCards = teamSource.match(
    /\{visibleInvitations\.map\(\(invitation\) => \{([\s\S]*?)\{visibleUsers\.map/,
  )?.[1]
  const invitationCardClass = invitationCards?.match(
    /<article\s+key=\{`invitation-\$\{invitation\.id\}`\}\s+className="([^"]+)"/,
  )?.[1]

  assert.match(
    teamSource,
    /const visibleInvitations = canManageUsers[\s\S]*invitations\.filter\(\(invitation\) => \{[\s\S]*invitation\.used_at && Date\.parse\(invitation\.used_at\) < recentAcceptedCutoff/,
  )
  assert.match(teamSource, /const recentAcceptedCutoff = invitationsUpdatedAt - 30 \* 24 \* 60 \* 60 \* 1000/)
  assert.match(teamSource, /useInvitations\(\{ enabled: canManageUsers \}\)/)
  assert.match(
    invitationHookSource,
    /enabled:\s*!!organizationId && enabled/,
  )
  assert.ok(invitationCardClass)
  assert.match(invitationCardClass, /min-h-\[180px\]/)
  assert.match(invitationCardClass, /bg-\[var\(--app-surface-soft\)\]/)
  assert.doesNotMatch(invitationCardClass, /\bborder(?:-|\b)/)
  assert.ok(invitationCards)
  assert.match(invitationCards, /const isAccepted = Boolean\(invitation\.used_at\)/)
  assert.match(invitationCards, /const isExpired = !isAccepted && invitation\.is_expired === true/)
  assert.match(invitationCards, /isAccepted \? 'Aceito' : isExpired \? 'Expirado' : 'Pendente'/)
  assert.match(invitationCards, /isExpired \? 'Prazo expirado' : 'Aguardando aceite'/)
  assert.match(invitationCards, /canManageAdminRole && !isAccepted && !isExpired/)
  assert.match(invitationCards, /canManageInvitation && !isAccepted/)
  assert.match(invitationCards, /isExpired \? 'Renovar' : 'Reenviar'/)
  assert.match(invitationCards, /Cancelar convite para/)
  assert.doesNotMatch(invitationCards, /<Switch/)
  assert.match(invitationCards, /Perfil do convite para/)
  assert.match(invitationCards, /updateInvitation\.mutate\(\{[\s\S]*id: invitation\.id,[\s\S]*role:/)
  assert.match(invitationHookSource, /getInvitationEmailLabel\(invitation\)/)
  assert.match(invitationHookSource, /Novo link válido por 7 dias\. O link anterior foi invalidado\./)
})

test('controles administrativos sao condicionados e a rota de permissoes tem gate', () => {
  const teamSource = readSource('components/features/settings/TeamTab.tsx')
  const settingsSource = readSource('components/features/settings/SettingsScreen.tsx')
  const permissionsPageSource = readSource('app/(protected)/settings/users/[id]/page.tsx')

  for (const source of [teamSource, settingsSource]) {
    assert.match(source, /isTenantContextForOrganization\(activeOrganizationId, tenantContext\)\s*\? tenantContext\?\.memberRole\s*:\s*undefined/)
    assert.doesNotMatch(source, /userOrganizations/)
  }
  assert.match(settingsSource, /const canAccessUsers =\s*canManageOrganization \|\|\s*hasPermission\("users_manage"\) \|\|\s*hasPermission\("permissions_manage"\)/)
  assert.match(settingsSource, /\{canManageRoles && activeOrganizationId && \(\s*<RolesTab/)
  assert.match(teamSource, /const canManageUsers = isAdmin \|\| hasPermission\('users_manage'\)/)
  assert.match(teamSource, /const canManagePermissions = isAdmin \|\| hasPermission\('permissions_manage'\)/)
  assert.match(teamSource, /const canManageAdminRole = isAdmin && canManagePermissions/)
  assert.match(teamSource, /useInvitations\(\{ enabled: canManageUsers \}\)/)
  assert.match(teamSource, /scope: canManageUsers \? 'management' : 'active'/)
  assert.match(teamSource, /canManageInvitation && !isAccepted/)
  assert.match(teamSource, /const canManageUserAccess =\s*canManageUsers &&/)
  assert.match(teamSource, /\{canManagePermissions && \(\s*<Button/)
  assert.match(permissionsPageSource, /<PermissionBoundary title="Permissoes do usuario" permission="permissions_manage">/)
})

test('busca de usuarios acompanha as abas e permissoes usam a largura padrao', () => {
  const settingsSource = readSource('components/features/settings/SettingsScreen.tsx')
  const teamSource = readSource('components/features/settings/TeamTab.tsx')
  const permissionsSource = readSource('components/features/settings/UserPermissionsScreen.tsx')

  assert.match(settingsSource, /const \[userSearch, setUserSearch\] = useState\(""\)/)
  assert.match(settingsSource, /aria-label="Pesquisar usuários e convites"/)
  assert.match(settingsSource, /<TeamTab search=\{userSearch\} \/>/)
  assert.match(teamSource, /normalizeSearchText\(search\)/)
  assert.match(teamSource, /Nenhum usuário ou convite encontrado para esta busca\./)
  assert.match(teamSource, /variant="secondary"[\s\S]*min-w-28[\s\S]*\{t\.common\.cancel\}/)
  assert.doesNotMatch(
    permissionsSource.match(/data-testid="user-permissions-scroller"[\s\S]*?className="([^"]+)"/)?.[1] ?? '',
    /max-w-|mx-auto/,
  )
})

test('mudancas de usuarios e aceite de convite atualizam a gestao em outros clientes', () => {
  const realtimeSource = readSource('contexts/BackendRealtimeBus.tsx')
  const backendTypesSource = readSource('apps/api/internal/realtime/types.go')
  const usersHandlerSource = readSource('apps/api/internal/users/handler.go')

  assert.match(backendTypesSource, /EventOrganizationUsersChanged\s*=\s*"organization\.users\.changed"/)
  assert.match(usersHandlerSource, /realtime\.EventOrganizationUsersChanged/)
  assert.match(realtimeSource, /event\.type === "organization\.users\.changed"/)
  assert.match(
    realtimeSource,
    /queryKey:\s*\["organization-users", organizationId\][\s\S]*queryKey:\s*\["invitations", organizationId\]/,
  )
})

test('refresh de acesso em realtime e coalescido por escopo e revogacao nao espera fila', () => {
  const realtimeSource = readSource('contexts/BackendRealtimeBus.tsx')
  const revokeBranchStart = realtimeSource.indexOf('if (change.revoked) {')
  const revokeBranchEnd = realtimeSource.indexOf('\n        return;', revokeBranchStart)
  const revokeBranch = realtimeSource.slice(revokeBranchStart, revokeBranchEnd)

  assert.doesNotMatch(realtimeSource, /accessRefreshQueueRef/)
  assert.match(
    realtimeSource,
    /createCoalescedAccessRefresh[\s\S]*while \(active && isCurrentScope\(\) && refreshRequested\)/,
  )
  assert.match(
    realtimeSource,
    /const scopeGeneration = \+\+accessScopeGenerationRef\.current[\s\S]*const isCurrentScope/,
  )
  assert.match(
    realtimeSource,
    /accessScopeGenerationRef\.current === scopeGeneration[\s\S]*accessRefresh\.dispose\(\)/,
  )
  assert.match(
    realtimeSource,
    /if \(\s*!isCurrentScope\(\) \|\| event\.organizationId !== organizationId\s*\)\s*return/,
  )
  assert.ok(revokeBranchStart >= 0 && revokeBranchEnd > revokeBranchStart)
  assert.ok(
    revokeBranch.indexOf('redirectToOrganizationSelection();')
      < revokeBranch.indexOf('Promise.allSettled'),
  )
  assert.match(
    realtimeSource,
    /event\.type === "realtime\.connected"[\s\S]*?requestAccessRefresh\(\)/,
  )
})

test('filtros historicos incluem inativos sem liberar novas atribuicoes', () => {
  const sharedFiltersSource = readSource('components/shared/SharedFilters.tsx')
  const propertiesSource = readSource('components/features/properties/PropertiesScreen.tsx')
  const createLeadSource = readSource('components/features/leads/CreateLeadDialog.tsx')
  const propertyFormSource = readSource('components/features/properties/PropertyFormScreen.tsx')

  assert.match(sharedFiltersSource, /scope:\s*["']filters["']/)
  assert.match(propertiesSource, /useUsers\(\{ scope: ["']filters["'] \}\)/)
  assert.match(sharedFiltersSource, /getUserFilterLabel/)
  assert.match(readSource('components/features/properties/list/PropertyFiltersPanel.tsx'), /getUserFilterLabel/)
  assert.doesNotMatch(createLeadSource, /scope:\s*'filters'/)
  assert.doesNotMatch(propertyFormSource, /scope:\s*'filters'/)
})

test('usuario sem organizacao ativa permanece autenticado na tela de selecao', () => {
  const authSource = readSource('contexts/AuthContext.tsx')
  const layoutSource = readSource('components/shared/layout/AppLayout.tsx')
  const appSource = readSource('apps/api/internal/app/routes.go')

  assert.match(appSource, /GET \/v1\/user-organizations", withActiveAuth\(/)
  assert.doesNotMatch(appSource, /GET \/v1\/user-organizations", withActiveAuthTenant\(/)
  assert.match(authSource, /if \(count === 0\)[\s\S]*setOrganization\(null\)[\s\S]*setTenantContext\(null\)/)
  assert.match(layoutSource, /new URLSearchParams\(\{ redirectTo \}\)[\s\S]*router\.replace\(`\/select-organization\?/)
})

test('membership removida nao reabre acesso por tenant, troca de organizacao ou helpers legados', () => {
  const tenantSource = readSource('apps/api/internal/tenant/repository.go')
  const meSource = readSource('apps/api/internal/me/repository.go')
  const migrationSource = readSource(
    'supabase/migrations/20260827000000_distinguish_disabled_and_deleted_organization_members.sql',
  )
  const ledUsersScopes = [...tenantSource.matchAll(/led_users as \(([\s\S]*?)\),\s*led_pipelines as \(/g)]
    .map((match) => match[1])

  assert.ok(ledUsersScopes.length >= 2)
  for (const ledUsersScope of ledUsersScopes) {
    assert.match(
      ledUsersScope,
      /join public\.organization_members om[\s\S]*?om\.organization_id = member\.organization_id[\s\S]*?om\.user_id = member\.user_id[\s\S]*?om\.is_active = true[\s\S]*?om\.deleted_at is null/,
    )
  }
  for (const [start, end] of [
    ['refreshCachedContext', 'storeCachedContext'],
    ['getActiveMembership', 'defaultActiveOrganizationID'],
    ['defaultActiveOrganizationID', 'getPermissions'],
  ]) {
    const startIndex = tenantSource.indexOf(`func (repo Repository) ${start}`)
    const endIndex = tenantSource.indexOf(`func (repo Repository) ${end}`)
    assert.ok(startIndex >= 0 && endIndex > startIndex)
    const section = tenantSource.slice(
      startIndex,
      endIndex,
    )
    assert.match(section, /om\.deleted_at is null/)
  }
  assert.equal((meSource.match(/deleted_at is null/g) ?? []).length, 2)
  assert.match(migrationSource, /private\.is_org_member\(session\.organization_id\)/)
  assert.match(
    migrationSource,
    /revoke insert, update, delete on table public\.user_roles from anon, authenticated;/,
  )
})
