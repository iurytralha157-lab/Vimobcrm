import { normalizeCheckoutClientIp } from "./asaas-billing-intent.ts";
import { getSupabaseAdmin } from "./asaas.ts";

export type BillingCardAttemptClaim = {
  outcome:
    | "claimed"
    | "rate_limited"
    | "invalid_input"
    | "capability_not_found"
    | "capability_not_available"
    | "payment_not_found"
    | "payment_not_actionable"
    | "payment_not_resolvable"
    | "organization_inactive"
    | "unauthorized"
    | "actor_not_authorized";
  attempts_remaining?: number;
  retry_after_seconds?: number;
};

export async function hmacSha256Hex(secret: string, value: string) {
  if (secret.length < 32 || !value) {
    throw new Error("Billing checkout IP fingerprinting is not configured.");
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value: Uint8Array) {
  const body = value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function constantTimeHexEqual(left: string, right: string) {
  if (
    !/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)
  ) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function billingEdgeClientIpSignature(input: {
  secret: string;
  timestamp: string;
  method: string;
  path: string;
  clientIp: string;
  body: Uint8Array;
}) {
  return await hmacSha256Hex(
    input.secret,
    [
      "v1",
      input.timestamp,
      input.method.trim().toUpperCase(),
      input.path,
      input.clientIp,
      await sha256Hex(input.body),
    ].join("\n"),
  );
}

export async function trustedBillingCheckoutClientIp(
  request: Request,
  nowMs = Date.now(),
) {
  const internalHeaders = [
    request.headers.get("x-vimob-client-ip"),
    request.headers.get("x-vimob-client-ip-timestamp"),
    request.headers.get("x-vimob-client-ip-signature"),
  ];
  if (internalHeaders.some((value) => value !== null)) {
    const clientIp = normalizeCheckoutClientIp(internalHeaders[0]);
    const timestamp = internalHeaders[1]?.trim() || "";
    const signature = internalHeaders[2]?.trim().toLowerCase() || "";
    const timestampSeconds = Number(timestamp);
    const secret = Deno.env.get("BILLING_EDGE_CLIENT_IP_SIGNING_SECRET") || "";
    if (
      !clientIp || !/^\d{10}$/.test(timestamp) ||
      !Number.isSafeInteger(timestampSeconds) ||
      Math.abs(Math.floor(nowMs / 1000) - timestampSeconds) > 90 ||
      !/^[0-9a-f]{64}$/.test(signature) || secret.length < 32
    ) return null;

    const url = new URL(request.url);
    const expected = await billingEdgeClientIpSignature({
      secret,
      timestamp,
      method: request.method,
      path: url.pathname,
      clientIp,
      body: new Uint8Array(await request.clone().arrayBuffer()),
    });
    return constantTimeHexEqual(signature, expected) ? clientIp : null;
  }

  // Direct Supabase calls use the platform-owned Cloudflare header. Raw
  // forwarding headers are never accepted from an internet caller.
  return normalizeCheckoutClientIp(request.headers.get("cf-connecting-ip"));
}

export async function billingCheckoutIpFingerprint(ip: string) {
  const normalizedIp = normalizeCheckoutClientIp(ip);
  const secret = Deno.env.get("BILLING_CHECKOUT_IP_HMAC_SECRET") || "";
  if (!normalizedIp) {
    throw new Error("Billing checkout client IP is unavailable.");
  }
  return await hmacSha256Hex(secret, normalizedIp.toLowerCase());
}

export async function claimOrganizationCheckoutCardAttempt(input: {
  organizationId: string;
  checkoutToken: string;
  ipFingerprint: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "claim_organization_checkout_card_attempt",
    {
      p_organization_id: input.organizationId,
      p_checkout_token: input.checkoutToken,
      p_ip_fingerprint: input.ipFingerprint,
    },
  );
  if (error) throw error;
  return (data || { outcome: "invalid_input" }) as BillingCardAttemptClaim;
}

export async function claimAuthenticatedOrganizationCardAttempt(input: {
  organizationId: string;
  actorUserId: string;
  ipFingerprint: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "claim_authenticated_organization_card_attempt",
    {
      p_organization_id: input.organizationId,
      p_actor_user_id: input.actorUserId,
      p_ip_fingerprint: input.ipFingerprint,
    },
  );
  if (error) throw error;
  return (data || { outcome: "invalid_input" }) as BillingCardAttemptClaim;
}

export async function claimBillingPaymentCardAttemptGuard(input: {
  paymentId: string;
  providerPaymentId: string;
  ipFingerprint: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "claim_billing_payment_card_attempt_guard",
    {
      p_payment_id: input.paymentId,
      p_provider_payment_id: input.providerPaymentId,
      p_ip_fingerprint: input.ipFingerprint,
    },
  );
  if (error) throw error;
  return (data || { outcome: "invalid_input" }) as BillingCardAttemptClaim;
}
