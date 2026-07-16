export type TenantQueryAccessContext = {
  userId?: string | null
  organizationId?: string | null
  memberRole?: string | null
  permissions?: readonly string[] | null
  enabledModules?: readonly string[] | null
  isTeamLeader?: boolean | null
  ledTeamIds?: readonly string[] | null
  ledUserIds?: readonly string[] | null
  ledPipelineIds?: readonly string[] | null
  isSuperAdmin?: boolean | null
  impersonatedOrganizationId?: string | null
}

const missingValue = 'none'

const stableList = (values?: readonly string[] | null) =>
  [...(values ?? [])].sort().join(',')

export function createTenantQueryAccessSignature(context: TenantQueryAccessContext): string {
  return [
    `user:${context.userId ?? missingValue}`,
    `organization:${context.organizationId ?? missingValue}`,
    `member:${context.memberRole ?? missingValue}`,
    `permissions:${stableList(context.permissions)}`,
    `modules:${stableList(context.enabledModules)}`,
    `team-leader:${context.isTeamLeader ? 'yes' : 'no'}`,
    `teams:${stableList(context.ledTeamIds)}`,
    `users:${stableList(context.ledUserIds)}`,
    `pipelines:${stableList(context.ledPipelineIds)}`,
    `super-admin:${context.isSuperAdmin ? 'yes' : 'no'}`,
    `impersonated:${context.impersonatedOrganizationId ?? missingValue}`,
  ].join('|')
}
