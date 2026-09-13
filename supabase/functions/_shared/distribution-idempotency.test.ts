import { buildDistributionIdempotencyKey } from "./distribution-idempotency.ts";

Deno.test("distribution key is stable across object key ordering", async () => {
  const first = await buildDistributionIdempotencyKey("webhook-reentry", {
    leadId: "lead-1",
    event: { id: "event-1", payload: { phone: "5511999999999", name: "Lead" } },
  });
  const retry = await buildDistributionIdempotencyKey("webhook-reentry", {
    event: { payload: { name: "Lead", phone: "5511999999999" }, id: "event-1" },
    leadId: "lead-1",
  });

  if (first !== retry) throw new Error("retry key changed");
  if (first.length > 200) throw new Error("key exceeds distributor contract");
});

Deno.test("different distribution state produces a different key", async () => {
  const first = await buildDistributionIdempotencyKey("pool-timeout", {
    leadId: "lead-1",
    assignmentAt: "2026-09-08T12:00:00.000Z",
    redistributionCount: 0,
  });
  const next = await buildDistributionIdempotencyKey("pool-timeout", {
    leadId: "lead-1",
    assignmentAt: "2026-09-08T12:30:00.000Z",
    redistributionCount: 1,
  });

  if (first === next) throw new Error("distinct distribution states collided");
});

Deno.test("identical payload reentries stay distinct when entry event IDs differ", async () => {
  const first = await buildDistributionIdempotencyKey("public-api-reentry", {
    reentryEventId: "10000000-0000-4000-8000-000000000001",
  });
  const second = await buildDistributionIdempotencyKey("public-api-reentry", {
    reentryEventId: "10000000-0000-4000-8000-000000000002",
  });
  const replay = await buildDistributionIdempotencyKey("public-api-reentry", {
    reentryEventId: "10000000-0000-4000-8000-000000000001",
  });

  if (first === second) throw new Error("distinct entry events collided");
  if (first !== replay) throw new Error("the same entry event did not replay");
});
