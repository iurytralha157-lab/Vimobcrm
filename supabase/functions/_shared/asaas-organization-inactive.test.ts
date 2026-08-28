import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const checkoutSource = readFileSync(
  new URL("../asaas-create-charge/index.ts", import.meta.url),
  "utf8",
);
const cancellationSource = readFileSync(
  new URL("../asaas-cancel-payment/index.ts", import.meta.url),
  "utf8",
);
const recurrenceSource = readFileSync(
  new URL("./asaas-card-recurrence.ts", import.meta.url),
  "utf8",
);
const recurrenceWorkerSource = readFileSync(
  new URL("../asaas-card-recurrence-worker/index.ts", import.meta.url),
  "utf8",
);
const billingMigrationSource = readFileSync(
  new URL(
    "../../migrations/20260804101153_secure_billing_payment_checkout_capabilities.sql",
    import.meta.url,
  ),
  "utf8",
);

function sqlFunctionDefinitions(qualifiedName: string) {
  const marker = `create or replace function ${qualifiedName}(`;
  const definitions: string[] = [];
  let cursor = 0;
  while (cursor < billingMigrationSource.length) {
    const start = billingMigrationSource.indexOf(marker, cursor);
    if (start < 0) break;
    const next = billingMigrationSource.indexOf(
      "\ncreate or replace function ",
      start + marker.length,
    );
    definitions.push(
      billingMigrationSource.slice(
        start,
        next < 0 ? billingMigrationSource.length : next,
      ),
    );
    cursor = start + marker.length;
  }
  return definitions;
}

test("inactive organizations never turn payment claims into RECOVERING", () => {
  const mutationLeaseStart = checkoutSource.indexOf(
    "function paymentMutationLeaseResponse",
  );
  const mutationLeaseEnd = checkoutSource.indexOf(
    "async function updateActiveSubscriptionCreditCard",
    mutationLeaseStart,
  );
  const mutationLease = checkoutSource.slice(
    mutationLeaseStart,
    mutationLeaseEnd,
  );
  assert.ok(mutationLeaseStart >= 0 && mutationLeaseEnd > mutationLeaseStart);
  assert.ok(
    mutationLease.indexOf("billingOrganizationIsUnavailable(attempt)") <
      mutationLease.indexOf('attempt.outcome === "busy"'),
  );

  const cardClaim = checkoutSource.indexOf(
    "const attempt = await claimBillingPaymentCheckoutAttempt({",
  );
  const cardBusy = checkoutSource.indexOf(
    'if (attempt.outcome === "busy")',
    cardClaim,
  );
  const cardInactive = checkoutSource.indexOf(
    "billingOrganizationIsUnavailable(attempt)",
    cardClaim,
  );
  assert.ok(
    cardClaim >= 0 && cardInactive > cardClaim && cardInactive < cardBusy,
  );
});

test("inactive Pix restoration is terminal before provider restore or retry copy", () => {
  const restoreStart = checkoutSource.indexOf(
    "async function restoreDeletedPixPayment",
  );
  const restoreEnd = checkoutSource.indexOf(
    "async function reconcileChangedPaymentSnapshot",
    restoreStart,
  );
  const restore = checkoutSource.slice(restoreStart, restoreEnd);
  const claim = restore.indexOf("await claimBillingPaymentRestore({");
  const inactive = restore.indexOf("billingOrganizationIsUnavailable(claim)");
  const genericRecovery = restore.indexOf(
    '!["claimed", "recover_only"].includes(claim.outcome)',
  );
  const providerMutation = restore.indexOf(
    "`/payments/${encodeURIComponent(input.payment.id)}/restore`",
  );

  assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
  assert.ok(claim >= 0 && inactive > claim && inactive < genericRecovery);
  assert.ok(providerMutation > inactive);
});

test("inactive credential stores become a terminal checkout response", () => {
  const cardStore = checkoutSource.indexOf(
    "storeBillingCardRecurrenceCredential({",
  );
  const cardUnavailable = checkoutSource.indexOf(
    "billingOrganizationIsUnavailable(stored)",
    cardStore,
  );
  const subscriptionStore = checkoutSource.indexOf(
    "storeBillingSubscriptionCardUpdateCredential({",
  );
  const subscriptionUnavailable = checkoutSource.indexOf(
    "billingOrganizationIsUnavailable(stored)",
    subscriptionStore,
  );

  assert.ok(cardStore >= 0 && cardUnavailable > cardStore);
  assert.ok(
    subscriptionStore >= 0 && subscriptionUnavailable > subscriptionStore,
  );
  assert.match(
    checkoutSource,
    /error instanceof BillingOrganizationUnavailableError[\s\S]*?billingOrganizationUnavailableResponse\("CREDIT_CARD"\)/,
  );
});

test("saved-card update authorization precedes customer mutation", () => {
  const updateStart = checkoutSource.indexOf(
    "async function updateActiveSubscriptionCreditCard(",
  );
  const updateEnd = checkoutSource.indexOf(
    "async function requireActiveAsaasSubscription(",
    updateStart,
  );
  const update = checkoutSource.slice(updateStart, updateEnd);
  const preparation = update.indexOf(
    "prepareBillingSubscriptionCardUpdate({",
  );
  const inactive = update.indexOf(
    "billingOrganizationIsUnavailable(preparation)",
    preparation,
  );
  const customerMutation = update.indexOf("prepareAsaasCustomer(", inactive);

  assert.ok(updateStart >= 0 && updateEnd > updateStart);
  assert.ok(preparation >= 0 && inactive > preparation);
  assert.ok(customerMutation > inactive);
});

