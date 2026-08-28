import assert from "node:assert/strict";
import test from "node:test";

import { canSubscribeToWhatsAppRealtime } from "./whatsapp-realtime";

const allowed = {
  enabled: true,
  modulesLoading: false,
  permissionsLoading: false,
  hasWhatsAppModule: true,
  hasWhatsAppViewPermission: true,
};

test("allows Realtime only after module and permission resolve positively", () => {
  assert.equal(canSubscribeToWhatsAppRealtime(allowed), true);
});

test("fails closed while module or permission context is unresolved", () => {
  assert.equal(canSubscribeToWhatsAppRealtime({ ...allowed, modulesLoading: true }), false);
  assert.equal(canSubscribeToWhatsAppRealtime({ ...allowed, permissionsLoading: true }), false);
});

test("denies disabled module, missing whatsapp_view, and disabled consumers", () => {
  assert.equal(canSubscribeToWhatsAppRealtime({ ...allowed, hasWhatsAppModule: false }), false);
  assert.equal(canSubscribeToWhatsAppRealtime({ ...allowed, hasWhatsAppViewPermission: false }), false);
  assert.equal(canSubscribeToWhatsAppRealtime({ ...allowed, enabled: false }), false);
});
