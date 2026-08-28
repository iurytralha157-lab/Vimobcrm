import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

import {
  buildEvolutionMessageEventKey,
  claimEvolutionMessageDelivery,
  completeEvolutionMessageDelivery,
  EvolutionMessageClaimError,
  retryEvolutionMessageDelivery,
  type EvolutionWebhookClaimClient,
} from "./delivery-claim.ts";

const baseTime = new Date("2026-08-16T18:00:00.000Z");
const scope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  providerInstanceId: "legacy-instance",
  providerMessageId: "provider-message-123",
  eventType: "messages.upsert",
  providerPayload: {
    event: "messages.upsert",
    instance: "legacy-instance",
    apikey: "must-not-be-persisted",
    data: {
      key: { id: "provider-message-123" },
      nested: { authorization: "must-not-be-persisted" },
    },
  },
};

test("builds a tenant and session scoped key without exposing the provider message ID", async () => {
  const first = await buildEvolutionMessageEventKey(scope);
  const same = await buildEvolutionMessageEventKey({ ...scope });
  const otherSession = await buildEvolutionMessageEventKey({
    ...scope,
    sessionId: "33333333-3333-4333-8333-333333333333",
  });

  assert.equal(first, same);
  assert.notEqual(first, otherSession);
  assert.match(first, /^evolution_go:message:[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9a-f]{64}$/);
  assert.equal(first.includes(scope.providerMessageId), false);
  assert.ok(first.length <= 512);
});

test("a concurrent delivery race yields exactly one lease owner", async () => {
  const ledger = createClaimLedger();
  const claims = await Promise.all(
    Array.from({ length: 40 }, (_, index) =>
      claimEvolutionMessageDelivery(ledger.client, scope, {
        now: baseTime,
        ownerId: `owner-${index}`,
      })
    ),
  );

  assert.equal(claims.filter((claim) => claim.outcome === "claimed").length, 1);
  assert.equal(claims.filter((claim) => claim.outcome === "in_progress").length, 39);
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.rows[0].status, "processing");
  assert.equal(ledger.rows[0].provider, "evolution_go");
  assert.deepEqual(ledger.rows[0].payload, {
    event: "messages.upsert",
    instance: "legacy-instance",
    data: {
      key: { id: "provider-message-123" },
      nested: {},
    },
  });
  assert.deepEqual(ledger.upsertOptions[0], {
    onConflict: "event_key",
    ignoreDuplicates: true,
  });
});

test("processed is written only after the owner explicitly completes all work", async () => {
  const ledger = createClaimLedger();
  const claim = await claimEvolutionMessageDelivery(ledger.client, scope, {
    now: baseTime,
    ownerId: "owner-first",
  });
  assert.equal(claim.outcome, "claimed");
  assert.equal(ledger.rows[0].status, "processing");

  if (claim.outcome !== "claimed") throw new Error("claim was not owned");
  await completeEvolutionMessageDelivery(ledger.client, claim, baseTime);
  assert.equal(ledger.rows[0].status, "processed");
  assert.equal(ledger.rows[0].locked_at, null);
  assert.equal(ledger.rows[0].locked_by, null);

  const replay = await claimEvolutionMessageDelivery(ledger.client, scope, {
    now: new Date(baseTime.getTime() + 1_000),
    ownerId: "owner-replay",
  });
  assert.deepEqual(replay, { outcome: "duplicate" });
});

test("a crash keeps a fresh lease in progress and permits one stale CAS takeover", async () => {
  const ledger = createClaimLedger();
  const first = await claimEvolutionMessageDelivery(ledger.client, scope, {
    now: baseTime,
    ownerId: "owner-crashed",
  });
  assert.equal(first.outcome, "claimed");

  const freshRetry = await claimEvolutionMessageDelivery(ledger.client, scope, {
    now: new Date(baseTime.getTime() + 60_000),
    ownerId: "owner-too-early",
  });
  assert.deepEqual(freshRetry, { outcome: "in_progress" });

  const staleTime = new Date(baseTime.getTime() + 6 * 60_000);
  const recoveries = await Promise.all([
    claimEvolutionMessageDelivery(ledger.client, scope, {
      now: staleTime,
      ownerId: "owner-recovery-a",
    }),
    claimEvolutionMessageDelivery(ledger.client, scope, {
      now: staleTime,
      ownerId: "owner-recovery-b",
    }),
  ]);

  assert.equal(recoveries.filter((claim) => claim.outcome === "claimed").length, 1);
  assert.equal(recoveries.filter((claim) => claim.outcome === "in_progress").length, 1);
  const recovered = recoveries.find((claim) => claim.outcome === "claimed");
  assert.ok(recovered && recovered.outcome === "claimed" && recovered.resumed);
  assert.equal(ledger.rows[0].attempts, 2);
});

test("lease age compares parsed timestamps and malformed state fails closed", async () => {
  const ledger = createClaimLedger();
  const first = await claimEvolutionMessageDelivery(ledger.client, scope, {
    now: baseTime,
    ownerId: "owner-time-format",
  });
  assert.equal(first.outcome, "claimed");

  ledger.rows[0].locked_at = "2026-08-16T15:00:00-03:00";
  const fresh = await claimEvolutionMessageDelivery(ledger.client, scope, {
    now: new Date(baseTime.getTime() + 60_000),
    ownerId: "owner-offset-retry",
  });
  assert.deepEqual(fresh, { outcome: "in_progress" });

  ledger.rows[0].locked_at = "not-a-timestamp";
  await assert.rejects(
    claimEvolutionMessageDelivery(ledger.client, scope, {
      now: new Date(baseTime.getTime() + 6 * 60_000),
      ownerId: "owner-invalid-state",
    }),
    EvolutionMessageClaimError,
  );
});

