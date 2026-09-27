import assert from "node:assert/strict";
import test from "node:test";
import { assertWhatsAppCallMediaDestination } from "./whatsapp-call-media-destination.ts";

const productionHost = "evogo.vettercompany.com.br";
const canaryHost = "evogo-canary.vettercompany.com.br";

test("legacy production host and additive canary host are both accepted", () => {
  assert.doesNotThrow(() => assertWhatsAppCallMediaDestination(
    `wss://${productionHost}/call/media?token=production-ticket`,
    productionHost,
    ` ${canaryHost.toUpperCase()} `,
  ));
  assert.doesNotThrow(() => assertWhatsAppCallMediaDestination(
    `wss://${canaryHost}/call/media?token=canary-ticket`,
    productionHost,
    ` ${canaryHost.toUpperCase()} `,
  ));
  assert.doesNotThrow(() => assertWhatsAppCallMediaDestination(
    `wss://${productionHost}/call/media?token=production-ticket`,
  ));
});

test("media ticket destination rejects unknown hosts and weakened URL shapes", () => {
  for (const url of [
    "wss://attacker.example/call/media?token=ticket",
    `ws://${canaryHost}/call/media?token=ticket`,
    `wss://${canaryHost}:8443/call/media?token=ticket`,
    `wss://user@${canaryHost}/call/media?token=ticket`,
    `wss://${canaryHost}/other/call/media?token=ticket`,
    `wss://${canaryHost}/call/media?token=ticket&other=1`,
    `wss://${canaryHost}/call/media?token=ticket&token=again`,
    `wss://${canaryHost}/call/media?token=`,
    `wss://${canaryHost}/call/media?token=ticket#fragment`,
  ]) {
    assert.throws(
      () => assertWhatsAppCallMediaDestination(url, productionHost, canaryHost),
      /Destino de áudio não autorizado/,
      url,
    );
  }
});
