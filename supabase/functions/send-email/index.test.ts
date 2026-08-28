import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";

Deno.test("legacy send-email endpoint never accepts a delivery request", async () => {
  const response = handleRequest(new Request("http://localhost/send-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: "recipient@example.com" }),
  }));

  assertEquals(response.status, 410);
  assertEquals(await response.json(), {
    ok: false,
    code: "legacy_email_endpoint_retired",
    message: "This email endpoint has been retired.",
  });
});

Deno.test("legacy send-email endpoint keeps CORS preflight side-effect free", () => {
  const response = handleRequest(new Request("http://localhost/send-email", {
    method: "OPTIONS",
  }));

  assertEquals(response.status, 204);
});
