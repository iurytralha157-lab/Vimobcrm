import assert from "node:assert/strict";
import test from "node:test";

import {
  readWhatsAppEdgeExecutionHeaders,
  runWhatsAppEdgeExecutionWithFence,
} from "./edge-execution-fence.ts";

const scope = {
  organizationId: "91bad7ae-56d4-4650-a993-3f531005ea64",
  sessionId: "03942a58-b860-4413-9f0b-54bad43a4bcb",
  inboxId: "e976d40f-8aca-4c38-8204-1697aa783d83",
  executionId: "58503627-2de8-4343-8395-6887930824c9",
};

function rpcClient(calls, responses) {
  return {
    async rpc(name, parameters) {
      calls.push(name);
      assert.deepEqual(parameters, {
        p_organization_id: scope.organizationId,
        p_session_id: scope.sessionId,
        p_inbox_id: scope.inboxId,
        p_execution_id: scope.executionId,
      });
      return responses[name] ?? { data: true, error: null };
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

test("internal worker headers require two valid execution identifiers", () => {
  const headers = new Headers({
    "x-vimob-inbox-id": scope.inboxId.toUpperCase(),
    "x-vimob-edge-execution-id": scope.executionId,
  });
  assert.deepEqual(readWhatsAppEdgeExecutionHeaders(headers), {
    inboxId: scope.inboxId,
    executionId: scope.executionId,
  });
  headers.delete("x-vimob-edge-execution-id");
  assert.equal(readWhatsAppEdgeExecutionHeaders(headers), null);
  headers.set("x-vimob-edge-execution-id", "malformed");
  assert.equal(readWhatsAppEdgeExecutionHeaders(headers), null);
});

test("rejected or failed start prevents every effect and never calls finish", async () => {
  for (const response of [
    { data: false, error: null },
    { data: null, error: { code: "PGRST000" } },
  ]) {
    const calls = [];
    await assert.rejects(
      runWhatsAppEdgeExecutionWithFence(
        rpcClient(calls, { start_whatsapp_webhook_edge_execution: response }),
        scope,
        async () => { calls.push("effect"); },
      ),
      /whatsapp_edge_execution_start_rejected/,
    );
    assert.deepEqual(calls, ["start_whatsapp_webhook_edge_execution"]);
  }
});

test("finish is awaited only after all effects, before the response is returned", async () => {
  const calls = [];
  const effect = deferred();
  const finish = deferred();
  const client = rpcClient(calls, {});
  client.rpc = async (name, parameters) => {
    const result = await rpcClient(calls, {}).rpc(name, parameters);
    return name === "finish_whatsapp_webhook_edge_execution" ? finish.promise : result;
  };
  const result = runWhatsAppEdgeExecutionWithFence(client, scope, async () => {
    calls.push("effect_started");
    await effect.promise;
    calls.push("effect_finished");
    return { ok: true };
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["start_whatsapp_webhook_edge_execution", "effect_started"]);
  effect.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [
    "start_whatsapp_webhook_edge_execution", "effect_started",
    "effect_finished", "finish_whatsapp_webhook_edge_execution",
  ]);
  finish.resolve({ data: true, error: null });
  assert.deepEqual(await result, { ok: true });
});

test("processing failure still finishes the active execution", async () => {
  const calls = [];
  await assert.rejects(
    runWhatsAppEdgeExecutionWithFence(rpcClient(calls, {}), scope, async () => {
      calls.push("effect");
      throw new Error("effect_failed");
    }),
    /effect_failed/,
  );
  assert.deepEqual(calls, [
    "start_whatsapp_webhook_edge_execution", "effect",
    "finish_whatsapp_webhook_edge_execution",
  ]);
});

test("failed finish never returns a success response", async () => {
  for (const response of [
    { data: false, error: null },
    { data: null, error: { code: "PGRST000" } },
  ]) {
    const calls = [];
    await assert.rejects(
      runWhatsAppEdgeExecutionWithFence(
        rpcClient(calls, { finish_whatsapp_webhook_edge_execution: response }),
        scope,
        async () => { calls.push("effect"); return { ok: true }; },
      ),
      /whatsapp_edge_execution_finish_rejected/,
    );
    assert.deepEqual(calls, [
      "start_whatsapp_webhook_edge_execution", "effect",
      "finish_whatsapp_webhook_edge_execution",
    ]);
  }
});
