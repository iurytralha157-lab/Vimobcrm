import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { downloadMessageMedia, MessageMediaDownloadError } from "./message-media";

function browser(t: TestContext) {
  const clicks: Array<{ href: string; target?: string }> = [];
  const previous = { document: globalThis.document, window: globalThis.window, navigator: globalThis.navigator, fetch: globalThis.fetch };
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: () => ({ href: "", target: "", click() { clicks.push({ href: this.href, target: this.target }); }, remove() {} }),
    body: { appendChild() {} },
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  t.after(() => {
    for (const name of ["document", "window", "navigator"] as const) Object.defineProperty(globalThis, name, { configurable: true, value: previous[name] });
    globalThis.fetch = previous.fetch;
  });
  return clicks;
}
test("HTTP expired/missing/forbidden media remains an error without opening the old URL", async (t) => {
  const clicks = browser(t);
  for (const status of [401, 403, 404, 500]) {
    globalThis.fetch = async () => new Response(null, { status });
    await assert.rejects(downloadMessageMedia({ url: "https://media.example.test/expired", kind: "document", filename: "Contract.pdf" }),
      (error: unknown) => error instanceof MessageMediaDownloadError && error.code === "http" && error.status === status);
  }
  assert.equal(clicks.length, 0);
});
test("only an opaque browser network/CORS failure opens the validated URL", async (t) => {
  const clicks = browser(t);
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  assert.equal(await downloadMessageMedia({ url: "https://media.example.test/file", kind: "image", filename: "file.png" }), "opened");
  assert.deepEqual(clicks, [{ href: "https://media.example.test/file", target: "_blank" }]);
});
test("parent cancellation aborts fetch and cannot open a fallback tab", async (t) => {
  const clicks = browser(t);
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  const controller = new AbortController();
  const result = downloadMessageMedia({ url: "https://media.example.test/file", kind: "audio", filename: "voice.ogg", signal: controller.signal });
  controller.abort();
  await assert.rejects(result, (error: unknown) => error instanceof MessageMediaDownloadError && error.code === "aborted");
  assert.equal(clicks.length, 0);
});
test("bounded download deadline ends a stalled request without fallback", async (t) => {
  const clicks = browser(t);
  const originalTimer = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => originalTimer(callback, 1)) as typeof setTimeout;
  t.after(() => { globalThis.setTimeout = originalTimer; });
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  await assert.rejects(downloadMessageMedia({ url: "https://media.example.test/file", kind: "document", filename: "file.pdf" }),
    (error: unknown) => error instanceof MessageMediaDownloadError && error.code === "timeout");
  assert.equal(clicks.length, 0);
});
test("bounded size errors do not bypass the limit by opening a tab", async (t) => {
  const clicks = browser(t);
  globalThis.fetch = async () => new Response("", { headers: { "content-length": String(65 * 1024 * 1024) } });
  await assert.rejects(downloadMessageMedia({ url: "https://media.example.test/file", kind: "document", filename: "file.pdf" }), /MEDIA_TOO_LARGE_TO_BUFFER/);
  assert.equal(clicks.length, 0);
});
