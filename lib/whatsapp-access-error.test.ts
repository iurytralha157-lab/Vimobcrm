import assert from "node:assert/strict";
import test from "node:test";

import { isWhatsAppAccessRevokedError } from "./whatsapp-access-error";

test("only the stable API code identifies a revoked WhatsApp number", () => {
  assert.equal(isWhatsAppAccessRevokedError({ code: "whatsapp_access_revoked", status: 403 }), true);
  assert.equal(isWhatsAppAccessRevokedError({ code: "permission_denied", status: 403 }), false);
  assert.equal(isWhatsAppAccessRevokedError(new Error("WhatsApp access revoked")), false);
});
