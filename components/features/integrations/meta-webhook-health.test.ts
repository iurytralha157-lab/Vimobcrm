import assert from "node:assert/strict";
import test from "node:test";

const healthModulePath = "./meta-webhook-health.ts";
const { getMetaWebhookFailureGuidance } = await import(healthModulePath);

test("orienta análise do app quando Meta restringe leads reais", () => {
  const guidance = getMetaWebhookFailureGuidance(
    "Meta Graph returned HTTP 400: (#3) Apps in dev mode should only access leads submitted from App special roles",
  );

  assert.match(guidance ?? "", /leads_retrieval/);
  assert.match(guidance ?? "", /análise do aplicativo/);
});

test("orienta reconexão quando a Meta recusa o objeto por permissão", () => {
  const guidance = getMetaWebhookFailureGuidance(
    "Unsupported get request. Object cannot be loaded due to missing permissions",
  );

  assert.match(guidance ?? "", /acesso a leads da página/);
  assert.match(guidance ?? "", /atualize a conexão/);
});

test("não inventa orientação para falha desconhecida", () => {
  assert.equal(getMetaWebhookFailureGuidance("upstream timeout"), null);
  assert.equal(getMetaWebhookFailureGuidance(null), null);
});
