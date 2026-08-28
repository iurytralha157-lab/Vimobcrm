import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { existingAsaasCustomerUpdatePayload } from "./asaas-customer.ts";

const sharedSource = readFileSync(
  new URL("./asaas.ts", import.meta.url),
  "utf8",
);
const chargeSource = readFileSync(
  new URL("../asaas-create-charge/index.ts", import.meta.url),
  "utf8",
);

function between(
  source: string,
  startMarker: string,
  endMarker: string,
) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("public checkout is read-only for organization and existing Asaas billing profiles", () => {
  const checkoutRecord = between(
    sharedSource,
    "export async function getCheckoutRecord(",
    "export async function getAuthorizedCheckoutRecord(",
  );
  const authorizedCheckout = between(
    sharedSource,
    "export async function getAuthorizedCheckoutRecord(",
    "export function paymentCapabilityExpectedExternalReference(",
  );
  const prepareCustomer = between(
    chargeSource,
    "async function prepareAsaasCustomer(",
    "Deno.serve(async (request) =>",
  );

  // Only an authenticated organization id enables mutable billing-profile access.
  assert.match(
    checkoutRecord,
    /canPersistBillingProfile:\s*Boolean\(params\.organizationId\)/,
  );
  assert.match(
    authorizedCheckout,
    /getCheckoutRecord\(\{\s*organizationId:\s*params\.organizationId,\s*includeBillingProfile:\s*true,\s*\}\)/,
  );
  assert.match(
    authorizedCheckout,
    /if \(params\.token\) \{\s*return getCheckoutRecord\(\{ token: params\.token \}\);/,
  );
  assert.match(
    checkoutRecord,
    /scope:\s*"payment"[\s\S]*?canPersistBillingProfile:\s*false/,
  );

  // The same bit gates both provider-profile updates and organizations.billing_*.
  assert.match(
    prepareCustomer,
    /updateExistingProfile:\s*persistBillingProfile/,
  );
  assert.match(
    prepareCustomer,
    /if \(persistBillingProfile\) \{\s*await saveOrganizationBillingProfile\(/,
  );
  assert.equal(
    (prepareCustomer.match(/saveOrganizationBillingProfile\(/g) || []).length,
    1,
  );

  const publicPayer = {
    name: "Pagador externo",
    email: "externo@example.com",
    cpfCnpj: "12345678901",
    mobilePhone: "5511999999999",
    notificationDisabled: true,
  };
  assert.deepEqual(existingAsaasCustomerUpdatePayload(publicPayer, false), {
    notificationDisabled: true,
  });
  assert.deepEqual(
    existingAsaasCustomerUpdatePayload(publicPayer, true),
    publicPayer,
  );
});

test("every new charge method propagates the checkout billing-profile policy", () => {
  const newChargeFlow = between(
    chargeSource,
    'if (body.billing_type === "PIX")',
    "} catch (error) {",
  );
  const protectedCustomerPreparation =
    /prepareAsaasCustomer\(\s*record\.organization,\s*billingDetails,\s*record\.access\.canPersistBillingProfile,\s*\)/g;

  assert.equal(
    (newChargeFlow.match(protectedCustomerPreparation) || []).length,
    3,
    "PIX, boleto and card must all propagate the authorization bit",
  );
  assert.doesNotMatch(
    newChargeFlow,
    /prepareAsaasCustomer\(\s*record\.organization,\s*billingDetails,\s*true,\s*\)/,
  );
});

test("public capability fixes the organization and intent before provider mutation", () => {
  const checkoutRecord = between(
    sharedSource,
    "export async function getCheckoutRecord(",
    "export async function getAuthorizedCheckoutRecord(",
  );
  const paymentCapability = between(
    checkoutRecord,
    '"resolve_billing_payment_checkout_capability"',
    '} else {\n      const { data: checkoutCapability',
  );
  const requestIdentityAndReservation = between(
    chargeSource,
    "const checkoutToken = readText(body.checkout_token) || null;",
    'if (intent.outcome === "in_progress")',
  );

  assert.match(
    paymentCapability,
    /\.eq\("id", resolved\.payment_id\)\s*\.eq\("organization_id", resolved\.organization_id\)/,
  );
  assert.match(
    paymentCapability,
    /payment\.billing_intent_id !== resolved\.billing_intent_id/,
  );
  assert.match(
    paymentCapability,
    /organizationId = resolved\.organization_id/,
  );

  assert.match(
    requestIdentityAndReservation,
    /if \(checkoutToken && organizationId\)[\s\S]*?ambiguous_checkout_identity/,
  );
  assert.match(
    requestIdentityAndReservation,
    /getAuthorizedCheckoutRecord\(request, \{\s*token: checkoutToken,\s*organizationId,\s*\}\)/,
  );
  assert.match(
    requestIdentityAndReservation,
    /reserveBillingCheckoutIntent\(\s*record\.organization\.id,/,
  );
  assert.match(
    requestIdentityAndReservation,
    /reservedIntentId = intent\.intent_id \|\| null/,
  );
  assert.doesNotMatch(
    requestIdentityAndReservation,
    /reserveBillingCheckoutIntent\(\s*(?:body\.)?organizationId/,
  );
});
