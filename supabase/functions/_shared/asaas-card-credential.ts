import { normalizeCheckoutClientIp } from "./asaas-billing-intent.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesFromHex(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error("Billing card credential encryption is not configured.");
  }
  return Uint8Array.from(
    value.match(/.{2}/g) || [],
    (part) => Number.parseInt(part, 16),
  );
}

function base64UrlEncode(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid ciphertext.");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importEncryptionKey(keyHex: string) {
  return await crypto.subtle.importKey(
    "raw",
    bytesFromHex(keyHex),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function normalizedCredential(input: {
  creditCardToken: string;
  remoteIp: string;
}) {
  const creditCardToken = input.creditCardToken.trim();
  const remoteIp = normalizeCheckoutClientIp(input.remoteIp);
  if (
    creditCardToken.length < 16 || creditCardToken.length > 255 ||
    !/^[A-Za-z0-9_-]+$/.test(creditCardToken) || !remoteIp
  ) {
    throw new Error("Invalid provider card credential.");
  }
  return { creditCardToken, remoteIp };
}

export async function sealBillingCardCredential(
  input: {
    paymentId: string;
    providerPaymentId: string;
    creditCardToken: string;
    remoteIp: string;
  },
  keyHex = Deno.env.get("BILLING_CARD_CREDENTIAL_ENCRYPTION_KEY") || "",
) {
  const paymentId = input.paymentId.trim().toLowerCase();
  const providerPaymentId = input.providerPaymentId.trim();
  if (!paymentId || !providerPaymentId) {
    throw new Error("Invalid payment credential scope.");
  }
  const credential = normalizedCredential(input);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encoder.encode(
          `vimob:billing-card:${paymentId}:${providerPaymentId}`,
        ),
      },
      await importEncryptionKey(keyHex),
      encoder.encode(JSON.stringify(credential)),
    ),
  );
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(encrypted)}`;
}

export async function openBillingCardCredential(
  input: {
    paymentId: string;
    providerPaymentId: string;
    ciphertext: string;
  },
  keyHex = Deno.env.get("BILLING_CARD_CREDENTIAL_ENCRYPTION_KEY") || "",
) {
  const paymentId = input.paymentId.trim().toLowerCase();
  const providerPaymentId = input.providerPaymentId.trim();
  const [version, encodedIv, encodedPayload, ...extra] = input.ciphertext.split(
    ".",
  );
  if (
    !paymentId || !providerPaymentId || version !== "v1" || !encodedIv ||
    !encodedPayload ||
    extra.length > 0
  ) {
    throw new Error("Invalid payment credential ciphertext.");
  }
  const iv = base64UrlDecode(encodedIv);
  if (iv.length !== 12) throw new Error("Invalid payment credential nonce.");
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(
        `vimob:billing-card:${paymentId}:${providerPaymentId}`,
      ),
    },
    await importEncryptionKey(keyHex),
    base64UrlDecode(encodedPayload),
  );
  const parsed = JSON.parse(decoder.decode(decrypted)) as Record<
    string,
    unknown
  >;
  return normalizedCredential({
    creditCardToken: typeof parsed.creditCardToken === "string"
      ? parsed.creditCardToken
      : "",
    remoteIp: typeof parsed.remoteIp === "string" ? parsed.remoteIp : "",
  });
}

function subscriptionCardCredentialScope(input: {
  jobId: string;
  providerSubscriptionId: string;
}) {
  const jobId = input.jobId.trim().toLowerCase();
  const providerSubscriptionId = input.providerSubscriptionId.trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      .test(
        jobId,
      ) ||
    providerSubscriptionId.length > 255 ||
    !/^[A-Za-z0-9_-]+$/.test(providerSubscriptionId)
  ) {
    throw new Error("Invalid subscription credential scope.");
  }
  return {
    jobId,
    providerSubscriptionId,
    additionalData:
      `vimob:billing-subscription-card:${jobId}:${providerSubscriptionId}`,
  };
}

export async function sealBillingSubscriptionCardCredential(
  input: {
    jobId: string;
    providerSubscriptionId: string;
    creditCardToken: string;
    remoteIp: string;
  },
  keyHex = Deno.env.get("BILLING_CARD_CREDENTIAL_ENCRYPTION_KEY") || "",
) {
  const scope = subscriptionCardCredentialScope(input);
  const credential = normalizedCredential(input);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encoder.encode(scope.additionalData),
      },
      await importEncryptionKey(keyHex),
      encoder.encode(JSON.stringify(credential)),
    ),
  );
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(encrypted)}`;
}

export async function openBillingSubscriptionCardCredential(
  input: {
    jobId: string;
    providerSubscriptionId: string;
    ciphertext: string;
  },
  keyHex = Deno.env.get("BILLING_CARD_CREDENTIAL_ENCRYPTION_KEY") || "",
) {
  const scope = subscriptionCardCredentialScope(input);
  const [version, encodedIv, encodedPayload, ...extra] = input.ciphertext.split(
    ".",
  );
  if (
    version !== "v1" || !encodedIv || !encodedPayload || extra.length > 0
  ) {
    throw new Error("Invalid subscription credential ciphertext.");
  }
  const iv = base64UrlDecode(encodedIv);
  if (iv.length !== 12) {
    throw new Error("Invalid subscription credential nonce.");
  }
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(scope.additionalData),
    },
    await importEncryptionKey(keyHex),
    base64UrlDecode(encodedPayload),
  );
  const parsed = JSON.parse(decoder.decode(decrypted)) as Record<
    string,
    unknown
  >;
  return normalizedCredential({
    creditCardToken: typeof parsed.creditCardToken === "string"
      ? parsed.creditCardToken
      : "",
    remoteIp: typeof parsed.remoteIp === "string" ? parsed.remoteIp : "",
  });
}
