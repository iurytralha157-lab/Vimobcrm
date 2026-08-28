import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  authorizePrivateWorkerRequest,
  type PrivateWorkerAuthEnvironment,
} from "./private-worker-auth.ts";

const opaqueSecret = "sb_secret_recurrence_worker_0123456789abcdef";
const rotatedSecret = "sb_secret_recurrence_rotated_abcdef0123456789";
const localSecret = "sb_secret_local_worker_0123456789abcdefghijk";
const legacyJwt =
  "legacyHeader0123456789.legacyPayload0123456789.legacySignature0123456789";

function request(headers: HeadersInit = {}) {
  return new Request("https://functions.example.test/private-worker", {
    method: "POST",
    headers,
  });
}

function hostedEnvironment(
  namedKeys: Record<string, string> = { default: opaqueSecret },
): PrivateWorkerAuthEnvironment {
  return { SUPABASE_SECRET_KEYS: JSON.stringify(namedKeys) };
}

test("accepts an exact hosted sb_secret API key without Authorization", () => {
  const incoming = request({ apikey: opaqueSecret });

  assert.equal(incoming.headers.has("authorization"), false);
  assert.equal(
    authorizePrivateWorkerRequest(incoming, hostedEnvironment()),
    true,
  );
});

test("accepts every named hosted key during rotation", () => {
  const environment = hostedEnvironment({
    default: opaqueSecret,
    recurrence_rotation: rotatedSecret,
  });

  assert.equal(
    authorizePrivateWorkerRequest(
      request({ apikey: opaqueSecret }),
      environment,
    ),
    true,
  );
  assert.equal(
    authorizePrivateWorkerRequest(
      request({ apikey: rotatedSecret }),
      environment,
    ),
    true,
  );
  assert.equal(
    authorizePrivateWorkerRequest(
      request({ apikey: `${rotatedSecret}-wrong` }),
      environment,
    ),
    false,
  );
});

test("accepts the local single secret key only through apikey", () => {
  const environment = { SUPABASE_SECRET_KEY: localSecret };
  assert.equal(
    authorizePrivateWorkerRequest(
      request({ apikey: localSecret }),
      environment,
    ),
    true,
  );
  assert.equal(
    authorizePrivateWorkerRequest(
      request({ authorization: `Bearer ${localSecret}` }),
      environment,
    ),
    false,
  );
});

test("keeps Bearer-only compatibility exclusively for the legacy JWT", () => {
  const environment = { SUPABASE_SERVICE_ROLE_KEY: legacyJwt };
  assert.equal(
    authorizePrivateWorkerRequest(
      request({ apikey: legacyJwt, authorization: `Bearer ${legacyJwt}` }),
      environment,
    ),
    true,
  );
  assert.equal(
    authorizePrivateWorkerRequest(
      request({ authorization: `Bearer ${legacyJwt}` }),
      environment,
    ),
    true,
  );
  assert.equal(
    authorizePrivateWorkerRequest(
      request({ authorization: `Bearer ${legacyJwt}` }),
      hostedEnvironment({ jwt_shaped_secret: legacyJwt }),
    ),
    false,
  );
});

test("does not downgrade from an invalid API key to a valid legacy Bearer", () => {
  assert.equal(
    authorizePrivateWorkerRequest(
      request({
        apikey: `${legacyJwt}-wrong`,
        authorization: `Bearer ${legacyJwt}`,
      }),
      { SUPABASE_SERVICE_ROLE_KEY: legacyJwt },
    ),
    false,
  );
});

test("malformed named-key JSON fails closed instead of using fallbacks", () => {
  for (const malformed of ["{", "null", "[]", '{"default":42}']) {
    assert.equal(
      authorizePrivateWorkerRequest(
        request({ apikey: localSecret }),
        {
          SUPABASE_SECRET_KEYS: malformed,
          SUPABASE_SECRET_KEY: localSecret,
          SUPABASE_SERVICE_ROLE_KEY: legacyJwt,
        },
      ),
      false,
    );
  }
});

test("rejects missing, inexact and unsafe configured credentials", () => {
  assert.equal(
    authorizePrivateWorkerRequest(request(), hostedEnvironment()),
    false,
  );
  assert.equal(
    authorizePrivateWorkerRequest(
      request({ apikey: `${opaqueSecret}-wrong` }),
      hostedEnvironment(),
    ),
    false,
  );
  assert.equal(
    authorizePrivateWorkerRequest(
      request({ apikey: "short" }),
      { SUPABASE_SECRET_KEY: "short" },
    ),
    false,
  );
  assert.equal(
    authorizePrivateWorkerRequest(request({ apikey: opaqueSecret }), {}),
    false,
  );
});

test("recurrence worker disables gateway JWT verification for apikey auth", () => {
  const config = readFileSync(
    new URL("../../config.toml", import.meta.url),
    "utf8",
  );
  const sectionStart = config.indexOf(
    "[functions.asaas-card-recurrence-worker]",
  );
  const sectionEnd = config.indexOf("\n[functions.", sectionStart + 1);
  const section = config.slice(
    sectionStart,
    sectionEnd === -1 ? undefined : sectionEnd,
  );

  assert.ok(sectionStart >= 0);
  assert.match(section, /verify_jwt\s*=\s*false/);
});
