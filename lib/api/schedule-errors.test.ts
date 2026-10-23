import assert from "node:assert/strict";
import test from "node:test";
import { getScheduleMutationErrorMessage } from "./schedule-errors";

test("Google disconnect conflict asks to wait without replacing the edit baseline", () => {
  const error = Object.assign(new Error("raw backend conflict"), { code: "google_calendar_disconnecting", status: 409 });
  assert.match(getScheduleMutationErrorMessage(error), /Aguarde e tente salvar novamente/);
  assert.doesNotMatch(getScheduleMutationErrorMessage(error), /Atualize/);
});

test("stale event or reused command asks to inspect current data before retrying", () => {
  const error = Object.assign(new Error("Esta atividade mudou ou este comando ja foi usado."), { code: "schedule_conflict", status: 409 });
  assert.match(getScheduleMutationErrorMessage(error), /Atualize a agenda e confira os dados/);
  assert.doesNotMatch(getScheduleMutationErrorMessage(error), /desconectada/);
});

test("unrelated and technical errors retain the shared public error policy", () => {
  const error = Object.assign(new Error("internal_error: private SQL details"), { code: "google_calendar_disconnecting", status: 500 });
  assert.doesNotMatch(getScheduleMutationErrorMessage(error), /SQL|internal_error|desconectada/);
  assert.match(getScheduleMutationErrorMessage({ message: "Falha de permissão", status: 403, code: "permission_denied" }), /permissão/);
});
