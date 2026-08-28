import assert from "node:assert/strict";
import test from "node:test";

import { retiredUserMutation } from "./retired-user-mutation.ts";

test("retired user mutation endpoints fail closed without leaking internals", async () => {
  const response = retiredUserMutation(
    new Request("https://project.supabase.co/functions/v1/submit-onboarding", {
      method: "POST",
      body: JSON.stringify({ email: "victim@example.com" }),
    }),
  );

  assert.equal(response.status, 410);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    success: false,
    code: "endpoint_retired",
    error: "Esta rota foi desativada. Use o fluxo atual do Vimob.",
  });
});
