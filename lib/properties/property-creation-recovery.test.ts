import assert from "node:assert/strict";
import test from "node:test";
import { VimobAPIError } from "@/lib/api/vimob-error";
import { readConfirmedPropertyReceipt, verifyConfirmedPropertyRecovery } from "./property-creation-recovery";

const receipt = { id: "confirmed-property", organizationId: "original-org", actorId: "original-actor" };

test("confirmação local ausente permite início; confirmação inconsistente nunca vira ausência", () => {
  const scope = { actorId: "11111111-1111-4111-8111-111111111111", organizationId: "22222222-2222-4222-8222-222222222222" };
  const valid = { id: "33333333-3333-4333-8333-333333333333", organizationId: scope.organizationId };
  const read = (raw: string | null) => readConfirmedPropertyReceipt({ getItem: () => raw }, "actor-tenant-key", scope);
  assert.equal(read(null), null);
  assert.equal(read(JSON.stringify(valid))?.actorId, scope.actorId);
  assert.equal(read(JSON.stringify({ ...valid, actorId: scope.actorId }))?.id, valid.id);
  for (const value of ["{broken", "{}", JSON.stringify({ ...valid, id: "invalid" }),
    JSON.stringify({ ...valid, organizationId: "44444444-4444-4444-8444-444444444444" }),
    JSON.stringify({ ...valid, actorId: "another-actor" })]) {
    assert.throws(() => read(value), /recuperar o imóvel anterior/);
  }
  assert.throws(() => readConfirmedPropertyReceipt({ getItem: () => { throw new Error("quota"); } }, "key", scope), /recuperar/);
});

test("recuperação de imóvel confirmado confere ID e organização antes de abrir a edição", async () => {
  assert.equal(await verifyConfirmedPropertyRecovery(receipt, async () => ({
    id: receipt.id, organization_id: receipt.organizationId,
  })), "existing");
  for (const property of [{ id: "another-property", organization_id: receipt.organizationId },
    { id: receipt.id, organization_id: "another-org" }]) {
    await assert.rejects(verifyConfirmedPropertyRecovery(receipt, async () => property), /cadastro original/);
  }
});

test("apenas 410 explícito da recuperação autoriza liberar o ID excluído", async () => {
  const removed = new VimobAPIError("Excluído", { status: 410, code: "property_creation_resource_removed" });
  assert.equal(await verifyConfirmedPropertyRecovery(receipt, async () => { throw removed; }), "removed");
  for (const error of [new VimobAPIError("Não encontrado", { status: 404, code: "property_not_found" }),
    new VimobAPIError("Sem acesso", { status: 403, code: "forbidden" }),
    new VimobAPIError("Indisponível", { status: 410, code: "unrelated" }), new Error("timeout")]) {
    await assert.rejects(verifyConfirmedPropertyRecovery(receipt, async () => { throw error; }), candidate => candidate === error);
  }
});
