import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAIOutboxClientMessageId,
  buildAIResponseClaimId,
} from "./response-idempotency.ts";

const identity = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  conversationId: "33333333-3333-4333-8333-333333333333",
  providerMessageId: "3EB0A1B2C3D4E5F6",
};

test("response claim UUID is canonical, deterministic and tenant scoped", async () => {
  const first = await buildAIResponseClaimId(identity);
  const second = await buildAIResponseClaimId({ ...identity });

  assert.equal(first, second);
  assert.equal(first, "0d51262a-bca9-8b23-99d2-c4122941093b");
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );

  for (const changed of [
    { ...identity, organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    { ...identity, sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    { ...identity, conversationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    { ...identity, providerMessageId: "another-provider-message" },
  ]) {
    assert.notEqual(await buildAIResponseClaimId(changed), first);
  }
});

test("outbox IDs are deterministic per response chunk", async () => {
  const claimId = await buildAIResponseClaimId(identity);
  assert.equal(
    buildAIOutboxClientMessageId(claimId, 0),
    `jhenny-${claimId}-01`,
  );
  assert.equal(
    buildAIOutboxClientMessageId(claimId, 1),
    `jhenny-${claimId}-02`,
  );
  assert.throws(() => buildAIOutboxClientMessageId(claimId, -1));
});
