import assert from "node:assert/strict";
import test from "node:test";

import { getWhatsAppIntegrationAccess } from "./whatsapp-integration";

const baseAccess = {
  hasModule: true,
  isSuperAdmin: false,
  memberRole: "user",
  isTeamLeader: false,
  hasViewPermission: false,
  hasManagePermission: false,
};

test("WhatsApp integration access fails closed when the module is disabled", () => {
  assert.deepEqual(
    getWhatsAppIntegrationAccess({
      ...baseAccess,
      hasModule: false,
      memberRole: "owner",
      isTeamLeader: true,
      hasViewPermission: true,
      hasManagePermission: true,
    }),
    {
      canViewStatuses: false,
      canManageOwnSessions: false,
      canSetNotificationSender: false,
    },
  );
});

test("organization admins can view status, manage their sessions and choose notification sender", () => {
  assert.deepEqual(
    getWhatsAppIntegrationAccess({ ...baseAccess, memberRole: "admin" }),
    {
      canViewStatuses: true,
      canManageOwnSessions: true,
      canSetNotificationSender: true,
    },
  );
});

test("team leaders can connect their own number and view their scoped statuses", () => {
  assert.deepEqual(
    getWhatsAppIntegrationAccess({
      ...baseAccess,
      isTeamLeader: true,
      hasViewPermission: true,
    }),
    {
      canViewStatuses: true,
      canManageOwnSessions: true,
      canSetNotificationSender: false,
    },
  );
});

test("a member without view permission can connect their own number but not see organization statuses", () => {
  assert.deepEqual(getWhatsAppIntegrationAccess({ ...baseAccess, isTeamLeader: true }), {
    canViewStatuses: false,
    canManageOwnSessions: true,
    canSetNotificationSender: false,
  });
});

test("WhatsApp manage permission implies view but never grants notification sender selection", () => {
  assert.deepEqual(
    getWhatsAppIntegrationAccess({
      ...baseAccess,
      hasManagePermission: true,
    }),
    {
      canViewStatuses: true,
      canManageOwnSessions: true,
      canSetNotificationSender: false,
    },
  );
});

test("ordinary members may connect their own number when the module is enabled", () => {
  assert.deepEqual(getWhatsAppIntegrationAccess(baseAccess), {
    canViewStatuses: false,
    canManageOwnSessions: true,
    canSetNotificationSender: false,
  });
});
