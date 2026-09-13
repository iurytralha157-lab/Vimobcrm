export type PublicAPIOrganizationBilling = {
  organizationId: unknown;
  subscriptionStatus: unknown;
  subscriptionType: unknown;
  trialEndsAt: unknown;
  billingGraceUntil: unknown;
};

function normalizedBillingValue(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function timestampIsActive(value: unknown, now: number) {
  if (typeof value !== "string" || value.trim() === "") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && now < timestamp;
}

/** Mirrors tenant.Context.HasBillingAccessAt for organization API keys. */
export function publicAPIBillingHasAccess(
  context: PublicAPIOrganizationBilling,
  now: number,
) {
  if (
    typeof context.organizationId !== "string" ||
    context.organizationId.trim() === ""
  ) return false;

  const subscriptionStatus = normalizedBillingValue(context.subscriptionStatus);
  const subscriptionType = normalizedBillingValue(context.subscriptionType);

  switch (subscriptionType) {
    case "free":
      return subscriptionStatus === "active";
    case "trial":
      return subscriptionStatus === "trial" &&
        timestampIsActive(context.trialEndsAt, now);
    case "paid":
      if (subscriptionStatus === "active") return true;
      return ["overdue", "past_due"].includes(subscriptionStatus) &&
        timestampIsActive(context.billingGraceUntil, now);
    default:
      return false;
  }
}
