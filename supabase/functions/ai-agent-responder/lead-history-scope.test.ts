import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  requireCurrentLeadId,
  rowsForCurrentLead,
} from "./lead-history-scope.ts";

test("A to B rebind excludes A history and takeover evidence", () => {
  const leadA = "11111111-1111-4111-8111-111111111111";
  const leadB = "22222222-2222-4222-8222-222222222222";
  const evidence = [
    { id: "history-a", lead_id: leadA },
    { id: "history-null", lead_id: null },
    { id: "history-b", lead_id: leadB },
  ];

  assert.deepEqual(
    rowsForCurrentLead(evidence, leadB).map((row) => row.id),
    ["history-b"],
  );
  assert.deepEqual(
    rowsForCurrentLead(evidence, leadA).map((row) => row.id),
    ["history-a"],
  );
});

test("lead-scoped history and takeover fail closed without a current lead", () => {
  assert.throws(() => requireCurrentLeadId(null), /Current lead identity is required/);
  assert.throws(() => rowsForCurrentLead([], "  "), /Current lead identity is required/);
});

test("handler queries history and both takeover sources by the current lead", async () => {
  const handler = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const flow = handler.slice(0, handler.indexOf("function json"));
  const history = handler.slice(
    handler.indexOf("async function getCompactHistory"),
    handler.indexOf("function buildSystemPrompt"),
  );
  const takeover = handler.slice(
    handler.indexOf("async function detectHumanTakeover"),
    handler.indexOf("function isAutomationSenderName"),
  );

  const missingLeadGuard = flow.indexOf('action: "lead_unavailable_no_ai"');
  const claim = flow.indexOf("const responseClaim = await claimAIResponse");
  assert.ok(missingLeadGuard >= 0 && missingLeadGuard < claim);
  assert.match(
    flow,
    /detectHumanTakeover\([\s\S]*?conversation\.session_id \|\| null,\s*currentLeadId,\s*takeoverSince/,
  );
  assert.match(
    flow,
    /getCompactHistory\([\s\S]*?conversation\.session_id \|\| null,\s*currentLeadId,\s*message/,
  );

  assert.match(history, /requireCurrentLeadId\(leadId\)/);
  assert.match(history, /\.eq\("lead_id", currentLeadId\)/);
  assert.match(history, /if \(error\) throw error/);
  assert.match(history, /rowsForCurrentLead\(data, currentLeadId\)/);
  assert.doesNotMatch(history, /\.is\("lead_id", null\)/);

  assert.match(takeover, /\.from\("whatsapp_messages"\)[\s\S]*?\.eq\("lead_id", currentLeadId\)/);
  assert.match(takeover, /\.from\("outbox_messages"\)[\s\S]*?\.eq\("lead_id", currentLeadId\)/);
  assert.equal((takeover.match(/rowsForCurrentLead\(/g) || []).length, 2);
  assert.doesNotMatch(takeover, /\.is\("lead_id", null\)/);
});
