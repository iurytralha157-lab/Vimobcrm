import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

async function readRepositoryFile(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8')
}

function ordered(source, markers) {
  let previous = -1
  for (const marker of markers) {
    const current = source.indexOf(marker)
    assert.ok(current > previous, `expected ${JSON.stringify(marker)} after the previous security boundary`)
    previous = current
  }
}

test('message sender allows only CORS preflight and authenticated POST', async () => {
  const source = await readRepositoryFile('supabase/functions/message-sender/index.ts')
  const handler = source.slice(source.indexOf('Deno.serve(async (req) =>'))

  assert.match(source, /Access-Control-Allow-Methods": "POST, OPTIONS"/)
  assert.match(source, /if \(req\.method === "OPTIONS"\)/)
  assert.match(source, /if \(req\.method !== "POST"\)/)
  assert.match(source, /"Allow": "POST, OPTIONS"/)
  assert.match(source, /authorizePrivateWorkerRequest\(req, secretEnvironment\)/)
  assert.doesNotMatch(source, /await req\.json\(/)

  ordered(handler, [
    'if (req.method !== "POST")',
    'authorizePrivateWorkerRequest(req, secretEnvironment)',
    'const supabase = createClient(',
    '.from("outbox_messages")',
  ])
})

test('message sender leases pending and stale candidates with snapshot CAS before provider effects', async () => {
  const source = await readRepositoryFile('supabase/functions/message-sender/index.ts')
  const loopStart = source.indexOf('for (const candidate of pendingCandidates)')
  const providerCall = source.indexOf('const data = provider === "evolution_go"', loopStart)
  const claim = source.slice(loopStart, providerCall)

  assert.ok(loopStart >= 0)
  assert.ok(providerCall > loopStart)
  assert.match(claim, /status: "processing"/)
  assert.match(claim, /attempts: pendingPlan\.nextAttempts/)
  assert.match(claim, /processed_at: leaseTimestamp/)
  assert.match(claim, /error_message: leaseMarker/)
  assert.match(claim, /\.eq\("id", candidate\.id\)[\s\S]*\.eq\("status", "pending"\)/)
  assert.match(claim, /applyOutboxSnapshotFilters\(claimQuery, candidate\)/)
  assert.match(claim, /if \(!message\)[\s\S]*claim_conflicts \+= 1;[\s\S]*continue;/)
  assert.ok(
    claim.indexOf('ownedMessages.push') < claim.indexOf('provider = normalizeProvider'),
    'provider selection must happen only after a conditional claim returned a row',
  )

  assert.match(source, /\.eq\("status", "processing"\)[\s\S]*applyOutboxSnapshotFilters\([\s\S]*currentLeaseSnapshot/)
  assert.match(source, /status: "sent"[\s\S]*sentOutboxQuery = applyOutboxSnapshotFilters/)
  assert.match(source, /status: isFinalAttempt \? "failed" : "pending"[\s\S]*retryStateQuery = applyOutboxSnapshotFilters/)
  assert.match(source, /\.order\("processed_at", \{ ascending: true, nullsFirst: true \}\)[\s\S]*\.order\("created_at"[\s\S]*\.order\("id"/)
  assert.match(source, /\.order\("created_at", \{ ascending: true \}\)[\s\S]*\.order\("id", \{ ascending: true \}\)/)
})

test('provider ambiguity never returns to pending and legacy ambiguity is terminal', async () => {
  const source = await readRepositoryFile('supabase/functions/message-sender/index.ts')
  const acceptedStart = source.indexOf('if (providerAccepted || error instanceof ProviderOutcomeUnknownError)')
  const finalAttemptStart = source.indexOf('const failedAttemptPlan', acceptedStart)
  const acceptedBranch = source.slice(acceptedStart, finalAttemptStart)

  assert.ok(acceptedStart >= 0)
  assert.ok(finalAttemptStart > acceptedStart)
  assert.match(acceptedBranch, /planUncertainOutcome/)
  assert.match(acceptedBranch, /status: "failed"/)
  assert.match(acceptedBranch, /manualReconciliationMessage/)
  assert.match(acceptedBranch, /\.eq\("status", "processing"\)/)
  assert.doesNotMatch(acceptedBranch, /status:\s*"pending"/)
  assert.doesNotMatch(acceptedBranch, /retain-for-stale-recovery/)
  assert.match(source, /const sentMessageId = getSentMessageId\(data\) \|\| stableProviderRequestId/)
  assert.ok((source.match(/throw new ProviderOutcomeUnknownError\(/g)?.length || 0) >= 5)
  assert.match(source, /providerAccepted \|\| error instanceof ProviderOutcomeUnknownError/)
  assert.equal(source.match(/isAmbiguousProviderFailure\(response\.status\)/g)?.length, 3)
  assert.match(source, /const providerStatus = data\?\.status \?\? response\.status[\s\S]*isAmbiguousProviderFailure\(providerStatus\)/)
})

test('provider request uses the existing outbox key deterministically through the private proxy', async () => {
  const [source, goProvider, edgeProxy] = await Promise.all([
    readRepositoryFile('supabase/functions/message-sender/index.ts'),
    readRepositoryFile('apps/api/internal/whatsapp/evolution_go.go'),
    readRepositoryFile('supabase/functions/evolution-go-proxy/index.ts'),
  ])

  assert.match(source, /message\?\.client_message_id \|\| message\?\.id/)
  assert.match(source, /crypto\.subtle\.digest\([\s\S]*"SHA-256"/)
  assert.match(source, /new Uint8Array\(digest\)\.slice\(0, 16\)/)
  assert.match(source, /\.toUpperCase\(\)/)
  assert.equal(source.match(/\bid: stableProviderRequestId/g)?.length, 2)
  assert.match(goProvider, /"id":\s+firstPresentAny\(body\["id"\], body\["messageId"\], body\["clientMessageId"\]\)/)

  const proxyCommonStart = edgeProxy.indexOf('function sendCommonBody')
  const proxyCommonEnd = edgeProxy.indexOf('function sendTextBody', proxyCommonStart)
  const proxyCommon = edgeProxy.slice(proxyCommonStart, proxyCommonEnd)
  assert.match(proxyCommon, /id:\s*providerMessageId\(body, allowProviderMessageId\)/)
  assert.match(source, /makeDispatchingLeaseMarker\([\s\S]*stableProviderRequestId/)
})

test('logical client-message duplicates have one deterministic owner before any provider effect', async () => {
  const source = await readRepositoryFile('supabase/functions/message-sender/index.ts')
  const ownerStart = source.indexOf('async function assertDeterministicLogicalOwner')
  const ownerEnd = source.indexOf('async function findMessageHistory', ownerStart)
  const ownerContract = source.slice(ownerStart, ownerEnd)
  const loopStart = source.indexOf('for (const owned of ownedMessages)')
  const providerCall = source.indexOf('const data = provider === "evolution_go"', loopStart)
  const ownedFlow = source.slice(loopStart, providerCall)

  assert.ok(ownerStart >= 0)
  assert.ok(ownerEnd > ownerStart)
  assert.match(ownerContract, /\.eq\("organization_id", message\.organization_id\)/)
  assert.match(ownerContract, /\.eq\("session_id", message\.session_id\)/)
  assert.match(ownerContract, /\.eq\("client_message_id", message\.client_message_id\)/)
  assert.match(ownerContract, /\.order\("created_at", \{ ascending: true \}\)/)
  assert.match(ownerContract, /\.order\("id", \{ ascending: true \}\)/)
  assert.match(ownerContract, /owner\.id !== message\.id/)
  assert.match(ownerContract, /duplicate-logical-outbox-owner/)
  assert.match(ownerContract, /lacks a composite[\s\S]*migration is required/)

  ordered(ownedFlow, [
    'await assertDeterministicLogicalOwner(supabase, message)',
    'await ensurePendingMessageHistory(',
    'makeDispatchingLeaseMarker(',
  ])
  assert.match(source, /error instanceof ManualReconciliationRequiredError[\s\S]*status: "failed"/)
  assert.match(source, /error\.reason === "duplicate-logical-outbox-owner"[\s\S]*summary\.duplicates \+= 1/)
})

test('pending and sent CRM history are durable before dispatch and outbox completion', async () => {
  const source = await readRepositoryFile('supabase/functions/message-sender/index.ts')
  const loopStart = source.indexOf('for (const owned of ownedMessages)')
  const secondaryStart = source.indexOf('// Update conversation', loopStart)
  const deliveryFlow = source.slice(loopStart, secondaryStart)

  ordered(deliveryFlow, [
    'await ensurePendingMessageHistory(',
    'makeDispatchingLeaseMarker(',
    'const data = provider === "evolution_go"',
    'providerAccepted = true',
    'await markMessageHistorySent(',
    'let sentOutboxQuery = supabase',
    'deliveryCommitted = true',
  ])
  assert.match(source, /status: "pending"/)
  assert.match(source, /markMessageHistorySent[\s\S]*provider_message_id: sentMessageId/)
  assert.match(source, /HistoryProjectionAfterProviderError/)
  assert.match(source, /provider-accepted-history-not-confirmed/)
  assert.match(source, /provider-accepted-outbox-sent-not-confirmed/)
  assert.doesNotMatch(source, /Sent to WhatsApp but CRM history failed/)
})

test('Evolution Go deterministic id is never treated as an automatic-retry receipt', async () => {
  const [source, leaseSource] = await Promise.all([
    readRepositoryFile('supabase/functions/message-sender/index.ts'),
    readRepositoryFile('supabase/functions/message-sender/lease.ts'),
  ])

  assert.match(source, /correlation[\s\S]*not a durable provider receipt/)
  assert.match(source, /ProviderOutcomeUnknownError is terminal for every[\s\S]*never requeued or redispatched/)
  assert.doesNotMatch(source, /retain-for-stale-recovery|idempotent-provider-retry/)
  assert.match(leaseSource, /correlation key, not a durable delivery[\s\S]*must fail closed/)
  assert.match(leaseSource, /evolution-go-provider-ambiguous/)
})

test('multi-tenant worker returns only aggregate counters and scopes message projections', async () => {
  const source = await readRepositoryFile('supabase/functions/message-sender/index.ts')
  const aggregateStart = source.indexOf('// Deliberately aggregate the response')
  const aggregateReturn = source.indexOf('return jsonResponse({', aggregateStart)
  const aggregateEnd = source.indexOf('} catch (error)', aggregateStart)
  const aggregateResponse = source.slice(aggregateReturn, aggregateEnd)

  assert.match(source, /message\.session\?\.organization_id !== message\.organization_id/)
  assert.match(source, /message\.conversation\?\.organization_id !== message\.organization_id/)
  assert.match(source, /const activityRows = activeExecs\.map[\s\S]*organization_id: messageOrganizationId[\s\S]*lead_id: convData\.lead_id/)
  assert.match(source, /\.eq\("organization_id", messageOrganizationId\)[\s\S]*\.eq\("session_id", message\.session_id\)[\s\S]*\.eq\("client_message_id", message\.client_message_id\)/)
  assert.ok(aggregateStart >= 0)
  assert.ok(aggregateReturn > aggregateStart)
  assert.doesNotMatch(aggregateResponse, /message_id|sent_message_id|content|error_message|results/)
  for (const counter of [
    'processed',
    'sent',
    'retried',
    'failed',
    'uncertain',
    'duplicates',
    'manual_reconciliation_audit_errors',
  ]) {
    assert.match(aggregateResponse, new RegExp(`\\b${counter}:`))
  }
})

test('both existing internal callers keep their POST legacy-service-role contract', async () => {
  const callers = await Promise.all([
    readRepositoryFile('supabase/functions/ai-agent-responder/index.ts'),
    readRepositoryFile('supabase/functions/generic-webhook/index.ts'),
  ])

  for (const caller of callers) {
    const callStart = caller.indexOf('/functions/v1/message-sender')
    assert.ok(callStart >= 0)
    const call = caller.slice(callStart, callStart + 500)
    assert.match(call, /method:\s*["']POST["']/)
    assert.match(call, /Authorization:\s*`Bearer \$\{[^}]+\}`/)
    assert.match(call, /body:\s*JSON\.stringify\(/)
  }
})
