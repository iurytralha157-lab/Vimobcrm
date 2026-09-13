export const PROPERTY_SETTINGS_CONFLICT_CODE = "property_settings_conflict";

export const PROPERTY_SETTINGS_CONFLICT_MESSAGE =
  "As configurações de imóveis foram alteradas em outra sessão. Suas escolhas continuam na tela; recarregue os dados antes de tentar novamente.";

export function isPropertySettingsConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const details = error as { code?: unknown; status?: unknown };
  return (
    details.status === 409 && details.code === PROPERTY_SETTINGS_CONFLICT_CODE
  );
}
