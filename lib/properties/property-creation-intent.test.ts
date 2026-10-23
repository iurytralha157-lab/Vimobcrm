import assert from "node:assert/strict";
import test from "node:test";
import { forgetPropertyCreationIntent, preparePropertyCreationIntent, readPropertyCreationIntent, propertyCreationRejectionCanReset, preserveConfirmedPropertyCreation } from "./property-creation-intent";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}
const firstKey = "11111111-1111-4111-8111-111111111111";
const nextKey = "22222222-2222-4222-8222-222222222222";
const body = { title: "Casa A", tipo_de_imovel: "Apartamento", tipo_de_negocio: "Venda" };

test("resposta perdida e reload reutilizam a mesma intenção e o corpo original", () => {
  const local = storage();
  const first = preparePropertyCreationIntent(local, "org-a:actor-a", body, () => firstKey);
  const retry = preparePropertyCreationIntent(local, "org-a:actor-a", { ...body, title: "Mudança posterior" }, () => nextKey);
  assert.deepEqual(retry, first);
  assert.deepEqual(readPropertyCreationIntent(local, "org-a:actor-a"), first);
  assert.equal(readPropertyCreationIntent(local, "org-b:actor-a"), null);
  assert.equal(readPropertyCreationIntent(local, "org-a:actor-b"), null);
});

test("a confirmação permite uma próxima intenção sem reaproveitar o imóvel anterior", () => {
  const local = storage();
  preparePropertyCreationIntent(local, "draft", body, () => firstKey);
  forgetPropertyCreationIntent(local, "draft");
  assert.equal(preparePropertyCreationIntent(local, "draft", { ...body, title: "Casa B" }, () => nextKey).key, nextKey);
});

test("registro corrompido não é substituído silenciosamente por um cadastro novo", () => {
  const local = storage();
  local.setItem("draft", "{broken");
  assert.throws(() => preparePropertyCreationIntent(local, "draft", body, () => firstKey), /confirmação pendente/);
  assert.equal(local.getItem("draft"), "{broken");
});

test("resposta perdida seguida de limite local, 403 ou 429 conserva a mesma intenção", () => {
  const local = storage();
  const original = preparePropertyCreationIntent(local, "draft", body, () => firstKey);
  for (const rejection of [{ clientRejected: true }, { status: 403 }, { status: 429 }]) {
    assert.equal(propertyCreationRejectionCanReset({ wasRetry: true, ...rejection }), false);
    assert.deepEqual(preparePropertyCreationIntent(local, "draft", body, () => nextKey), original);
  }
  assert.equal(propertyCreationRejectionCanReset({ wasRetry: false, status: 400 }), true);
  assert.equal(propertyCreationRejectionCanReset({ wasRetry: false, status: 408 }), false);
  assert.equal(propertyCreationRejectionCanReset({ wasRetry: false, status: 409, code: "property_idempotency_conflict" }), false);
  assert.equal(propertyCreationRejectionCanReset({ wasRetry: false, status: 500 }), false);
  assert.equal(propertyCreationRejectionCanReset({ wasRetry: true, status: 410, code: "property_creation_resource_removed" }), true);
  assert.equal(propertyCreationRejectionCanReset({ wasRetry: true, status: 404 }), false);
});

test("falha ao guardar o ID confirmado conserva a intenção para replay depois do reload", () => {
  const local = storage();
  const intent = preparePropertyCreationIntent(local, "intent", body, () => firstKey);
  const failingStorage = { ...local, setItem: () => { throw new Error("quota"); } };
  assert.throws(() => preserveConfirmedPropertyCreation(failingStorage, "intent", "receipt", { id: "created", organizationId: "org" }), /quota/);
  assert.deepEqual(readPropertyCreationIntent(local, "intent"), intent);
  preserveConfirmedPropertyCreation(local, "intent", "receipt", { id: "created", organizationId: "org" });
  assert.equal(readPropertyCreationIntent(local, "intent"), null);
  assert.equal(JSON.parse(local.getItem("receipt")!).id, "created");
});

test("erro local após possível commit conserva a primeira chave e o recibo confirmado", () => {
  for (const code of ["property_action_scope_changed", "api_request_identity_changed"]) {
    const local = storage();
    const original = preparePropertyCreationIntent(local, "intent", body, () => firstKey);
    local.setItem("receipt", JSON.stringify({ id: "committed-property", organizationId: "org-a" }));
    const receipt = local.getItem("receipt");
    // A local fence can reject after the response or a callback. Neither its
    // 409 nor a client-side rejection marker proves that the POST was rejected.
    for (const clientRejected of [false, true]) {
      const reset = propertyCreationRejectionCanReset({ wasRetry: false, status: 409, code, clientRejected });
      if (reset) forgetPropertyCreationIntent(local, "intent");
      assert.equal(reset, false);
      const retry = preparePropertyCreationIntent(local, "intent", { ...body, title: "Other body" }, () => nextKey);
      assert.deepEqual(retry, original);
      assert.equal(local.getItem("receipt"), receipt);
    }
  }
});
