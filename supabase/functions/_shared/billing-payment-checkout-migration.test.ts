import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL(
    "../../migrations/20260804101153_secure_billing_payment_checkout_capabilities.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

function isolateFunction(name: string) {
  const startMarker = `create or replace function ${name}`;
  const start = source.indexOf(startMarker);
  const endMarker = "$function$;";
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing function terminator for ${name}`);
  return source.slice(start, end + endMarker.length);
}

test("capabilities persist a frozen plan, period and amount snapshot", () => {
  for (
    const fragment of [
      "plan_id uuid not null",
      "billing_period_months integer not null",
      "amount numeric(10, 2) not null",
      "snapshot_source text not null",
      "snapshot_source in ('intent', 'subscription', 'legacy_catalog')",
      "foreign key (plan_id) references public.admin_subscription_plans (id)",
    ]
  ) {
    assert.match(source, new RegExp(fragment.replace(/[()]/g, "\\$&")));
  }

  const resolver = isolateFunction(
    "public.resolve_billing_payment_checkout_capability",
  );
  assert.match(resolver, /v_plan_id := v_capability\.plan_id/);
  assert.match(
    resolver,
    /v_billing_period_months := v_capability\.billing_period_months/,
  );
  assert.match(resolver, /v_amount := v_capability\.amount/);
  assert.doesNotMatch(resolver, /admin_subscription_plans/);
  assert.doesNotMatch(resolver, /from private\.billing_checkout_intents/);
});

test("issuance fails closed except for the one-time exact legacy backfill", () => {
  const snapshot = isolateFunction(
    "private.resolve_billing_payment_checkout_snapshot",
  );
  const sync = isolateFunction(
    "private.sync_billing_payment_checkout_capability",
  );
  const ensure = isolateFunction(
    "public.ensure_billing_payment_checkout_capability",
  );
  const backfillStart = source.indexOf(
    "insert into public.billing_payment_checkout_capabilities",
    source.indexOf("create trigger sync_billing_payment_checkout_capability"),
  );
  const backfillEnd = source.indexOf(
    "create or replace function public.resolve_billing_payment_checkout_capability",
    backfillStart,
  );
  const backfill = source.slice(backfillStart, backfillEnd);

  assert.match(snapshot, /payment\.billing_intent_id is not null/);
  assert.match(snapshot, /v_subscription_count = 1/);
  assert.match(snapshot, /v_subscription_count > 1/);
  assert.match(snapshot, /organization_row\.pending_plan_id is null/);
  assert.match(
    snapshot,
    /plan\.price \* organization_row\.subscription_billing_period_months/,
  );
  assert.match(snapshot, /abs\([\s\S]*?\) <= 0\.01/);
  assert.match(sync, /resolve_billing_payment_checkout_snapshot\( new\.id, false \)/);
  assert.match(
    ensure,
    /resolve_billing_payment_checkout_snapshot\( v_payment\.id, false \)/,
  );
  assert.match(backfill, /resolve_billing_payment_checkout_snapshot\( payment\.id, true \)/);
  assert.doesNotMatch(sync, /resolve_billing_payment_checkout_snapshot\( new\.id, true \)/);
  assert.match(ensure, /'outcome', 'payment_not_resolvable'/);
});

test("dunning and canceled boleto remain actionable while refund denied stays settled", () => {
  const actionable = isolateFunction(
    "private.billing_payment_checkout_is_actionable",
  );
  const terminal = isolateFunction(
    "private.billing_payment_checkout_is_terminal",
  );
  const paid = isolateFunction(
    "private.billing_payment_checkout_is_paid",
  );

  assert.match(actionable, /'dunning_requested'/);
  assert.match(actionable, /'dunning_received'/);
  assert.match(actionable, /'bank_slip_cancelled'/);
  assert.doesNotMatch(terminal, /'bank_slip_cancelled'/);
  assert.doesNotMatch(terminal, /'refund_denied'/);
  assert.match(paid, /'refund_denied'/);
  assert.match(terminal, /'reproved_by_risk_analysis'/);
});

test("provider advisory locks precede payment row locks", () => {
  const complete = isolateFunction(
    "private.complete_billing_card_recurrence_locked",
  );
  const reconcile = isolateFunction(
    "public.reconcile_asaas_payment_snapshot",
  );

  for (const body of [complete, reconcile]) {
    const advisory = body.indexOf("private.lock_asaas_billing_resources(");
    const paymentRow = body.indexOf("from public.asaas_payments as payment");
    assert.ok(advisory >= 0, "missing global billing advisory lock");
    assert.ok(paymentRow > advisory, "payment row was locked before advisory keys");
  }
});

test("capability lifetime covers early invoices and overdue reminders", () => {
  assert.doesNotMatch(source, /interval '30 days'/);
  assert.match(source, /default \(now\(\) \+ interval '90 days'\)/);
  assert.ok((source.match(/interval '90 days'/g) || []).length >= 7);
});

test("actionable polling cannot slide or revive an existing bearer", () => {
  const sync = isolateFunction(
    "private.sync_billing_payment_checkout_capability",
  );
  const authorizationGate = sync.indexOf(
    "if not v_issue_authorized then return new; end if;",
  );
  const expiryMutation = sync.indexOf(
    "expires_at = now() + interval '90 days'",
  );

  assert.match(sync, /v_issue_authorized boolean := false/);
  assert.match(
    sync,
    /or not private\.billing_payment_checkout_is_actionable\(old\.status\)/,
  );
  assert.ok(authorizationGate >= 0, "missing absolute-lifetime authorization gate");
  assert.ok(
    expiryMutation > authorizationGate,
    "the bearer lifetime is mutated before the authorization gate",
  );
  assert.match(
    sync,
    /checkout_token = encode\(extensions\.gen_random_bytes\(32\), 'hex'\)/,
  );
  assert.match(sync, /expires_at = least\(expires_at, now\(\) \+ interval '7 days'\)/);
});

test("initial card checkout claims independent durable capability and HMAC-IP limits", () => {
  const claim = isolateFunction(
    "public.claim_organization_checkout_card_attempt",
  );

  assert.match(
    source,
    /create table if not exists private\.billing_organization_checkout_card_attempt_limits/,
  );
  assert.match(
    source,
    /create table if not exists private\.billing_ip_card_attempt_limits/,
  );
  assert.match(claim, /v_checkout_token !~ '\^\[0-9a-f\]\{32\}\$'/);
  assert.match(claim, /v_ip_fingerprint !~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(
    claim,
    /from public\.organization_checkout_capabilities as capability/,
  );
  assert.match(
    claim,
    /extensions\.digest\(capability\.checkout_token, 'sha256'\)/,
  );
  assert.match(
    claim,
    /pg_catalog\.pg_advisory_xact_lock\( least\(v_capability_lock_key, v_ip_lock_key\) \)/,
  );
  assert.match(
    claim,
    /pg_catalog\.pg_advisory_xact_lock\( greatest\(v_capability_lock_key, v_ip_lock_key\) \)/,
  );
  assert.match(
    claim,
    /on conflict \(organization_id, capability_hash\) do update/,
  );
  assert.match(claim, /on conflict \(ip_fingerprint\) do update/);
  assert.match(claim, /short_window_count > 5/);
  assert.match(claim, /daily_window_count > 10/);
  assert.match(claim, /short_window_count > 10/);
  assert.match(claim, /daily_window_count > 30/);
  assert.match(claim, /expires_at <= v_now/);
  assert.match(claim, /limit 100 for update skip locked/);
  assert.doesNotMatch(source, /release_organization_checkout_card_attempt/);
});

test("prepared recurrence can be closed idempotently without card data or a lease", () => {
  const failPrepared = isolateFunction(
    "public.fail_prepared_billing_card_recurrence",
  );

  assert.match(
    failPrepared,
    /payment\.id = p_payment_id and payment\.asaas_payment_id = v_provider_payment_id/,
  );
  assert.match(failPrepared, /v_provision\.status = 'completed'/);
  assert.match(failPrepared, /v_provision\.status = 'failed'/);
  assert.match(failPrepared, /v_provision\.status <> 'prepared'/);
  assert.match(failPrepared, /v_provision\.lease_id is not null/);
  assert.match(failPrepared, /last_error = 'prepared_recurrence_not_created'/);
  assert.doesNotMatch(failPrepared, /p_error/);
  assert.doesNotMatch(failPrepared, /credit_card|card_number|cvv|ccv|raw_event/);
});

test("authenticated and payment card guards share an HMAC-IP budget", () => {
  const authenticated = isolateFunction(
    "public.claim_authenticated_organization_card_attempt",
  );
  const payment = isolateFunction(
    "public.claim_billing_payment_card_attempt_guard",
  );
  const ipBucket = isolateFunction(
    "private.increment_billing_ip_card_attempt_limit",
  );

  assert.match(
    source,
    /create table if not exists private\.billing_authenticated_org_card_attempt_limits/,
  );
  assert.match(
    source,
    /create table if not exists private\.billing_payment_card_attempt_limits/,
  );
  assert.match(authenticated, /from public\.organization_members as membership/);
  assert.match(authenticated, /permission_override\.permission_key = 'settings_billing'/);
  assert.match(authenticated, /from public\.user_organization_roles as user_role/);
  assert.match(authenticated, /permission\.key = 'settings_billing'/);
  assert.match(authenticated, /v_ip_fingerprint !~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(authenticated, /on conflict \(organization_id, actor_user_id\) do update/);
  assert.match(payment, /payment\.id = p_payment_id and payment\.asaas_payment_id = v_provider_payment_id/);
  assert.match(payment, /billing_payment_checkout_is_resolvable\(v_payment\.id\)/);
  assert.match(payment, /on conflict \(payment_id\) do update/);
  assert.match(payment, /daily_window_count > 10/);
  assert.match(payment, /private\.increment_billing_ip_card_attempt_limit/);
  assert.match(ipBucket, /on conflict \(ip_fingerprint\) do update/);
  assert.match(ipBucket, /daily_window_started_at/);
  assert.doesNotMatch(source, /release_billing_payment_card_attempt_guard/);
  assert.doesNotMatch(source, /release_authenticated_organization_card_attempt/);
});

test("all reconciliation callers cross the exact immutable payment gate", () => {
  const exact = isolateFunction(
    "private.apply_asaas_billing_snapshot_with_payment",
  );
  const method = isolateFunction(
    "public.reconcile_asaas_payment_method_change",
  );

  const paymentLock = exact.indexOf("from public.asaas_payments as payment");
  const persist = exact.indexOf(
    "private.persist_asaas_billing_snapshot_after_exact_validation(",
  );
  assert.ok(paymentLock >= 0, "missing exact local payment lock");
  assert.ok(persist > paymentLock, "billing apply runs before exact payment validation");
  assert.match(exact, /'outcome', 'payment_not_found'/);
  assert.match(exact, /'field', 'customer'/);
  assert.match(exact, /'field', 'subscription'/);
  assert.match(exact, /v_payment\.value is distinct from p_latest_payment_amount/);
  assert.match(exact, /v_intent\.amount is distinct from p_latest_payment_amount/);
  assert.match(exact, /p_latest_payment_due_date is null/);

  assert.match(method, /v_old_billing_type = v_new_billing_type/);
  assert.match(method, /'confirmed', 'received', 'received_in_cash'/);
  assert.match(method, /'outcome', 'amount_mismatch'/);
  assert.match(method, /'outcome', 'snapshot_mismatch'/);
  assert.match(method, /apply_asaas_billing_snapshot_with_payment/);
  assert.match(method, /billing_type = v_new_billing_type/);
  assert.match(method, /and upper\(btrim\(coalesce\(payment\.billing_type, ''\)\)\) = v_old_billing_type/);
});

test("recurrence persists only a one-time Edge-sealed credential", () => {
  const prepare = isolateFunction(
    "public.prepare_billing_card_recurrence",
  );
  const store = isolateFunction(
    "public.store_billing_card_recurrence_credential",
  );
  const claim = isolateFunction("public.claim_billing_card_recurrence");
  const claimByProvider = isolateFunction(
    "public.claim_billing_card_recurrence_by_provider_payment",
  );
  const terminalCleanup = isolateFunction(
    "private.clear_billing_card_recurrence_credential_on_failure",
  );

  assert.match(source, /provider_card_credential text/);
  assert.match(source, /card_last4 text/);
  assert.match(source, /provider_card_credential ~ '\^v1\[\.\]\[a-za-z0-9\._-\]\+\$'/);
  assert.match(store, /p_credential_ciphertext text/);
  assert.match(store, /v_credential !~ '\^v1\[\.\]\[a-za-z0-9\._-\]\+\$'/);
  assert.match(store, /v_card_last4 !~ '\^\[0-9\]\{4\}\$'/);
  assert.doesNotMatch(
    store,
    /p_remote_ip|p_card_number|p_cvv|p_ccv|p_provider_card_token/,
  );
  assert.match(claim, /if v_provision\.provider_card_credential is null/);
  assert.match(claim, /provider_card_credential = null/);
  assert.match(claim, /'provider_card_credential', v_provision\.provider_card_credential/);
  assert.match(claimByProvider, /where payment\.asaas_payment_id = v_provider_payment_id/);
  assert.match(claimByProvider, /public\.claim_billing_card_recurrence/);
  assert.match(
    claimByProvider,
    /\|\| jsonb_build_object\('payment_id', v_payment_id\)/,
  );
  assert.match(
    prepare,
    /'credential_stored', v_provision\.provider_card_credential is not null/,
  );
  assert.match(terminalCleanup, /credit_card_capture_refused/);
  assert.match(terminalCleanup, /billing_payment_checkout_is_terminal/);
  assert.match(terminalCleanup, /provider_card_credential = null/);
});

test("initial-payment reversal exposes one exact completed recurrence target", () => {
  const reversal = isolateFunction(
    "public.get_billing_card_recurrence_reversal_target",
  );
  const advisory = reversal.indexOf("private.lock_asaas_billing_resources(");
  const paymentRow = reversal.indexOf("from public.asaas_payments as payment");

  assert.ok(advisory >= 0, "missing reversal advisory lock");
  assert.ok(paymentRow > advisory, "reversal payment row was locked before provider keys");
  assert.match(
    reversal,
    /where provision\.provider_payment_id = v_provider_payment_id/,
  );
  assert.match(reversal, /v_provision\.status <> 'completed'/);
  assert.match(
    reversal,
    /private\.billing_payment_checkout_is_reversal\(v_payment_status\)/,
  );
  for (
    const field of [
      "provider_subscription_id",
      "provider_customer_id",
      "external_reference",
      "amount",
      "billing_period_months",
      "next_due_date",
    ]
  ) {
    assert.match(reversal, new RegExp(`'${field}'`));
  }
  assert.doesNotMatch(reversal, /provider_subscription_snapshot|raw_event/);
});

test("organization membership accepts the canonical invitation roles", () => {
  assert.match(
    source,
    /check \(lower\(btrim\(role\)\) in \('owner', 'admin', 'manager', 'user'\)\)/,
  );
});

test("boleto cancellation and card recurrence expose only sanitized state", () => {
  const resolver = isolateFunction(
    "public.resolve_billing_payment_checkout_capability",
  );
  const organizationCheckout = isolateFunction(
    "public.get_billing_checkout_state",
  );
  const bankSlipTrigger = isolateFunction(
    "private.sync_asaas_bank_slip_registration_state",
  );

  assert.match(source, /bank_slip_registration_cancelled_at timestamptz/);
  assert.match(source, /bank_slip_registration_cancelled_due_date date/);
  assert.match(bankSlipTrigger, /payment_bank_slip_cancelled/);
  assert.match(
    bankSlipTrigger,
    /new\.due_date is distinct from old\.bank_slip_registration_cancelled_due_date/,
  );
  assert.match(resolver, /'bank_slip_registration_cancelled'/);
  assert.match(resolver, /'bank_slip_registration_cancelled_at'/);
  assert.match(resolver, /'bank_slip_registration_cancelled_due_date'/);
  assert.match(resolver, /'card_recurrence_status'/);
  assert.doesNotMatch(resolver, /raw_event/);
  assert.doesNotMatch(resolver, /last_error/);
  assert.doesNotMatch(resolver, /lease_id/);
  assert.match(organizationCheckout, /'bank_slip_registration_cancelled'/);
  assert.match(
    organizationCheckout,
    /'bank_slip_registration_cancelled_due_date'/,
  );
  assert.doesNotMatch(organizationCheckout, /raw_event/);
});

test("new helpers remain owner/backend-only with hardened search paths", () => {
  for (
    const signature of [
      "private.resolve_billing_payment_checkout_snapshot(uuid, boolean)",
      "private.billing_payment_checkout_is_resolvable(uuid)",
      "private.billing_payment_checkout_is_reversal(text)",
      "private.sync_asaas_bank_slip_registration_state()",
    ]
  ) {
    assert.match(
      source,
      new RegExp(
        `revoke all on function ${signature.replace(/[()]/g, "\\$&")} from public, anon, authenticated, service_role`,
      ),
    );
  }

  for (
    const signature of [
      "public.claim_organization_checkout_card_attempt(uuid, text, text)",
      "public.claim_authenticated_organization_card_attempt(uuid, uuid, text)",
      "public.claim_billing_payment_card_attempt_guard(uuid, text, text)",
      "public.store_billing_card_recurrence_credential(uuid, text, text, text)",
      "public.claim_billing_card_recurrence_by_provider_payment(text)",
      "public.get_billing_card_recurrence_reversal_target(text)",
      "public.fail_prepared_billing_card_recurrence(uuid, text)",
      "public.get_billing_checkout_state(uuid)",
    ]
  ) {
    assert.match(
      source,
      new RegExp(
        `revoke all on function ${signature.replace(/[()]/g, "\\$&")} from public, anon, authenticated, service_role`,
      ),
    );
    assert.match(
      source,
      new RegExp(
        `grant execute on function ${signature.replace(/[()]/g, "\\$&")} to service_role`,
      ),
    );
  }

  for (
    const name of [
      "private.resolve_billing_payment_checkout_snapshot",
      "private.billing_payment_checkout_is_resolvable",
      "private.sync_asaas_bank_slip_registration_state",
      "private.increment_billing_ip_card_attempt_limit",
      "private.clear_billing_card_recurrence_credential_on_failure",
      "public.claim_organization_checkout_card_attempt",
      "public.claim_authenticated_organization_card_attempt",
      "public.claim_billing_payment_card_attempt_guard",
      "public.store_billing_card_recurrence_credential",
      "public.claim_billing_card_recurrence_by_provider_payment",
      "public.get_billing_card_recurrence_reversal_target",
      "public.fail_prepared_billing_card_recurrence",
      "public.get_billing_checkout_state",
    ]
  ) {
    assert.match(isolateFunction(name), /security definer set search_path = ''/);
  }
});
