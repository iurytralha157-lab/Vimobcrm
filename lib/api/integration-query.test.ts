import assert from "node:assert/strict";
import test from "node:test";
import {
  getIntegrationQueryErrorMessage,
  shouldRetryIntegrationQuery,
} from "./integration-query";

const messages = {
  moduleUnavailable: "Módulo desabilitado.",
  permissionDenied: "Sem permissão.",
  loadFailed: "Falha transitória.",
};

test("explica module_unavailable sem transformar a regra de acesso em falha genérica", () => {
  assert.equal(
    getIntegrationQueryErrorMessage(
      { code: "module_unavailable", status: 403 },
      messages,
    ),
    messages.moduleUnavailable,
  );
});

test("distingue falta de permissão de falha transitória", () => {
  assert.equal(
    getIntegrationQueryErrorMessage(
      { code: "permission_denied", status: 403 },
      messages,
    ),
    messages.permissionDenied,
  );
  assert.equal(
    getIntegrationQueryErrorMessage(
      { code: "api_unavailable", status: 503 },
      messages,
    ),
    messages.loadFailed,
  );
});

test("não repete erros 4xx e limita tentativas de falhas transitórias", () => {
  assert.equal(
    shouldRetryIntegrationQuery(0, { code: "module_unavailable", status: 403 }),
    false,
  );
  assert.equal(
    shouldRetryIntegrationQuery(0, { code: "api_unavailable", status: 503 }),
    true,
  );
  assert.equal(
    shouldRetryIntegrationQuery(2, { code: "api_unavailable", status: 503 }),
    false,
  );
});
