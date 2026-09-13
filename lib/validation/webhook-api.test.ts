import assert from "node:assert/strict";
import test from "node:test";

import {
  publicAPIIdempotencyKeySchema,
  publicAPILeadInputSchema,
  webhookCreateInputSchema,
  webhookUpdateInputSchema,
} from "./auxiliary";

test("webhook de saida exige HTTPS e eventos permitidos sem duplicacao", () => {
  const valid = {
    name: "Eventos de lead",
    type: "outgoing" as const,
    webhook_url: "https://integrador.example.com/vimob",
    trigger_events: ["lead.created", "lead.reentered"],
  };

  assert.equal(webhookCreateInputSchema.safeParse(valid).success, true);
  assert.equal(
    webhookCreateInputSchema.safeParse({
      ...valid,
      webhook_url: "http://integrador.example.com/vimob",
    }).success,
    false,
  );
  assert.equal(
    webhookCreateInputSchema.safeParse({
      ...valid,
      trigger_events: ["lead.updated"],
    }).success,
    false,
  );
  assert.equal(
    webhookCreateInputSchema.safeParse({
      ...valid,
      trigger_events: ["lead.created", "lead.created"],
    }).success,
    false,
  );
});

test("webhook de entrada e atualizacao nao misturam contratos de saida ou tipo", () => {
  assert.equal(
    webhookCreateInputSchema.safeParse({
      name: "Formulario externo",
      type: "incoming",
    }).success,
    true,
  );
  assert.equal(
    webhookCreateInputSchema.safeParse({
      name: "Formulario externo",
      type: "incoming",
      webhook_url: "https://integrador.example.com/vimob",
    }).success,
    false,
  );
  assert.equal(
    webhookUpdateInputSchema.safeParse({
      id: "10000000-0000-4000-8000-000000000001",
      type: "outgoing",
    }).success,
    false,
  );
  assert.equal(
    webhookCreateInputSchema.safeParse({
      name: "Formulario externo",
      type: "incoming",
      field_mapping: { ["x".repeat(121)]: "name" },
    }).success,
    false,
  );
});

test("contrato da API publica valida lead e chave de idempotencia", () => {
  assert.equal(
    publicAPILeadInputSchema.safeParse({
      name: "Joao Silva",
      phone: "+55 11 99999-9999",
      custom_fields: { faixa_de_preco: "ate 800 mil" },
    }).success,
    true,
  );
  assert.equal(
    publicAPILeadInputSchema.safeParse({
      name: "Joao Silva",
      phone: "123",
    }).success,
    false,
  );
  assert.equal(
    publicAPILeadInputSchema.safeParse({
      name: "Joao Silva",
      phone: "11999999999",
      custom_fields: { ["x".repeat(121)]: "valor" },
    }).success,
    false,
  );
  assert.equal(
    publicAPILeadInputSchema.safeParse({
      name: "Joao Silva",
      phone: "11999999999",
      arbitrary: true,
    }).success,
    false,
  );
  assert.equal(
    publicAPIIdempotencyKeySchema.safeParse("lead-external-123").success,
    true,
  );
  assert.equal(
    publicAPIIdempotencyKeySchema.safeParse("contains spaces").success,
    false,
  );
});
