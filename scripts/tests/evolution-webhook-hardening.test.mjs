import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL(
  "../../supabase/functions/evolution-webhook/index.ts",
  import.meta.url,
);
const claimSourceUrl = new URL(
  "../../supabase/functions/evolution-webhook/delivery-claim.ts",
  import.meta.url,
);
const goWorkerSourceUrl = new URL(
  "../../apps/api/internal/whatsapp/webhook_worker.go",
  import.meta.url,
);

test("legacy Evolution webhook authenticates before body, admin client or I/O", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const methodGuard = source.indexOf('if (req.method !== "POST")');
  const authorization = source.indexOf("authorizeEvolutionWebhookIngressRequest(req");
  const adminClient = source.indexOf("const supabase = createClient");
  const bodyRead = source.indexOf("const payload = await req.json()");

  assert.ok(methodGuard > 0);
  assert.ok(authorization > methodGuard);
  assert.ok(adminClient > authorization);
  assert.ok(bodyRead > adminClient);
  assert.doesNotMatch(source, /webhook security disabled/i);
  assert.doesNotMatch(source, /JSON\.stringify\(payload, null, 2\)/);
});

test("message replay claim precedes every per-message side effect", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const handlerStart = source.indexOf("async function handleMessagesUpsert");
  const claim = source.indexOf("claimEvolutionMessageDelivery(supabase", handlerStart);
  const facebookParsing = source.indexOf("// ===== FACEBOOK ADS DETECTION", handlerStart);
  const conversationWork = source.indexOf("// Find or create conversation", handlerStart);
  const mediaWork = source.indexOf("// Process media if exists", handlerStart);
  const canonicalInsert = source.indexOf("// Insert without updating an existing row", handlerStart);
  const aiEffect = source.indexOf("/functions/v1/ai-agent-responder", handlerStart);

  assert.ok(claim > handlerStart);
  for (const effect of [facebookParsing, conversationWork, mediaWork, canonicalInsert, aiEffect]) {
    assert.ok(effect > claim);
  }
  assert.doesNotMatch(source, /\/functions\/v1\/automation-trigger/);
  assert.match(source, /onConflict:\s*"session_id,message_id",\s*\n\s*ignoreDuplicates:\s*true/);
  assert.match(
    source,
    /else if \(!insertedMessage\?\.id\) \{[\s\S]*?completeEvolutionMessageDelivery\(supabase, ownedClaim\);[\s\S]*?result\.duplicates \+= 1;/,
  );
  const completionAfterAi = source.indexOf(
    "await completeEvolutionMessageDelivery(supabase, ownedClaim)",
    aiEffect,
  );
  assert.ok(completionAfterAi > aiEffect);
  assert.match(source, /const aiAgentResponse = await fetch\(`\$\{supabaseUrl\}\/functions\/v1\/ai-agent-responder`/);
  assert.match(source, /await retryEvolutionMessageDelivery\(supabase, ownedClaim\)/);
});

test("legacy handler rejects the canonical Go worker contract before privileged work", async () => {
  const [source, goWorkerSource] = await Promise.all([
    readFile(sourceUrl, "utf8"),
    readFile(goWorkerSourceUrl, "utf8"),
  ]);
  const forwardStart = goWorkerSource.indexOf("func (repo Repository) forwardEvolutionWebhook");
  const forwardEnd = goWorkerSource.indexOf("func (repo Repository) markEvolutionWebhookProcessed", forwardStart);
  const forwardSource = goWorkerSource.slice(forwardStart, forwardEnd);

  assert.match(forwardSource, /query\.Set\("session_id", item\.SessionID\)/);
  assert.match(forwardSource, /query\.Set\("instance_id", item\.InstanceID\)/);
  assert.match(forwardSource, /supabasehttp\.SetServiceAuth\(request, repo\.functions\.apiKey\)/);
  assert.match(forwardSource, /request\.Header\.Set\("x-webhook-token", item\.WebhookToken\)/);

  const authorization = source.indexOf("authorizeEvolutionWebhookIngressRequest(req");
  const workerRejection = source.indexOf(
    'if (authorization.contract === "internal_worker_lease")',
    authorization,
  );
  const adminKey = source.indexOf(
    "const SUPABASE_ADMIN_KEY = selectSupabaseAdminSecretKey(secretEnvironment)",
    workerRejection,
  );
  const bodyRead = source.indexOf("const payload = await req.json()", adminKey);

  assert.ok(authorization >= 0);
  assert.ok(workerRejection > authorization);
  assert.ok(adminKey > workerRejection);
  assert.ok(bodyRead > adminKey);
  assert.match(source.slice(workerRejection, adminKey), /status: 409/);
  assert.doesNotMatch(source.slice(adminKey), /usesInternalWorkerLease|deliveryContract/);
  assert.doesNotMatch(source, /\.from\("whatsapp_webhook_inbox"\)/);
});

test("direct callback sessions are active Evolution rows revalidated before effects", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const firstLookup = source.indexOf('let session: ResolvedWebhookSession | null = null');
  const revalidation = source.indexOf('const sessionRevalidation = await supabase', firstLookup);
  const effects = source.indexOf('switch (event)', revalidation);

  assert.ok(firstLookup >= 0);
  assert.ok(revalidation > firstLookup);
  assert.ok(effects > revalidation);
  const lookupScope = source.slice(firstLookup, effects);
  assert.ok((lookupScope.match(/\.eq\("provider", "evolution"\)/g) || []).length >= 3);
  assert.ok((lookupScope.match(/\.eq\("is_active", true\)/g) || []).length >= 3);
  assert.ok((lookupScope.match(/\.neq\("status", "deleted"\)/g) || []).length >= 3);
  assert.match(lookupScope, /\.eq\("organization_id", session\.organization_id\)/);
  assert.ok(
    (lookupScope.match(/validateEvolutionCallbackSessionToken\(/g) || []).length >= 2,
    "session token must be checked after resolution and again before effects",
  );
  assert.match(source, /selectSupabaseAdminSecretKey\(secretEnvironment\)/);
  const handler = source.slice(
    source.indexOf("Deno.serve(async (req) =>"),
    source.indexOf("async function handleConnectionUpdate"),
  );
  assert.doesNotMatch(handler, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
});

test("durable lease is processing until explicit completion and supports retry", async () => {
  const source = await readFile(claimSourceUrl, "utf8");
  const claimStart = source.indexOf("export async function claimEvolutionMessageDelivery");
  const completionStart = source.indexOf("export async function completeEvolutionMessageDelivery");
  const retryStart = source.indexOf("export async function retryEvolutionMessageDelivery");
  const initialClaim = source.slice(claimStart, completionStart);

  assert.match(initialClaim, /status:\s*"processing"/);
  assert.doesNotMatch(initialClaim, /status:\s*"processed"/);
  assert.match(source.slice(completionStart, retryStart), /status:\s*"processed"/);
  assert.match(source.slice(retryStart), /status:\s*"retry"/);
  assert.match(source, /\.lt\("locked_at", leaseCutoff\)/);
  assert.match(source, /\.eq\("locked_by", claim\.ownerId\)/);
});

test("replay response is aggregate-only and AI private auth remains intact", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /\{ success: true, result: messageResult \}/);
  assert.match(source, /accepted:\s*number;[\s\S]*duplicates:\s*number;[\s\S]*inProgress:\s*number;[\s\S]*ignored:\s*number;[\s\S]*failed:\s*number;/);
  assert.match(source, /apikey:\s*supabaseKey,[\s\S]*Authorization:\s*`Bearer \$\{supabaseKey\}`/);
  assert.match(source, /provider_message_id:\s*messageId/);
  assert.match(
    source,
    /!conversation\?\.id \|\| !session\.id \|\|[\s\S]*?!session\.organization_id \|\| !messageId[\s\S]*?AI agent delivery scope is incomplete/,
  );
  assert.match(source, /error:\s*"Webhook processing failed"/);
});

test("outbound echo records first response once with the canonical contract", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const calls = source.match(/\/functions\/v1\/calculate-first-response/g) ?? [];

  assert.equal(calls.length, 1);
  assert.match(
    source,
    /body: JSON\.stringify\(\{\s*lead_id: conversation\.lead_id,\s*channel: "whatsapp",\s*actor_user_id: session\.owner_user_id \|\| null,\s*is_automation: isAutomationMessage,\s*organization_id: session\.organization_id,\s*\}\)/,
  );
  assert.doesNotMatch(source, /external_message_id:\s*messageId/);
});
