import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function functionSource(name: string) {
  return readFileSync(
    new URL(`../${name}/index.ts`, import.meta.url),
    "utf8",
  );
}

function projectSource(relativePath: string) {
  return readFileSync(
    new URL(`../../../${relativePath}`, import.meta.url),
    "utf8",
  );
}

for (
  const name of [
    "notification-dispatcher",
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
    const privilegedClient = source.indexOf(
      "const supabase = createClient",
      serve,
    );
    assert.ok(serve >= 0 && authorization > serve);
    assert.ok(
      privilegedClient > authorization,
      "authorization must happen before a service-role client is created",
    );
  });
}

test("public-site lead producers share the canonical recipient dedupe key", () => {
  const publicSite = functionSource("public-site-contact");
  const dispatcher = functionSource("lead-notification-dispatcher");

  assert.match(
    publicSite,
    /new_lead_received:\$\{leadId\}:\$\{currentLead\.assigned_user_id\}/,
  );
  assert.match(
    publicSite,
    /new_lead_received:\$\{leadId\}:\$\{admin\.id\}/,
  );
  assert.match(
    dispatcher,
    /new_lead_received:\$\{typedLead\.id\}:\$\{userId\}/,
  );
});

for (const name of ["sla-checker", "session-health-check"]) {
  test(`${name} requires a durable queue acknowledgement`, () => {
    const source = functionSource(name);
    assert.match(source, /async function enqueueNotification\(/);
    assert.match(source, /result\?\.success !== true/);
    assert.match(source, /result\.queued !== true/);
    assert.match(source, /typeof result\.notification_id !== "string"/);
    assert.match(source, /await enqueueNotification\(/);
  });
}

test("recurring notification dedupe keys identify SLA cycles and disconnect episodes", () => {
  const healthCheck = functionSource("session-health-check");
  assert.match(
    healthCheck,
    /const disconnectEpisode = session\.updated_at \|\|\s*session\.last_connected_at \|\| session\.created_at;/,
  );
  assert.equal(
    [...healthCheck.matchAll(/disconnect_episode:\s*disconnectEpisode/g)]
      .length,
    2,
  );
  assert.equal(
    [...healthCheck.matchAll(
      /dedupe_key:\s*`whatsapp_disconnected:[^`]*\$\{disconnectEpisode\}`/g,
    )].length,
    2,
  );

  const slaChecker = functionSource("sla-checker");
  assert.doesNotMatch(slaChecker, /now\.getHours\(\)/);
  assert.equal(
    [...slaChecker.matchAll(
      /dedupe_key:\s*`sla_(?:warning|overdue(?:_manager)?):[^`]*\$\{lead\.sla_start_at\}`/g,
    )].length,
    3,
  );

  const sessionsHook = projectSource("hooks/use-whatsapp-sessions.ts");
  assert.match(
    sessionsHook,
    /dedupeKey:\s*`whatsapp_disconnected:\$\{session\.id\}:\$\{session\.owner_user_id\}:\$\{session\.updated_at\}`/,
  );
});

test("notification-service is a private adapter to the canonical producer", () => {
  const source = functionSource("notification-service");
  const serve = source.indexOf("Deno.serve(");
  const authorization = source.indexOf(
    "authorizePrivateWorkerRequest(req)",
    serve,
  );
  const payload = source.indexOf("await req.json()", serve);
  const enqueue = source.indexOf(
    "/functions/v1/notification-dispatcher",
    serve,
  );

  assert.ok(serve >= 0 && authorization > serve);
  assert.ok(payload > authorization, "authorization must precede body parsing");
  assert.ok(
    enqueue > payload,
    "the adapter must enqueue only after validation",
  );
  assert.equal([...source.matchAll(/\bfetch\s*\(/g)].length, 1);
  assert.match(source, /"apikey":\s*serviceRoleKey/);
  assert.match(source, /"Authorization":\s*`Bearer \$\{serviceRoleKey\}`/);
  assert.match(source, /body\.template_slug,\s*body\.templateSlug/);
  assert.match(source, /body\.dedupe_key, body\.dedupeKey/);
  assert.doesNotMatch(source, /createClient|\.from\(|notification_logs/);
  assert.doesNotMatch(
    source,
    /whatsapp-notifier|send-email|send-push(?:-notification)?|EVOLUTION_API/,
  );
});

test("notification Evolution failover is a documented fail-closed tombstone", () => {
  const source = functionSource("notification-evolution-failover");
  assert.match(
    source,
    /serveRetiredWhatsAppFunction\("notification-evolution-failover"\)/,
  );
  assert.doesNotMatch(
    source,
    /createClient|fetch\s*\(|Deno\.env|SUPABASE_SERVICE_ROLE_KEY|EVOLUTION_API|notification_logs/,
  );

  const retired = projectSource("supabase/functions/_shared/retired.ts");
  assert.match(retired, /status:\s*410/);

  const retirementGuide = projectSource("deploy/edge-retirement/README.md");
  assert.match(retirementGuide, /`notification-service`/);
  assert.match(retirementGuide, /`notification-evolution-failover`/);
  assert.match(retirementGuide, /worker canonico do backend Go/);
  assert.match(retirementGuide, /Nao altere `production-manifest\.json`/);
});

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

test("notification scheduler leaves Agenda production to the canonical Go worker", () => {
  const source = functionSource("notification-scheduler");
  assert.doesNotMatch(source, /\.from\("lead_tasks"\)/);
  assert.doesNotMatch(source, /Tarefa de cadencia/);
  assert.doesNotMatch(source, /\.from\("schedule_events"\)/);
  assert.doesNotMatch(source, /appointment_reminder|appointment_outcome_pending/);
  assert.doesNotMatch(source, /notification-dispatcher/);

  // The unrelated financial responsibility stays enabled.
  assert.match(source, /\.from\("financial_entries"\)/);
});

test("notification cleanup selects and classifies rows before a scoped delete", () => {
  const source = functionSource("cleanup-notifications");
  assert.match(
    source,
    /import \{ canPurgeNotification \} from "\.\.\/_shared\/notification-retention\.ts";/,
  );
  assert.match(source, /\.select\("id, metadata"\)/);
  assert.match(
    source,
    /\.filter\(\(candidate\) => canPurgeNotification\(candidate\.metadata\)\)/,
  );
  assert.match(source, /\.in\("id", purgeableIds\)/);
  for (
    const marker of [
      "metadata->dispatch",
      "metadata->whatsapp_dispatch",
      "metadata->push_dispatch",
      "metadata->email_dispatch",
      "metadata->>whatsapp_dispatch_required",
      "metadata->>push_dispatch_required",
      "metadata->>email_dispatch_required",
      "metadata->>outcome_unknown",
    ]
  ) {
    assert.match(source, new RegExp(`\\.is\\("${marker}", null\\)`));
  }
  assert.doesNotMatch(
    source,
    /\.from\("notifications"\)\s*\.delete\(\)\s*\.lt\("created_at"/,
  );
});

test("legacy notification dispatcher is a private producer-only canonical enqueue", () => {
  const source = functionSource("notification-dispatcher");
  const serve = source.indexOf("Deno.serve(");
  const authorization = source.indexOf(
    "authorizePrivateWorkerRequest(req)",
    serve,
  );
  const payload = source.indexOf("await req.json()", serve);
  const privilegedClient = source.indexOf(
    "const supabase = createClient",
    serve,
  );

  assert.ok(serve >= 0 && authorization > serve);
  assert.ok(payload > authorization, "authorization must precede body parsing");
  assert.ok(
    privilegedClient > payload,
    "the service-role client must be created only after authentication and validation",
  );

  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(
    source,
    /whatsapp-notifier|send-email|send-push-notification|notification_logs/,
  );
  assert.equal(
    [...source.matchAll(/\.from\("notifications"\)\s*\.insert\(/g)].length,
    1,
  );
  assert.match(source, /required:\s*true,\s*status:\s*"pending"/);
  assert.match(
    source,
    /if \(Object\.keys\(dispatch\)\.length > 0\) metadata\.dispatch = dispatch/,
  );
  assert.match(source, /event_key:\s*eventKey/);
  assert.match(source, /variables:\s*enrichedVariables/);
  assert.match(source, /dedupe_key:\s*finalDedupeKey/);
  assert.match(source, /requested_recipient:\s*requestedRecipient \|\| null/);
  assert.match(source, /template:\s*\{/);
  assert.match(source, /insertError\.code === "23505"/);
  assert.match(source, /deduplicated:\s*true/);
  assert.match(source, /deduplicated:\s*false/);
  assert.match(source, /queued:\s*true/);
  assert.match(source, /notification_id:/);
});

test("notification producer validates tenant references and keeps recipient keys non-PII", () => {
  const source = functionSource("notification-dispatcher");
  assert.match(source, /UUID_RE\.test\(organizationId\)/);
  assert.match(source, /UUID_RE\.test\(userId\)/);
  assert.match(source, /UUID_RE\.test\(leadId\)/);
  assert.match(source, /\.from\("organizations"\)/);
  assert.match(source, /\.from\("users"\)/);
  assert.match(source, /\.from\("organization_members"\)/);
  assert.match(source, /\.from\("leads"\)/);
  assert.match(source, /\.eq\("organization_id", organizationId\)/);
  assert.match(source, /const recipientKey = `user:\$\{userId\}`/);
  assert.match(source, /recipient_key:\s*recipientKey/);
  assert.doesNotMatch(source, /recipientKey\s*=\s*requestedRecipient/);
  assert.doesNotMatch(source, /recipient_key:\s*requestedRecipient/);
});

for (
  const name of [
    "lead-notification-dispatcher",
    "public-site-contact",
    "sla-checker",
    "session-health-check",
  ]
) {
  test(`${name} sends both private credentials to notification-dispatcher`, () => {
    const source = functionSource(name);
    const invocations = [...source.matchAll(
      /fetch\(\s*`[^`]*\/functions\/v1\/notification-dispatcher`\s*,\s*\{/g,
    )];
    assert.ok(
      invocations.length > 0,
      `${name} must call notification-dispatcher`,
    );

    for (const invocation of invocations) {
      const body = source.indexOf("body:", invocation.index);
      assert.ok(body > invocation.index, "invocation must include a body");
      const headers = source.slice(invocation.index, body);
      assert.match(headers, /["']?apikey["']?\s*:/);
      assert.match(headers, /["']?Authorization["']?\s*:/);
    }
  });
}
