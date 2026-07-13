import {
  isPrivateIP,
  normalizeDurableWhatsAppReservation,
  replyWinsDelayWindow,
} from "./automation-runtime.ts";

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
