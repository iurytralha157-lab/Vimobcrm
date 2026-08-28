import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildCheckoutPaymentPath,
  isBillingPaymentCheckoutActionable,
  parseCheckoutPaymentMethod,
  resolveBillingPaymentStatus,
  resolveCardRecurrenceState,
  shouldTreatHistoryStatusAsCurrent,
} from "./checkout-ui-state";

const checkoutToken = "a".repeat(64);

test("aceita somente os meios de pagamento suportados pelo checkout", () => {
  assert.equal(parseCheckoutPaymentMethod("pix"), "PIX");
  assert.equal(parseCheckoutPaymentMethod(" BOLETO "), "BOLETO");
  assert.equal(parseCheckoutPaymentMethod("credit_card"), "CREDIT_CARD");
  assert.equal(parseCheckoutPaymentMethod("asaas"), null);
  assert.equal(parseCheckoutPaymentMethod("../checkout"), null);
});

test("cadastro pago navega somente para o checkout interno tokenizado", () => {
  assert.equal(
    buildCheckoutPaymentPath(checkoutToken, "PIX"),
    `/checkout/${checkoutToken}?method=PIX`,
  );
  assert.equal(
    buildCheckoutPaymentPath(checkoutToken, "BOLETO"),
    `/checkout/${checkoutToken}?method=BOLETO`,
  );
  assert.equal(
    buildCheckoutPaymentPath(checkoutToken, "CREDIT_CARD"),
    `/checkout/${checkoutToken}?method=CREDIT_CARD`,
  );
  assert.equal(buildCheckoutPaymentPath("../asaas", "PIX"), null);
  assert.equal(buildCheckoutPaymentPath("https://evil.example", "PIX"), null);
});

test("nunca confunde pagamento liquidado com recorrencia salva", () => {
  assert.equal(resolveCardRecurrenceState({ recurrence_saved: true }), "saved");
  assert.equal(
    resolveCardRecurrenceState({
      recurrence_saved: false,
      recurrence_processing: true,
    }),
    "processing",
  );
  assert.equal(
    resolveCardRecurrenceState({
      recurrence_saved: false,
      requires_payment_method_update: true,
    }),
    "failed",
  );
  assert.equal(resolveCardRecurrenceState({}), "unknown");
});

test("status em cache ou com refresh falho nunca e tratado como atual", () => {
  assert.equal(
    shouldTreatHistoryStatusAsCurrent({ syncState: "current" }),
    true,
  );
  assert.equal(
    shouldTreatHistoryStatusAsCurrent({ syncState: "cached" }),
    false,
  );
  assert.equal(
    shouldTreatHistoryStatusAsCurrent({
      syncState: "current",
      refreshFailed: true,
    }),
    false,
  );
});

test("status financeiros adversos e de estorno mantem semantica coerente", () => {
  assert.deepEqual(resolveBillingPaymentStatus("REFUND_DENIED"), {
    state: "paid",
    label: "Pago",
    tone: "success",
  });
  assert.deepEqual(resolveBillingPaymentStatus("REPROVED_BY_RISK_ANALYSIS"), {
    state: "refused",
    label: "Recusado",
    tone: "danger",
  });
  assert.equal(
    resolveBillingPaymentStatus("REFUND_IN_PROGRESS").state,
    "refund_processing",
  );
  assert.equal(resolveBillingPaymentStatus("REFUNDED").state, "refunded");
  assert.equal(resolveBillingPaymentStatus("CHARGEBACK").state, "chargeback");
  assert.equal(resolveBillingPaymentStatus("PROCESSING").state, "processing");
  assert.equal(resolveBillingPaymentStatus("CANCELLED").state, "cancelled");
});

test("checkout so e liberado para cobranca realmente pagavel", () => {
  for (const status of [
    "PENDING",
    "OVERDUE",
    "CREDIT_CARD_CAPTURE_REFUSED",
    "REPROVED_BY_RISK_ANALYSIS",
  ]) {
    assert.equal(isBillingPaymentCheckoutActionable(status), true, status);
  }

  for (const status of [
    "REFUND_DENIED",
    "PROCESSING",
    "REFUND_IN_PROGRESS",
    "REFUNDED",
    "CHARGEBACK",
    "CANCELLED",
  ]) {
    assert.equal(isBillingPaymentCheckoutActionable(status), false, status);
  }

  assert.equal(isBillingPaymentCheckoutActionable("BANK_SLIP_CANCELLED"), true);
});

test("troca de identidade do checkout remonta e descarta respostas assíncronas antigas", () => {
  const pageSource = readFileSync(
    resolve(process.cwd(), "app/checkout/[token]/page.tsx"),
    "utf8",
  );
  const screenSource = readFileSync(
    resolve(
      process.cwd(),
      "components/features/auth/screens/CheckoutScreen.tsx",
    ),
    "utf8",
  );

  assert.match(pageSource, /key=\{`payment:\$\{token\}`\}/);
  assert.match(pageSource, /checkoutToken=\{token\}/);
  assert.doesNotMatch(screenSource, /useParams/);
  assert.match(screenSource, /<CheckoutContent[\s\S]*key=\{identity\}/);
  assert.match(screenSource, /checkoutLoadGenerationRef/);

  const checkoutRead = screenSource.indexOf("await readCheckoutInfo()");
  const generationFence = screenSource.indexOf(
    "if (!isCurrentGeneration()) return;",
    checkoutRead,
  );
  const infoWrite = screenSource.indexOf("setInfo(data)", checkoutRead);
  assert.ok(checkoutRead >= 0);
  assert.ok(generationFence > checkoutRead);
  assert.ok(infoWrite > generationFence);

  const profileRead = screenSource.indexOf(
    ".checkoutBillingProfile<CheckoutInfo>(data.organization.id)",
  );
  const profileFence = screenSource.indexOf(
    "if (!isCurrentGeneration()) return;",
    profileRead,
  );
  const profilePIIWrite = screenSource.indexOf("setHolderCpf(", profileRead);
  assert.ok(profileRead >= 0);
  assert.ok(profileFence > profileRead);
  assert.ok(profilePIIWrite > profileFence);
});

