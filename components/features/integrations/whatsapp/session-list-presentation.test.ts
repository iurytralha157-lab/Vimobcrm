import assert from "node:assert/strict";
import test from "node:test";

import type { WhatsAppSession, WhatsAppSessionStatusSummary } from "@/lib/api/whatsapp";
import { getUnifiedWhatsAppStatusRows } from "@/components/features/integrations/whatsapp/session-list-presentation";

function statusRow(id: string, ownerId: string): WhatsAppSessionStatusSummary {
  return {
    id,
    display_name: `Conexão ${id}`,
    status: "connected",
    phone_number: null,
    profile_name: null,
    last_connected_at: null,
    updated_at: "2026-10-13T12:00:00Z",
    owner: { id: ownerId, name: `Usuário ${ownerId}`, avatar_url: "https://example.com/crm-avatar.png" },
    capabilities: { can_manage: true, can_set_notification_sender: false },
  };
}

function session(id: string, ownerId: string): WhatsAppSession {
  return {
    id,
    organization_id: "organization-a",
    owner_user_id: ownerId,
    instance_name: `instance-${id}`,
    display_name: `Compartilhada ${id}`,
    instance_id: null,
    status: "offline",
    phone_number: "+5511999990000",
    profile_name: "Perfil do WhatsApp",
    profile_picture: "https://example.com/whatsapp-profile.png",
    is_active: true,
    created_at: "2026-10-12T12:00:00Z",
    updated_at: "2026-10-13T12:00:00Z",
    owner: { id: ownerId, name: `Dono ${ownerId}`, email: "owner@example.com" },
  };
}

test("status rows remain authoritative over shared copies with the same session ID", () => {
  const authoritative = statusRow("same", "owner-a");
  const conflicting = session("same", "owner-b");
  const result = getUnifiedWhatsAppStatusRows([authoritative], [conflicting]);

  assert.equal(result.length, 1);
  assert.equal(result[0], authoritative);
  assert.equal(result[0].status, "connected");
  assert.equal(result[0].owner.avatar_url, authoritative.owner.avatar_url);
  assert.equal(result[0].capabilities.can_manage, true);
});

test("additional sessions stay read only and keep unknown provider states without using WhatsApp profile as CRM identity", () => {
  const additional = { ...session("shared", "owner-a"), owner: undefined, status: "new_provider_state" };
  const [result] = getUnifiedWhatsAppStatusRows([], [additional]);

  assert.equal(result.status, "new_provider_state");
  assert.equal(result.phone_number, additional.phone_number);
  assert.deepEqual(result.capabilities, { can_manage: false, can_set_notification_sender: false });
  assert.deepEqual(result.owner, { id: "owner-a", name: "Usuário", avatar_url: null });
  assert.notEqual(result.owner.name, additional.profile_name);
  assert.notEqual(result.owner.avatar_url, additional.profile_picture);
});

test("viewer sessions come first with stable order while multiple sessions from the same owner remain visible", () => {
  const statuses = [statusRow("other-1", "other"), statusRow("own-1", "viewer"), statusRow("other-2", "other")];
  const additional = [session("own-2", "viewer"), session("shared", "other")];
  const originalStatuses = structuredClone(statuses);
  const originalAdditional = structuredClone(additional);

  assert.deepEqual(
    getUnifiedWhatsAppStatusRows(statuses, additional, "viewer").map((row) => row.id),
    ["own-1", "own-2", "other-1", "other-2", "shared"],
  );
  assert.deepEqual(statuses, originalStatuses);
  assert.deepEqual(additional, originalAdditional);
});

test("deduplication uses session IDs and preserves original order when no viewer is provided", () => {
  const original = statusRow("first", "owner-a");
  const duplicate = { ...original, status: "offline" };
  const shared = session("shared", "owner-a");
  const sharedDuplicate = { ...shared, display_name: "Outra cópia" };
  const result = getUnifiedWhatsAppStatusRows([original, duplicate], [shared, sharedDuplicate]);

  assert.deepEqual(result.map((row) => row.id), ["first", "shared"]);
  assert.equal(result[0], original);
  assert.equal(result[1].display_name, shared.display_name);
});
