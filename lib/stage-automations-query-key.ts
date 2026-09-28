export function stageAutomationsQueryKey(
  stageId: string | undefined,
  organizationId: string | null | undefined,
  userId: string | null | undefined,
  accessSignature: string,
) {
  return ['stage-automations', stageId, organizationId, userId, accessSignature] as const
}
