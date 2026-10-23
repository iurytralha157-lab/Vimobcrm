import assert from "node:assert/strict";
import test from "node:test";
import { persistProviderReaction, providerReactionActor } from "./provider-reaction";

const reaction = { messageId: "reaction-1", reactionToMessageId: "target-1", reactionEmoji: "👍", senderJid: "5511998880001@s.whatsapp.net", senderName: "Synthetic", remoteJid: "5511998880001@s.whatsapp.net", fromMe: false, sentAt: "2026-10-11T18:00:00Z" };
const scope = { organizationId: "org-a", sessionId: "session-a", sessionPhone: "5511998880002" };
const provenance = { inboxEventKey: "event-1", ingressSequence: 17, executionId: "af800000-0000-4000-8000-000000000001" };
test("Edge reacts through one target-scoped transaction with immutable ingress", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: { outcome: "applied" }, error: null }; } };
  assert.equal(await persistProviderReaction(client, scope, reaction, provenance), "applied");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "apply_whatsapp_provider_reaction");
  assert.equal(calls[0].args.p_target_provider_message_id, "target-1");
  assert.equal(calls[0].args.p_processing_epoch, 0);
  assert.equal(calls[0].args.p_ingress_sequence, 17);
  assert.equal(calls[0].args.p_organization_id, "org-a");
  assert.equal(calls[0].args.p_execution_id, provenance.executionId);
  await assert.rejects(persistProviderReaction(client, scope, reaction, null), /provenance_missing/);
  await assert.rejects(persistProviderReaction(client, scope, { ...reaction, providerMessageIdSynthetic: true }, provenance), /provider_identity_missing/);
  await assert.rejects(persistProviderReaction(client, scope, reaction, { ...provenance, executionId: null }), /execution_provenance_missing/);
  assert.equal(calls.length, 1);
});
test("outbound reaction never attributes its actor to the remote contact", () => {
  assert.equal(providerReactionActor({ ...reaction, fromMe: true, senderJid: null }, scope.sessionPhone), "5511998880002@s.whatsapp.net");
  assert.throws(() => providerReactionActor({ ...reaction, fromMe: true, senderJid: null }, null), /self_identity_missing/);
});
