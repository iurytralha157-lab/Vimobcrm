import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const root = fileURLToPath(new URL("../../", import.meta.url));

function harness(response = { success: true, connection: null, can_connect: true }) {
  const calls = [], cache = new Map();
  class APIError extends Error {}
  function load(relative) {
    const absolute = path.resolve(root, relative);
    assert.ok(absolute.startsWith(`${root}${path.sep}`) || absolute.startsWith(root));
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const record = { exports: {} };
    cache.set(absolute, record);
    const compiled = ts.transpileModule(readFileSync(absolute, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(compiled, {
      module: record, exports: record.exports, URL, console,
      require: specifier => {
        if (specifier === "zod") return { z };
        if (specifier === "@/config/constants") return { FEATURES: { ENABLE_GOOGLE_CALENDAR_INTEGRATION: true } };
        if (specifier === "@/lib/api/vimob-client") return {
          VimobAPIError: APIError,
          vimobAPIRequest: async (requestPath, options) => { calls.push({ path: requestPath, ...JSON.parse(JSON.stringify(options)) }); return response; },
        };
        if (specifier.startsWith("@/lib/validation/")) return load(`${specifier.slice(2)}.ts`);
        if (specifier.startsWith("./")) return load(path.relative(root, path.resolve(path.dirname(absolute), `${specifier}.ts`)));
        throw new Error(`Unexpected test import: ${specifier}`);
      },
    }, { filename: relative });
    return record.exports;
  }
  return { ...load("lib/api/google-calendar.ts"), calls };
}

test("Calendar authorization preserves its request and Tasks requires an explicit enable_tasks flag", async () => {
  const h = harness({ success: true, auth_url: "https://accounts.example.test/consent" });
  await h.googleCalendarAPI.getAuthUrl("tenant-a", "https://staging.example.test/settings");
  assert.equal(h.calls[0].body.action, "get_auth_url");
  assert.equal(Object.hasOwn(h.calls[0].body, "enable_tasks"), false);
  await h.googleCalendarAPI.getAuthUrl("tenant-a", "https://staging.example.test/settings", { enableTasks: true });
  assert.equal(h.calls[1].body.enable_tasks, true);
  assert.equal(h.calls[1].organizationId, "tenant-a");
  assert.equal(h.calls[1].method, "POST");
  assert.equal(h.calls[1].path, "/v1/integrations/google-calendar/functions/google-calendar-oauth");
  assert.equal(new URL(h.calls[1].body.return_url).search, "");
  assert.throws(() => h.googleCalendarAPI.getAuthUrl("tenant-a", "https://staging.example.test/settings", { provider: "tasks" }));
  assert.equal(h.calls.length, 2);
});

test("status retains Tasks capability on the connection and accepts older Calendar responses", async () => {
  const old = harness({ success: true, connection: { id: "synthetic-connection", calendar_id: "primary" }, can_connect: true });
  const legacy = await old.googleCalendarAPI.getStatus("tenant-a");
  assert.equal(legacy.connection.calendar_id, "primary");
  assert.equal(legacy.connection.tasks_authorized, undefined);
  const current = harness({ success: true, connection: {
    id: "synthetic-connection", calendar_id: "primary", tasks_authorized: false, routing_v2: false, tasks_list_id: null,
  }, tasks_available: true, can_connect: true });
  const status = await current.googleCalendarAPI.getStatus("tenant-a");
  assert.equal(status.connection.tasks_authorized, false);
  assert.equal(status.connection.routing_v2, false);
  assert.equal(status.connection.tasks_list_id, null);
  assert.equal(status.tasks_available, true);
  assert.deepEqual(current.calls[0].body, { action: "status" });
});

test("a malformed Tasks grant is not treated as authorization", async () => {
  const h = harness({ success: true, connection: { tasks_authorized: "true" }, can_connect: true });
  await assert.rejects(h.googleCalendarAPI.getStatus("tenant-a"), error => error.code === "domain_validation_error");
});
