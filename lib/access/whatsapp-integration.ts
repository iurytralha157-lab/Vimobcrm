import { canManageOrganization } from "@/lib/access/organization";

export type WhatsAppIntegrationAccessInput = {
  hasModule: boolean;
  isSuperAdmin?: boolean;
  memberRole?: string | null;
  isTeamLeader?: boolean;
  hasViewPermission: boolean;
  hasManagePermission: boolean;
};

export type WhatsAppIntegrationAccess = {
  canViewStatuses: boolean;
  canManageOwnSessions: boolean;
  canSetNotificationSender: boolean;
};

/**
 * Presentation guard for the dedicated WhatsApp integration page.
 * The API remains authoritative and reapplies the organization/team/self scope.
 */
export function getWhatsAppIntegrationAccess(
  input: WhatsAppIntegrationAccessInput,
): WhatsAppIntegrationAccess {
  if (!input.hasModule) {
    return {
      canViewStatuses: false,
      canManageOwnSessions: false,
      canSetNotificationSender: false,
    };
  }

  const isOrganizationAdmin = canManageOrganization({
    isSuperAdmin: input.isSuperAdmin,
    memberRole: input.memberRole,
  });
  // Every member of an organization with WhatsApp can connect and manage
  // their own number. Sharing a number has its own owner/role guard.
  const canManageOwnSessions = true;

  return {
    canViewStatuses:
      isOrganizationAdmin ||
      input.hasViewPermission ||
      input.hasManagePermission,
    canManageOwnSessions,
    canSetNotificationSender: isOrganizationAdmin,
  };
}
