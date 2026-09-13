export type GoogleScheduleBillingSnapshot = {
  subscription_status?: unknown;
  subscription_type?: unknown;
  trial_ends_at?: unknown;
  billing_grace_until?: unknown;
};

export type GoogleScheduleCapabilitySnapshot = {
  organizationActive: boolean;
  moduleEnabled: boolean;
  billing: GoogleScheduleBillingSnapshot;
  isSuperAdmin: boolean;
  activeMembership: boolean;
  membershipRole?: unknown;
  permissionOverride?: boolean | null;
  defaultScheduleManage: boolean;
};

export type GoogleScheduleCapability =
  | { allowed: true; reason: null; status: 200 }
  | {
    allowed: false;
    reason:
      | "ORGANIZATION_INACTIVE"
      | "AGENDA_MODULE_DISABLED"
      | "BILLING_ACCESS_REQUIRED"
      | "MEMBERSHIP_REQUIRED"
      | "SCHEDULE_MANAGE_REQUIRED";
    status: 402 | 403;
  };

function normalized(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function futureTimestamp(value: unknown, now: Date) {
  if (typeof value !== "string" || !value.trim()) return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && now.getTime() < timestamp.getTime();
}

/** Mirrors tenant.Context.HasBillingAccessAt in the Go API. */
export function hasGoogleScheduleBillingAccess(
  snapshot: GoogleScheduleBillingSnapshot,
  now = new Date(),
) {
  const subscriptionStatus = normalized(snapshot.subscription_status);
  const subscriptionType = normalized(snapshot.subscription_type);

  if (subscriptionType === "free") return subscriptionStatus === "active";
  if (subscriptionType === "trial") {
    return subscriptionStatus === "trial" && futureTimestamp(snapshot.trial_ends_at, now);
  }
  if (subscriptionType === "paid") {
    if (subscriptionStatus === "active") return true;
    return ["overdue", "past_due"].includes(subscriptionStatus)
      && futureTimestamp(snapshot.billing_grace_until, now);
  }
  return false;
}

/**
 * Mirrors the Agenda route gates in the Go API: active organization, billing,
 * enabled module and effective `schedule_manage` permission. The explicit user
 * override is final for ordinary members, matching permissions.Resolve.
 */
export function resolveGoogleScheduleCapability(
  snapshot: GoogleScheduleCapabilitySnapshot,
  now = new Date(),
): GoogleScheduleCapability {
  if (!snapshot.organizationActive) {
    return { allowed: false, reason: "ORGANIZATION_INACTIVE", status: 403 };
  }
  if (!snapshot.moduleEnabled) {
    return { allowed: false, reason: "AGENDA_MODULE_DISABLED", status: 403 };
  }
  if (!snapshot.isSuperAdmin && !hasGoogleScheduleBillingAccess(snapshot.billing, now)) {
    return { allowed: false, reason: "BILLING_ACCESS_REQUIRED", status: 402 };
  }
  if (snapshot.isSuperAdmin) return { allowed: true, reason: null, status: 200 };
  if (!snapshot.activeMembership) {
    return { allowed: false, reason: "MEMBERSHIP_REQUIRED", status: 403 };
  }

  const membershipRole = normalized(snapshot.membershipRole);
  if (membershipRole === "owner" || membershipRole === "admin") {
    return { allowed: true, reason: null, status: 200 };
  }
  if (snapshot.permissionOverride === false) {
    return { allowed: false, reason: "SCHEDULE_MANAGE_REQUIRED", status: 403 };
  }
  if (snapshot.permissionOverride === true || snapshot.defaultScheduleManage) {
    return { allowed: true, reason: null, status: 200 };
  }
  return { allowed: false, reason: "SCHEDULE_MANAGE_REQUIRED", status: 403 };
}
