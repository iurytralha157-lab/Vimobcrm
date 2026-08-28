import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function functionSource(name: string) {
  return readFileSync(
    new URL(`../${name}/index.ts`, import.meta.url),
    "utf8",
  );
}

for (
  const name of [
    "send-notification",
    "send-push-notification",
    "cleanup-notifications",
    "notification-scheduler",
    "sla-checker",
    "pool-checker",
    "lead-notification-dispatcher",
  ]
) {
  test(`${name} authorizes the private caller before privileged work`, () => {
    const source = functionSource(name);
    assert.match(
      source,
      /import \{ authorizePrivateWorkerRequest \} from "\.\.\/_shared\/private-worker-auth\.ts";/,
    );
    assert.match(source, /req\.method !== "POST"/);

    const serve = source.indexOf("Deno.serve(");
    const authorization = source.indexOf(
      "authorizePrivateWorkerRequest(req)",
      serve,
    );
    const privilegedClient = source.indexOf("const supabase = createClient", serve);
    assert.ok(serve >= 0 && authorization > serve);
    assert.ok(
      privilegedClient > authorization,
      "authorization must happen before a service-role client is created",
    );
  });
}

test("lead notification dispatcher authenticates before reading its payload", () => {
  const source = functionSource("lead-notification-dispatcher");
  const serve = source.indexOf("Deno.serve(");
  const authorization = source.indexOf(
    "authorizePrivateWorkerRequest(req)",
    serve,
  );
  const payload = source.indexOf("await req.json()", serve);

  assert.ok(serve >= 0 && authorization > serve);
  assert.ok(
    payload > authorization,
    "untrusted request bodies must not be parsed before worker authorization",
  );
});

test("notification scheduler no longer emits cadence task notifications", () => {
  const source = functionSource("notification-scheduler");
  assert.doesNotMatch(source, /\.from\("lead_tasks"\)/);
  assert.doesNotMatch(source, /Tarefa de cadencia/);

  // The unrelated scheduler responsibilities stay enabled.
  assert.match(source, /\.from\("schedule_events"\)/);
  assert.match(source, /\.from\("financial_entries"\)/);
});
