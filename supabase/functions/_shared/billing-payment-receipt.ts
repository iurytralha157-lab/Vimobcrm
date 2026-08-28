const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PublicBillingPaymentReceiptReference = {
  number: string;
  verification_path: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Projects a privileged receipt row into the only fields that a checkout may
 * expose. The verification token is purpose-built as the capability for the
 * public receipt route; payer, tax and billing fields never leave the Edge
 * Function.
 */
export function publicBillingPaymentReceiptReference(
  value: unknown,
): PublicBillingPaymentReceiptReference | null {
  if (!isRecord(value)) return null;

  const number = typeof value.receipt_number === "string"
    ? value.receipt_number.trim()
    : "";
  const token = typeof value.verification_token === "string"
    ? value.verification_token.trim().toLowerCase()
    : "";

  if (!number || number.length > 100 || !UUID_PATTERN.test(token)) return null;

  return {
    number,
    verification_path: `/comprovantes/${token}`,
  };
}
