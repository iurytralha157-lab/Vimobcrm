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
  const canManageOwnSessions =
    isOrganizationAdmin || input.hasManagePermission;

  return {
    canViewStatuses:
      isOrganizationAdmin ||
      input.hasViewPermission ||
      canManageOwnSessions,
    canManageOwnSessions,
    canSetNotificationSender: isOrganizationAdmin,
  };
}
