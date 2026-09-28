type HasPermission = (permission: string) => boolean

export function canManagePipeline(hasPermission: HasPermission) {
  return hasPermission('pipeline_manage')
}

export function canEditStageOperationalRules(hasPermission: HasPermission) {
  return canManagePipeline(hasPermission) || hasPermission('automations_manage')
}

export function canViewStageAutomations(
  hasPermission: HasPermission,
  hasAutomationsModule: boolean,
) {
  return hasAutomationsModule && hasPermission('automations_view')
}

export function canManageStageAutomations(
  hasPermission: HasPermission,
  hasAutomationsModule: boolean,
) {
  return canViewStageAutomations(hasPermission, hasAutomationsModule)
    && hasPermission('automations_manage')
}
