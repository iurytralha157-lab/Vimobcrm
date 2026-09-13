export function getPropertyChargeFieldAccess(input: {
  isExempt: boolean;
  canManageMetadata: boolean;
}) {
  return {
    amountDisabled: input.isExempt,
    showExemptionControl: input.canManageMetadata,
    showManagedExemptionNotice: input.isExempt && !input.canManageMetadata,
  };
}

export function getPropertyFinancingModeAccess(input: {
  financingMode: string;
  canManageMetadata: boolean;
}) {
  const hasManagerOnlyMode = input.financingMode === "mcmv";

  return {
    selectDisabled: hasManagerOnlyMode && !input.canManageMetadata,
    showMcmvOption: input.canManageMetadata || hasManagerOnlyMode,
    showManagedModeNotice: hasManagerOnlyMode && !input.canManageMetadata,
  };
}
