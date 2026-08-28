import {
  hasRecognizedWebhookCredential,
  readBoundedJsonBody,
  WebhookRequestBodyError,
  type WebhookRequestBodyErrorCode,
} from "./request-security.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectBodyError(
  promise: Promise<unknown>,
  code: WebhookRequestBodyErrorCode,
  status: 400 | 413,
) {
  try {
    await promise;
  } catch (error) {
    assert(
      error instanceof WebhookRequestBodyError,
      `unexpected error: ${String(error)}`,
    );
    assert(error.code === code, `expected code ${code}, got ${error.code}`);
    assert(
      error.status === status,
      `expected status ${status}, got ${error.status}`,
    );
    return;
  }
  throw new Error(`expected ${code} error`);
}

Deno.test("recognizes only non-empty webhook credential headers", () => {
  const missing = new Headers({
    "content-type": "application/json",
    "x-webhook-token": "   ",
    authorization: "Bearer   ",
  });
  assert(
    !hasRecognizedWebhookCredential(missing),
    "blank credential was accepted",
  );

  for (
    const [name, value] of [
      ["x-webhook-token", "session-secret"],
      ["x-evolution-webhook-token", "session-secret"],
      ["apikey", "provider-secret"],
      ["x-api-key", "provider-secret"],
      ["authorization", "Bearer provider-secret"],
      ["authorization", "provider-secret"],
    ]
  ) {
    assert(
      hasRecognizedWebhookCredential(new Headers({ [name]: value })),
      `${name} was not recognized`,
    );
  }
});

Deno.test("parses a JSON body within the byte limit", async () => {
  const raw = JSON.stringify({ event: "messages.upsert", ok: true });
  const request = new Request("https://example.test/webhook", {
    method: "POST",
    body: raw,
  });

  const result = await readBoundedJsonBody<Record<string, unknown>>(
    request,
    new TextEncoder().encode(raw).byteLength,
  );

  assert(result.event === "messages.upsert", "event was not parsed");
  assert(result.ok === true, "boolean value was not parsed");
});

Deno.test("rejects a declared oversized body before reading its stream", async () => {
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const request = {
    headers: new Headers({ "content-length": "1024" }),
    body,
  } as Request;

  await expectBodyError(
    readBoundedJsonBody(request, 16),
    "webhook_body_too_large",
    413,
  );
  assert(pulls === 0, `body stream was read ${pulls} time(s)`);
});

Deno.test("enforces actual streamed bytes when Content-Length is absent or false", async () => {
  for (const headers of [undefined, { "content-length": "2" }]) {
    const request = new Request("https://example.test/webhook", {
      method: "POST",
      headers,
      body: JSON.stringify({ payload: "larger than the limit" }),
    });

    await expectBodyError(
      readBoundedJsonBody(request, 12),
      "webhook_body_too_large",
      413,
    );
  }
});

Deno.test("rejects malformed JSON after bounded reading", async () => {
  const request = new Request("https://example.test/webhook", {
    method: "POST",
    body: "{not-json}",
  });

  await expectBodyError(
    readBoundedJsonBody(request, 64),
    "invalid_webhook_body",
    400,
  );
});
