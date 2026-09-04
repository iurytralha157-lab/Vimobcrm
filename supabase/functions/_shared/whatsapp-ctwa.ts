export type WhatsAppCTWAConfirmationMethod =
  | "entry_point_ctwa_ad"
  | "evolution_ctwa_clid_v1";

export type WhatsAppCTWAConfirmationInput = {
  fromMe?: boolean;
  isGroup?: boolean;
  providerMessageIdSynthetic?: boolean;
  entryPointConversionSource?: unknown;
  explicitSourceType?: unknown;
  ctwaClid?: unknown;
  showAdAttribution?: unknown;
  showAdAttributionInvalid?: unknown;
  proofConflict?: unknown;
};

const normalizedText = (value: unknown) => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
};

export function validWhatsAppCTWAClickIdentifier(value: unknown) {
  if (typeof value !== "string") return false;
  const clickId = value.trim();
  if (!clickId || /[\u0000-\u001f\u007f]/u.test(clickId)) return false;
  const size = new TextEncoder().encode(clickId).byteLength;
  return size >= 8 && size <= 512;
}

/**
 * Confirms that the current inbound message originated from a Meta
 * Click-to-WhatsApp ad. Campaign text, URLs and inferred source types are
 * deliberately excluded from this trust decision.
 */
export function whatsappCTWAConfirmationMethod(
  input: WhatsAppCTWAConfirmationInput,
): WhatsAppCTWAConfirmationMethod | null {
  if (input.fromMe || input.isGroup) return null;
  if (
    input.proofConflict !== undefined
    && input.proofConflict !== null
    && input.proofConflict !== false
  ) {
    return null;
  }

  const entryPoint = normalizedText(input.entryPointConversionSource).toLowerCase();
  const explicitSourceType = normalizedText(input.explicitSourceType).toLowerCase();
  if (
    input.showAdAttributionInvalid !== undefined
    && input.showAdAttributionInvalid !== null
    && input.showAdAttributionInvalid !== false
  ) {
    return null;
  }
  if (entryPoint) {
    return entryPoint === "ctwa_ad"
      && (!explicitSourceType || explicitSourceType === "ad")
      ? "entry_point_ctwa_ad"
      : null;
  }

  // Edge normalizers persist this provider value as a JSON boolean. Keeping
  // this helper strict makes an unnormalized string/number fail closed and
  // matches the database contract exactly.
  const showAdAttributionAllowed = input.showAdAttribution === undefined
    || input.showAdAttribution === null
    || input.showAdAttribution === true;
  if (
    input.providerMessageIdSynthetic === false
    && explicitSourceType === "ad"
    && validWhatsAppCTWAClickIdentifier(input.ctwaClid)
    && showAdAttributionAllowed
  ) {
    return "evolution_ctwa_clid_v1";
  }

  return null;
}
