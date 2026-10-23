import assert from "node:assert/strict";
import test from "node:test";
import { createWhatsAppGalleryReadScope } from "@/lib/whatsapp-media-gallery-read";

function fixture() {
  const requests: { id: string; organizationId: string; options: { signal: AbortSignal; expectedUserId: string }; resolve(value: { url: string }): void; reject(error: Error): void }[] = [];
  const scope = createWhatsAppGalleryReadScope({ organizationId: "org-a", userId: "user-a", scopeKey: "physical-a" }, (id, organizationId, options) => new Promise((resolve, reject) => requests.push({ id, organizationId, options, resolve, reject })));
  return { scope, requests, ready() { scope.activate(); scope.setVisible(["message-a"]); } };
}

test("gallery read remains inactive until commit and signs only a currently visible message", async () => {
  const f = fixture(); assert.equal(await f.scope.read("message-a"), null); f.ready();
  assert.equal(await f.scope.read("message-b"), null); const promise = f.scope.read("message-a");
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].organizationId, "org-a"); assert.equal(f.requests[0].options.expectedUserId, "user-a");
  f.requests[0].resolve({ url: "synthetic-current-url" }); assert.equal(await promise, "synthetic-current-url");
});
test("disposal aborts a pending read and a delayed completion returns no old URL", async () => {
  const f = fixture(); f.ready(); const promise = f.scope.read("message-a"); f.scope.dispose();
  assert.equal(f.requests[0].options.signal.aborted, true); f.requests[0].resolve({ url: "old-url" }); assert.equal(await promise, null);
  assert.equal(await f.scope.read("message-a"), null); assert.equal(f.requests.length, 1);
});
test("Strict Mode cleanup and reactivation do not revive a previous epoch", async () => {
  const f = fixture(); f.ready(); const previous = f.scope.read("message-a"); f.scope.dispose(); f.ready();
  const current = f.scope.read("message-a"); f.requests[0].resolve({ url: "old-url" }); f.requests[1].resolve({ url: "new-url" });
  assert.equal(await previous, null); assert.equal(await current, "new-url");
});
test("removing a visible row aborts its HTTP read and prevents another request", async () => {
  const f = fixture(); f.ready(); const promise = f.scope.read("message-a"); f.scope.setVisible([]);
  assert.equal(f.requests[0].options.signal.aborted, true); f.requests[0].resolve({ url: "removed-url" }); assert.equal(await promise, null);
  assert.equal(await f.scope.read("message-a"), null); assert.equal(f.requests.length, 1);
});
test("external abort cancels navigation and an already aborted gesture never calls HTTP", async () => {
  const f = fixture(); f.ready(); const controller = new AbortController(); const promise = f.scope.read("message-a", { signal: controller.signal }); controller.abort();
  assert.equal(f.requests[0].options.signal.aborted, true); f.requests[0].resolve({ url: "aborted-url" }); assert.equal(await promise, null);
  assert.equal(await f.scope.read("message-a", { signal: controller.signal }), null); assert.equal(f.requests.length, 1);
});
test("a current access denial is propagated while a denial from an old lifetime is cancelled", async () => {
  const f = fixture(); f.ready(); const current = f.scope.read("message-a"); const denied = new Error("denied"); f.requests[0].reject(denied); await assert.rejects(current, error => error === denied);
  const previous = f.scope.read("message-a"); f.scope.dispose(); f.requests[1].reject(denied); assert.equal(await previous, null);
});
test("a gallery with no actor, organization or physical scope cannot request signed media", async () => {
  for (const scope of [{ organizationId: null, userId: "user-a", scopeKey: "A" }, { organizationId: "org-a", userId: null, scopeKey: "A" }, { organizationId: "org-a", userId: "user-a", scopeKey: "" }]) {
    const lifetime = createWhatsAppGalleryReadScope(scope, async () => { throw new Error("HTTP must not be called"); }); lifetime.activate(); lifetime.setVisible(["message-a"]);
    assert.equal(await lifetime.read("message-a"), null);
  }
});
test("an unchanged row keeps its callback and an in-flight read through feed updates without URL caching", async () => {
  const f = fixture(); f.ready(); const first = f.scope.reader("message-a", "image", value => value);
  const promise = first(); f.scope.setVisible(["message-a", "message-b"]);
  assert.equal(f.scope.reader("message-a", "image", value => value), first); assert.equal(f.requests[0].options.signal.aborted, false);
  f.requests[0].resolve({ url: "first-url" }); assert.equal(await promise, "first-url");
  const second = first(); assert.equal(f.requests.length, 2); f.requests[1].resolve({ url: "second-url" }); assert.equal(await second, "second-url");
});
