import {
  isPrivateIP,
  normalizeDurableWhatsAppReservation,
  processEvent,
  replyWinsDelayWindow,
} from "./automation-runtime.ts";
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

Deno.test("recorded inbound replies reach waiting follow-ups but do not start new automations", async () => {
  const calls: string[] = [];
  const event = {
    id: "00000000-0000-4000-8000-000000000001",
    organization_id: "00000000-0000-4000-8000-000000000002",
    event_type: "message_received",
    lead_id: "00000000-0000-4000-8000-000000000003",
    conversation_id: "00000000-0000-4000-8000-000000000004",
    payload: {
      message_id: "00000000-0000-4000-8000-000000000005",
      conversation_id: "00000000-0000-4000-8000-000000000004",
      occurred_at: "2026-10-02T12:00:00Z",
      message_type: "text",
      content: "Resposta do cliente",
    },
    attempts: 1,
  };
  const makeQuery = (table: string, state: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      ilike: () => query,
      limit: async () => ({ data: [{}], error: null }),
      maybeSingle: async () => ({
        data: table === "whatsapp_messages" ? { capture_state: state } : null,
        error: null,
      }),
    };
    return query;
  };
  for (const state of ["recorded", "captured", "suppressed"]) {
    calls.length = 0;
    const client = {
      from(table: string) {
        calls.push(`from:${table}`);
        if (table === "organization_modules" || table === "whatsapp_messages" || table === "leads") {
          return makeQuery(table, state);
        }
        throw new Error(`unexpected table: ${table}`);
      },
      async rpc(name: string) {
        calls.push(`rpc:${name}`);
        return { data: { ok: true }, error: null };
      },
    } as unknown as Parameters<typeof processEvent>[0];
    const candidate = state === "captured"
      ? { ...event, aggregate_id: event.payload.message_id, payload: { ...event.payload, message_id: undefined } }
      : event;
    await processEvent(client, candidate);
    if (calls.includes("rpc:process_automation_inbound_message") !== (state !== "suppressed")) {
      throw new Error(`${state} did not apply the expected reply-handling gate`);
    }
    if (calls.includes("from:leads") !== (state === "captured")) {
      throw new Error(`${state} did not separate reply handling from new automation startup`);
    }
  }
});