test("inactive payment cancellation worker stops before provider DELETE", () => {
  const processStart = recurrenceWorkerSource.indexOf(
    "async function processPaymentCancellationJob(",
  );
  const processEnd = recurrenceWorkerSource.indexOf(
    "Deno.serve(async (request) =>",
    processStart,
  );
  const process = recurrenceWorkerSource.slice(processStart, processEnd);
  const marker = process.indexOf(
    "markBillingPaymentCheckoutCancellationDeleteStarted(",
  );
  const inactive = process.indexOf(
    "billingOrganizationIsUnavailable(deleteStart)",
    marker,
  );
  const providerMutation = process.indexOf(
    "`/payments/${encodeURIComponent(job.provider_payment_id)}`",
    inactive,
  );

  assert.ok(processStart >= 0 && processEnd > processStart);
  assert.ok(marker >= 0 && inactive > marker);
  assert.ok(providerMutation > inactive);
});

test("inactive cancellation claims are terminal before transient busy handling", () => {
  const inactiveClaims = cancellationSource.match(
    /billingOrganizationIsUnavailable\(claim\)/g,
  ) || [];
  assert.equal(inactiveClaims.length, 2);
  assert.match(
    cancellationSource,
    /claimBillingSubscriptionCheckoutCancellation\([\s\S]*?billingOrganizationIsUnavailable\(claim\)[\s\S]*?claim\.outcome === "busy"/,
  );
  assert.match(
    cancellationSource,
    /claimBillingPaymentCheckoutCancellation\([\s\S]*?billingOrganizationIsUnavailable\(claim\)[\s\S]*?claim\.outcome === "busy"/,
  );
});

test("inactive recurrence is terminal instead of recurrence_recovering", () => {
  const claimStart = recurrenceSource.indexOf(
    "claim = input.claim || await claimBillingCardRecurrence({",
  );
  const inactive = recurrenceSource.indexOf(
    "billingOrganizationIsUnavailable(claim)",
    claimStart,
  );
  const busy = recurrenceSource.indexOf(
    'claim.outcome === "busy"',
    claimStart,
  );

  assert.ok(claimStart >= 0 && inactive > claimStart && inactive < busy);
  assert.match(
    recurrenceSource.slice(inactive, busy),
    /processing: false,[\s\S]*code: "organization_inactive"/,
  );
});

test("inactive subscription card update stops before the provider PUT", () => {
  const processStart = recurrenceWorkerSource.indexOf(
    "async function processSubscriptionCardUpdateJob(",
  );
  const processEnd = recurrenceWorkerSource.indexOf(
    "async function processCreateJob(",
    processStart,
  );
  const process = recurrenceWorkerSource.slice(processStart, processEnd);
  const marker = process.indexOf(
    "markBillingSubscriptionCardUpdateProviderRequestStarted({",
  );
  const inactive = process.indexOf(
    "billingOrganizationIsUnavailable(marker)",
    marker,
  );
  const providerMutation = process.indexOf(
    "`/subscriptions/${",
    inactive,
  );

  assert.ok(processStart >= 0 && processEnd > processStart);
  assert.ok(marker >= 0 && inactive > marker);
  assert.ok(providerMutation > inactive);
});

test("every outbound SQL provider fence locks the organization and fails closed", () => {
  const fences = new Map<string, string>([
    ["public.store_billing_card_recurrence_credential", "stored"],
    ["public.mark_billing_card_capture_request_started", "started"],
    ["public.claim_billing_card_recurrence", "claimed"],
    [
      "public.mark_billing_card_recurrence_provider_request_started",
      "started",
    ],
    [
      "public.mark_billing_payment_checkout_cancellation_delete_started",
      "proceed",
    ],
    ["public.store_billing_subscription_card_update_credential", "stored"],
    [
      "public.mark_billing_subscription_card_update_capture_started",
      "proceed",
    ],
    [
      "public.mark_billing_subscription_card_update_provider_request_started",
      "proceed",
    ],
  ]);

  for (const [name, successOutcome] of fences) {
    const definitions = sqlFunctionDefinitions(name);
    assert.ok(definitions.length > 0, `${name} must exist`);
    for (const definition of definitions) {
      if (
        /language sql[\s\S]*?select public\.store_billing_card_recurrence_credential\(/i
          .test(definition)
      ) {
        continue;
      }
      const organizationLock = definition.search(
        /from public\.organizations[\s\S]*?for update/i,
      );
      const unavailable = definition.search(
        /'outcome'\s*,\s*'organization_inactive'/i,
      );
      const success = definition.search(
        new RegExp(`'outcome'\\s*,\\s*'${successOutcome}'`, "i"),
      );
      assert.ok(organizationLock >= 0, `${name} must lock the organization`);
      assert.ok(
        unavailable > organizationLock,
        `${name} must fail closed after the organization lock`,
      );
      assert.ok(
        success > unavailable,
        `${name} must reject inactivity before authorizing provider work`,
      );
    }
  }
});

test("inbound webhook reconciliation is not discarded for inactive tenants", () => {
  const definitions = sqlFunctionDefinitions(
    "public.reconcile_asaas_payment_webhook",
  );
  assert.equal(definitions.length, 1);
  assert.doesNotMatch(
    definitions[0],
    /'outcome'\s*,\s*'organization_inactive'/i,
  );
});