test("troca de organizacao remonta o faturamento antes de exibir dados da nova conta", () => {
  const subscriptionSource = readFileSync(
    resolve(
      process.cwd(),
      "components/features/settings/SubscriptionTab.tsx",
    ),
    "utf8",
  );

  assert.match(
    subscriptionSource,
    /<SubscriptionTabContent key=\{organization\?\.id \?\? ['"]sem-organizacao['"]\} \/>/,
  );
});

test("troca de cartao reutiliza uma chave por tentativa e confirma somente o job duravel", () => {
  const screenSource = readFileSync(
    resolve(
      process.cwd(),
      "components/features/auth/screens/CheckoutScreen.tsx",
    ),
    "utf8",
  );

  const fingerprint = screenSource.indexOf(
    "const fingerprint = await checkoutCardRequestFingerprint",
  );
  const identityGuard = screenSource.indexOf(
    "cardRequestIdentityRef.current?.fingerprint !== fingerprint",
    fingerprint,
  );
  const requestKey = screenSource.indexOf(
    "body.idempotency_key = cardRequestIdentityRef.current.idempotencyKey",
    identityGuard,
  );
  assert.ok(fingerprint >= 0 && identityGuard > fingerprint);
  assert.ok(requestKey > identityGuard);
  assert.doesNotMatch(
    screenSource,
    /(?:localStorage|sessionStorage)[\s\S]{0,120}(?:cardRequest|idempotency)/,
  );
  assert.match(
    screenSource,
    /cardUpdateSessionStorageKey[\s\S]*checkoutCardRequestFingerprint[\s\S]*vimob:billing-card-update:\$\{digest\}/,
  );
  assert.match(screenSource, /parsePersistedCardUpdateJob/);
  assert.match(screenSource, /rememberCardUpdateJob\(\{/);

  const jobPoll = screenSource.indexOf(
    "if (!hasCheckoutIdentity || !directCardUpdateJobId) return;",
  );
  const statusRead = screenSource.indexOf(
    "cardUpdateJobId: directCardUpdateJobId",
    jobPoll,
  );
  const exactJob = screenSource.indexOf(
    "update.job_id !== directCardUpdateJobId",
    statusRead,
  );
  const success = screenSource.indexOf(
    'if (update.state === "succeeded")',
    exactJob,
  );
  assert.ok(jobPoll >= 0 && statusRead > jobPoll);
  assert.ok(exactJob > statusRead && success > exactJob);
  const jobEffectEnd = screenSource.indexOf("const handlePlanChange", jobPoll);
  assert.match(
    screenSource.slice(jobPoll, jobEffectEnd),
    /directPollingNonce/,
  );

  assert.match(
    screenSource,
    /result\.saved_only && result\.recurrence_saved === true/,
  );
  assert.doesNotMatch(
    screenSource,
    /result\.saved_only\)\s*\{[\s\S]{0,220}toast\.success/,
  );
});

test("job saved_only restaurado exibe progresso e repete somente a consulta do mesmo job", () => {
  const screenSource = readFileSync(
    resolve(
      process.cwd(),
      "components/features/auth/screens/CheckoutScreen.tsx",
    ),
    "utf8",
  );

  const savedOnlyBanner = screenSource.indexOf(
    'directCardUpdateMode === "saved_only"',
    screenSource.indexOf("<Tabs"),
  );
  const tabsList = screenSource.indexOf("<TabsList", savedOnlyBanner);
  assert.ok(savedOnlyBanner >= 0 && tabsList > savedOnlyBanner);
  const bannerScope = screenSource.slice(savedOnlyBanner, tabsList);
  assert.match(bannerScope, /role="status"/);
  assert.match(bannerScope, /aria-live="polite"/);
  assert.match(bannerScope, /recoveryMessage/);
  assert.match(bannerScope, /directPollingExpired/);
  assert.match(bannerScope, /onClick=\{handleRetryDirectStatus\}/);
  assert.match(bannerScope, /Consultar novamente/);

  const retryStart = screenSource.indexOf(
    "const handleRetryDirectStatus = () => {",
  );
  const retryEnd = screenSource.indexOf(
    "const handleUseAnotherPaymentMethod",
    retryStart,
  );
  assert.ok(retryStart >= 0 && retryEnd > retryStart);
  const retryScope = screenSource.slice(retryStart, retryEnd);
  assert.match(
    retryScope,
    /setDirectPollingNonce\(\(value\) => value \+ 1\)/,
  );
  assert.doesNotMatch(retryScope, /createCharge|handleSubmit/);
  assert.doesNotMatch(retryScope, /setDirectCardUpdateJobId/);
});
