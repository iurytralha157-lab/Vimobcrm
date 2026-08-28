import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isPaidStatus } from "./asaas.ts";

const source = readFileSync(
  new URL("./asaas.ts", import.meta.url),
  "utf8",
);
const checkoutInfoSource = readFileSync(
  new URL("../asaas-checkout-info/index.ts", import.meta.url),
  "utf8",
);

function isolate(startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const relativeEnd = source.slice(start).indexOf(endMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(relativeEnd, -1, `missing ${endMarker}`);
  return source.slice(start, start + relativeEnd);
}

test("checkout token resolves payment or legacy capability before reading the organization", () => {
  const checkout = isolate(
    "export async function getCheckoutRecord(",
    "export async function getAuthorizedCheckoutRecord(",
  );
  const paymentCapability = checkout.indexOf(
    '"resolve_billing_payment_checkout_capability"',
  );
  const legacyCapability = checkout.indexOf(
    '.from("organization_checkout_capabilities")',
  );
  const capabilityToken = checkout.indexOf(
    '.eq("checkout_token", checkoutToken)',
  );
  const organization = checkout.indexOf('.from("organizations")');
  const organizationId = checkout.indexOf('.eq("id", organizationId)');

  assert.ok(paymentCapability >= 0);
  assert.ok(legacyCapability > paymentCapability);
  assert.ok(capabilityToken > legacyCapability);
  assert.ok(organization > capabilityToken);
  assert.ok(organizationId > organization);
  assert.match(checkout, /\.select\("organization_id"\)/);
  assert.match(
    checkout,
    /if \(!checkoutCapability\?\.organization_id\) return null/,
  );
});

test("payment access validates scoped and legacy capabilities without reading organizations", () => {
  const access = isolate(
    "export async function canAccessOrganizationPayment(",
    "async function canManageOrganizationBilling(",
  );

  assert.match(access, /resolve_billing_payment_checkout_capability/);
  assert.match(access, /p_checkout_token: normalizedToken/);
  assert.match(access, /\.from\("organization_checkout_capabilities"\)/);
  assert.match(access, /\.eq\("organization_id", organizationId\)/);
  assert.match(access, /\.eq\("checkout_token", normalizedToken\)/);
  assert.doesNotMatch(access, /\.from\("organizations"\)/);
});

test("checkout engine never filters organizations by checkout_token", () => {
  const checkout = isolate(
    "export async function getCheckoutRecord(",
    "export async function getAuthorizedCheckoutRecord(",
  );

  assert.doesNotMatch(
    checkout,
    /\.from\("organizations"\)[\s\S]*?\.eq\("checkout_token"/,
  );
  assert.doesNotMatch(checkout, /query\s*=\s*query\.eq\("checkout_token"/);
});

test("refund denied remains financially settled across public checkout state", () => {
  for (
    const status of [
      "CONFIRMED",
      "RECEIVED",
      "RECEIVED_IN_CASH",
      "REFUND_DENIED",
      " refund_denied ",
    ]
  ) {
    assert.equal(isPaidStatus(status), true, status);
  }
  for (
    const status of [
      "PENDING",
      "REFUND_REQUESTED",
      "REFUND_IN_PROGRESS",
      "REFUNDED",
      "CHARGEBACK",
    ]
  ) {
    assert.equal(isPaidStatus(status), false, status);
  }

  assert.match(
    checkoutInfoSource,
    /const checkoutState = asaasPaymentCheckoutState\(paymentStatus,[\s\S]*!\["pending", "processing", "retry"\]\.includes\(checkoutState\)[\s\S]*return null;/,
  );
  assert.match(
    checkoutInfoSource,
    /const paymentSettled = isPaidStatus\(paymentStatus\);/,
  );
});
