import {
  isPrivateIP,
  normalizeDurableWhatsAppReservation,
  replyWinsDelayWindow,
} from "./automation-runtime.ts";
import { AutomationPhaseError, safeAutomationError } from "./automation-runtime-errors.ts";
import { AutomationStageCommandError } from "./automation-stage-command.ts";
import { evaluateAutomationCondition } from "../../../lib/automations/engine.ts";

Deno.test("runtime and preview share the reply classifier contract", () => {
  for (const [content, branch] of [
    ["pode ser", "true"],
    ["não quero", "false"],
    ["pode parar", "false"],
    ["não tem problema, pode ser", "true"],
    ["talvez", "unknown"],
  ] as const) {
    const result = evaluateAutomationCondition(
      { condition_type: "response_sentiment" },
      { execution: { reply_payload: { content } } },
    );
    if (result.branch !== branch) throw new Error(`${content}: expected ${branch}, got ${result.branch}`);
  }
});

Deno.test("reply inside the closed wait window wins the timeout race", () => {
  if (!replyWinsDelayWindow(1_000, 2_000, 2_000)) throw new Error("reply at deadline must win");
  if (!replyWinsDelayWindow(1_000, 2_000, 1_000)) throw new Error("reply at start must win");
});

Deno.test("reply outside the wait window cannot beat timeout", () => {
  if (replyWinsDelayWindow(1_000, 2_000, 999)) throw new Error("reply before wait must lose");
  if (replyWinsDelayWindow(1_000, 2_000, 2_001)) throw new Error("reply after deadline must lose");
});

Deno.test("invalid timestamps never resume a delay", () => {
  if (replyWinsDelayWindow(Number.NaN, 2_000, 1_500)) throw new Error("invalid timestamp must lose");
});

Deno.test("webhook network guard blocks private, reserved and mapped addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "100.64.0.1",
    "192.168.1.1",
    "198.51.100.8",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "0:0:0:0:0:ffff:c0a8:101",
    "2001:db8::1",
  ]) {
    if (!isPrivateIP(address)) throw new Error(`expected ${address} to be blocked`);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
    if (isPrivateIP(address)) throw new Error(`expected ${address} to be public`);
  }
});

Deno.test("DB-first WhatsApp replay continues from an existing sending reservation", () => {
  const normalized = normalizeDurableWhatsAppReservation({
    ok: false,
    execute: false,
    status: "sending",
  });
  if (normalized.execute !== true) {
    throw new Error("an idempotent DB-first replay must reach the enqueue RPC");
  }
});

Deno.test("outbox errors preserve the phase, a known domain reason and SQLSTATE", () => {
  const failure = new AutomationPhaseError("whatsapp_outbox_enqueue", {
    code: "23514",
    message: "automation_whatsapp_attendance_required",
    details: "Synthetic customer: customer@example.test",
    hint: "Bearer synthetic-credential",
  });
  const actual = safeAutomationError(failure);
  if (actual !== "whatsapp_outbox_enqueue:automation_whatsapp_attendance_required:23514") {
    throw new Error("unexpected outbox diagnostic");
  }
});

Deno.test("runtime errors never use untrusted messages, hints, details or nested causes", () => {
  const injected = "customer@example.test\nBearer synthetic-credential";
  for (const [failure, expected] of [
    [new AutomationPhaseError("whatsapp_resolve", { code: "PGRST202", message: injected }), "whatsapp_resolve:PGRST202"],
    [new AutomationPhaseError("whatsapp_media_download", { status: 404, message: injected }), "whatsapp_media_download:http_404"],
    [new AutomationPhaseError("whatsapp_reserve", injected), "whatsapp_reserve"],
    [{ code: "42501", message: injected, details: injected }, "automation_database_error:42501"],
    [new Error(injected, { cause: injected }), "runtime_failed"],
    [new Error("webhook_http_503"), "webhook_http_503"],
    [new Error(`webhook_http_503:${injected}`), "runtime_failed"],
    [new AutomationStageCommandError("automation_lease_changed", false), "automation_lease_changed"],
    [new AutomationStageCommandError("synthetic_personal_data", false), "automation_command_rejected"],
  ] as const) {
    if (safeAutomationError(failure) !== expected) throw new Error(`unexpected diagnostic for ${expected}`);
  }
});
