import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./index.ts", import.meta.url),
  "utf8",
);

test("ingress is POST/OPTIONS only and authenticates before privileged work", () => {
  assert.doesNotMatch(source, /req\.method === "GET"/);
  assert.match(source, /req\.method === "OPTIONS"/);
  assert.match(source, /req\.method !== "POST"/);
  assert.doesNotMatch(source, /await req\.json\(/);

  const auth = source.indexOf("authorizeEvolutionGoWebhookIngress(req");
  const client = source.indexOf("supabase = createClient(", auth);
  const body = source.indexOf("readBoundedJsonBody<any>(req)", auth);
  const session = source.indexOf("resolveSession(payload, url)", auth);
  assert.ok(auth > 0 && auth < client && client < body && body < session);
});

test("missing or mismatched session state cannot be acknowledged as ignored", () => {
  assert.doesNotMatch(source, /ignored:\s*true/);
  assert.match(source, /Webhook session could not be resolved/);
  assert.match(source, /validateEvolutionGoSessionBinding/);
  assert.match(source, /Webhook session binding failed/);
});

test("internal worker keeps its outer lease while direct callbacks claim locally", () => {
  assert.match(
    source,
    /authorization\.contract !== "internal_worker_lease"[\s\S]{0,1200}claimEvolutionMessageDelivery/,
  );
  assert.match(source, /completeEvolutionMessageDelivery/);
  assert.match(source, /retryEvolutionMessageDelivery/);
});

test("canonical message is terminal only after required effects and awaited AI", () => {
  const effects = source.indexOf("await updateConversationAfterMessage(");
  const autoReply = source.indexOf("await triggerAutoReply(", effects);
  const completion = source.indexOf("await completeStoredMessageEffects(", effects);
  assert.ok(effects > 0 && effects < autoReply && autoReply < completion);
  const cleanup = source.indexOf("await releaseConversationMessageEffect(", completion);
  assert.ok(completion < cleanup);
  assert.doesNotMatch(source, /scheduleAutoReply/);
  assert.match(source, /storedEvolutionGoEffectState/);
  assert.match(source, /no recoverable effect ledger/);
  assert.match(source, /effect ledger is saturated/);
});

test("conversation and inbound-log writes fail closed", () => {
  assert.match(source, /const \{ data, error \} = await updateQuery/);
  assert.match(source, /if \(error\) throw error;/);
  assert.match(
    source,
    /const \{ error \} = await supabase\.from\("whatsapp_inbound_logs"\)\.insert/,
  );
  assert.match(source, /whatsapp_inbound_logs_pkey/);
});

test("Evolution Go Info/Message envelopes remain recognized", () => {
  assert.match(source, /value\.Info/);
  assert.match(source, /value\.Message/);
  assert.match(source, /payload\?\.Message/);
  assert.match(source, /data\?\.Message/);
});
