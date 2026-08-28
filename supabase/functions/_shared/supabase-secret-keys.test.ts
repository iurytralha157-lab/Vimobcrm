import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  allSupabaseServiceApiKeys,
  parseSupabaseSecretKeys,
  selectSupabaseAdminSecretKey,
} from "./supabase-secret-keys.ts";

const defaultSecret = "sb_secret_default_0123456789abcdefghijklmnop";
const rotationSecret = "sb_secret_rotation_abcdefghijklmnop0123456789";
const localSecret = "sb_secret_local_0123456789abcdefghijklmnopqr";
const legacySecret =
  "legacyHeader0123456789.legacyPayload0123456789.legacySignature0123456789";

test("selects the named default deterministically during rotation", () => {
  const environment = {
    SUPABASE_SECRET_KEYS: JSON.stringify({
      rotation: rotationSecret,
      default: defaultSecret,
    }),
    SUPABASE_SERVICE_ROLE_KEY: legacySecret,
  };

  assert.equal(selectSupabaseAdminSecretKey(environment), defaultSecret);
  assert.deepEqual(allSupabaseServiceApiKeys(environment), [
    rotationSecret,
    defaultSecret,
    legacySecret,
  ]);
});

test("uses a sole named key and rejects an ambiguous dictionary without default", () => {
  assert.equal(
    selectSupabaseAdminSecretKey({
      SUPABASE_SECRET_KEYS: JSON.stringify({ recurrence: rotationSecret }),
    }),
    rotationSecret,
  );
  assert.equal(
    selectSupabaseAdminSecretKey({
      SUPABASE_SECRET_KEYS: JSON.stringify({
        recurrence: rotationSecret,
        billing: defaultSecret,
      }),
      SUPABASE_SERVICE_ROLE_KEY: legacySecret,
    }),
    null,
  );
});

test("prefers the local secret and uses legacy only when new keys are absent", () => {
  assert.equal(
    selectSupabaseAdminSecretKey({
      SUPABASE_SECRET_KEY: localSecret,
      SUPABASE_SERVICE_ROLE_KEY: legacySecret,
    }),
    localSecret,
  );
  assert.equal(
    selectSupabaseAdminSecretKey({
      SUPABASE_SERVICE_ROLE_KEY: legacySecret,
    }),
    legacySecret,
  );
  assert.equal(
    selectSupabaseAdminSecretKey({
      SUPABASE_SECRET_KEYS: JSON.stringify({
        recurrence: rotationSecret,
        billing: defaultSecret,
      }),
      SUPABASE_SECRET_KEY: localSecret,
      SUPABASE_SERVICE_ROLE_KEY: legacySecret,
    }),
    null,
  );
});

test("malformed, empty and unsafe key configurations fail closed", () => {
  for (const malformed of ["{", "null", "[]", "{}", '{"default":42}']) {
    const environment = {
      SUPABASE_SECRET_KEYS: malformed,
      SUPABASE_SECRET_KEY: localSecret,
      SUPABASE_SERVICE_ROLE_KEY: legacySecret,
    };
    assert.equal(parseSupabaseSecretKeys(environment), null);
    assert.equal(selectSupabaseAdminSecretKey(environment), null);
    assert.equal(allSupabaseServiceApiKeys(environment), null);
  }

  assert.equal(
    selectSupabaseAdminSecretKey({
      SUPABASE_SECRET_KEY: "short",
      SUPABASE_SERVICE_ROLE_KEY: legacySecret,
    }),
    null,
  );
});

test("the shared Supabase admin client uses the deterministic selector", () => {
  const asaasSource = readFileSync(
    new URL("./asaas.ts", import.meta.url),
    "utf8",
  );
  const adminStart = asaasSource.indexOf("export function getSupabaseAdmin()");
  const adminEnd = asaasSource.indexOf(
    "export function onlyDigits",
    adminStart,
  );
  const adminScope = asaasSource.slice(adminStart, adminEnd);

  assert.ok(adminStart >= 0 && adminEnd > adminStart);
  assert.match(adminScope, /selectSupabaseAdminSecretKey\(/);
  assert.match(adminScope, /readSupabaseSecretKeyEnvironment\(\)/);
  assert.doesNotMatch(
    adminScope,
    /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/,
  );
});