test("an explicit failure releases the lease to retry and the next owner can finish", async () => {
  const ledger = createClaimLedger();
  const first = await claimEvolutionMessageDelivery(ledger.client, scope, {
    now: baseTime,
    ownerId: "owner-failed",
  });
  if (first.outcome !== "claimed") throw new Error("claim was not owned");

  await retryEvolutionMessageDelivery(ledger.client, first, baseTime);
  assert.equal(ledger.rows[0].status, "retry");
  assert.equal(ledger.rows[0].locked_by, null);

  const retry = await claimEvolutionMessageDelivery(ledger.client, scope, {
    now: new Date(baseTime.getTime() + 1_000),
    ownerId: "owner-retry",
  });
  assert.ok(retry.outcome === "claimed" && retry.resumed);
  if (retry.outcome !== "claimed") throw new Error("retry was not owned");
  await completeEvolutionMessageDelivery(ledger.client, retry, baseTime);
  assert.equal(ledger.rows[0].status, "processed");
});

test("claim persistence errors fail closed without leaking the database message", async () => {
  const ledger = createClaimLedger({
    error: { code: "XX000", message: "sensitive database detail" },
  });

  await assert.rejects(
    claimEvolutionMessageDelivery(ledger.client, scope),
    (error: unknown) => {
      assert.ok(error instanceof EvolutionMessageClaimError);
      assert.equal(String(error).includes("sensitive database detail"), false);
      return true;
    },
  );
});

test("installed Supabase client emits atomic ignore-duplicates semantics", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = createClient("https://project.example", "service-role-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(JSON.stringify([{ id: "claim-from-postgrest" }]), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  });

  const claim = await claimEvolutionMessageDelivery(
    client as unknown as EvolutionWebhookClaimClient,
    scope,
    { now: baseTime, ownerId: "owner-postgrest" },
  );

  assert.ok(claim.outcome === "claimed" && !claim.resumed);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /whatsapp_webhook_inbox\?on_conflict=event_key/);
  const headers = new Headers(requests[0].init?.headers);
  assert.match(headers.get("prefer") || "", /resolution=ignore-duplicates/);
  assert.match(headers.get("prefer") || "", /return=representation/);
});

type StoredRow = Record<string, unknown> & {
  id: string;
  event_key: string;
};

function createClaimLedger(configuration?: {
  error?: { code?: string; message?: string };
}) {
  const rows: StoredRow[] = [];
  const upsertOptions: Array<Record<string, unknown>> = [];

  const client = {
    from(table: string) {
      assert.equal(table, "whatsapp_webhook_inbox");
      return {
        upsert(row: Record<string, unknown>, options: Record<string, unknown>) {
          upsertOptions.push(options);
          return {
            select(columns: string) {
              assert.equal(columns, "id");
              return {
                async maybeSingle() {
                  if (configuration?.error) return { data: null, error: configuration.error };
                  const eventKey = String(row.event_key);
                  if (rows.some((stored) => stored.event_key === eventKey)) {
                    return { data: null, error: null };
                  }
                  const stored = { ...row, id: `claim-${rows.length + 1}`, event_key: eventKey };
                  rows.push(stored);
                  await Promise.resolve();
                  return { data: { id: stored.id }, error: null };
                },
              };
            },
          };
        },
        select() {
          return createFilterBuilder("select");
        },
        update(update: Record<string, unknown>) {
          return createFilterBuilder("update", update);
        },
      };
    },
  } as unknown as EvolutionWebhookClaimClient;

  function createFilterBuilder(
    mode: "select" | "update",
    update: Record<string, unknown> = {},
  ) {
    const filters: Array<{ operator: "eq" | "lt" | "lte"; column: string; value: unknown }> = [];
    const builder = {
      eq(column: string, value: unknown) {
        filters.push({ operator: "eq", column, value });
        return builder;
      },
      lt(column: string, value: unknown) {
        filters.push({ operator: "lt", column, value });
        return builder;
      },
      lte(column: string, value: unknown) {
        filters.push({ operator: "lte", column, value });
        return builder;
      },
      select() {
        return builder;
      },
      async maybeSingle() {
        if (configuration?.error) return { data: null, error: configuration.error };
        const row = rows.find((candidate) => filters.every((filter) => matches(candidate, filter)));
        if (!row) return { data: null, error: null };
        if (mode === "update") Object.assign(row, update);
        await Promise.resolve();
        return { data: mode === "select" ? { ...row } : { id: row.id }, error: null };
      },
    };
    return builder;
  }

  return { client, rows, upsertOptions };
}

function matches(
  row: StoredRow,
  filter: { operator: "eq" | "lt" | "lte"; column: string; value: unknown },
) {
  const actual = row[filter.column];
  if (filter.operator === "eq") return actual === filter.value;
  if (typeof actual !== "string" || typeof filter.value !== "string") return false;
  return filter.operator === "lt" ? actual < filter.value : actual <= filter.value;
}
