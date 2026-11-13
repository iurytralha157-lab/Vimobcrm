import { createClient } from "npm:@supabase/supabase-js@2.108.1";
import { prepareAutomationMedia } from "./automation-whatsapp-media.ts";

const organizationID = "00000000-0000-4000-8000-000000000001";
const sessionID = "00000000-0000-4000-8000-000000000002";
const effectKey = "automation:00000000-0000-4000-8000-000000000003:media:send_image";
const bytes = new TextEncoder().encode("abc");
const sha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

function same<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
}

function syntheticStorage(mime: string, duplicate?: { bytes: Uint8Array<ArrayBuffer>; mime: string }) {
  const requests: { path: string; method: string; mime: string | null; upsert: string | null; body: string }[] = [];
  const client = createClient("https://storage.invalid", "synthetic-test-key", {
    global: { fetch: async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      requests.push({ path, method: request.method, mime: request.headers.get("content-type"), upsert: request.headers.get("x-upsert"), body: await request.text() });
      if (path.startsWith("/storage/v1/object/automation-media/")) return new Response(bytes, { headers: { "content-type": mime } });
      if (request.method === "POST") {
        return duplicate
          ? Response.json({ statusCode: "409", error: "Duplicate", message: "The resource already exists" }, { status: 400 })
          : Response.json({ Id: "synthetic", Key: "synthetic" });
      }
      return new Response(duplicate?.bytes, { headers: { "content-type": duplicate?.mime || mime } });
    } },
  });
  return { client, requests };
}

function config(folder: string, name = "file.old-extension") {
  return { media_bucket: "automation-media", media_path: `${organizationID}/${folder}/${name}` };
}

async function mustFail(run: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await run();
  } catch (error) {
    same(error instanceof Error ? error.message : undefined, message);
    return;
  }
  throw new Error(`Expected ${message}`);
}

Deno.test("copies original bytes as immutable image, audio and video intents", async () => {
  for (const [action, folder, mime, extension] of [
    ["send_image", "images", "image/png", "png"],
    ["send_audio", "audios", "audio/ogg; codecs=opus", "ogg"],
    ["send_audio", "audios", "audio/mp4", "m4a"],
    ["send_video", "videos", "video/quicktime", "mov"],
    ["send_video", "videos", "video/mp4", "mp4"],
  ]) {
    const { client, requests } = syntheticStorage(mime);
    const prepared = await prepareAutomationMedia(client, organizationID, sessionID, action, effectKey, config(folder));
    same(prepared.storagePath, `orgs/${organizationID}/sessions/${sessionID}/outgoing/396F6D182EFF30D2771379572A5235FC/${sha256}.${extension}`);
    same(prepared.size, bytes.byteLength);
    same(prepared.mimeType, mime.split(";")[0]);
    same(requests.length, 2);
    same(requests[1].path, `/storage/v1/object/whatsapp-media/${prepared.storagePath}`);
    same(requests[1].method, "POST");
    same(requests[1].upsert, "false");
    same(requests[1].mime, prepared.mimeType);
    same(requests[1].body, "abc");
  }
});

Deno.test("a duplicate is reused only for the same bytes and MIME", async () => {
  for (const [existingBytes, existingMime, matches] of [
    [bytes, "image/png", true],
    [new TextEncoder().encode("xyz"), "image/png", false],
    [bytes, "image/jpeg", false],
  ] as const) {
    const { client, requests } = syntheticStorage("image/png", { bytes: existingBytes, mime: existingMime });
    const run = () => prepareAutomationMedia(client, organizationID, sessionID, "send_image", effectKey, config("images"));
    if (matches) await run();
    else await mustFail(run, "whatsapp_media_upload:automation_immutable_media_mismatch");
    same(requests.length, 3);
    same(requests[1].upsert, "false");
    same(requests[2].method, "GET");
    same(requests[2].path, requests[1].path);
  }
});

Deno.test("rejects cross-tenant or escaped paths and incompatible media before upload", async () => {
  const { client, requests } = syntheticStorage("video/mp4");
  for (const badConfig of [
    { ...config("images"), media_path: `${sessionID}/images/foreign.png` },
    config("images", "%2e%2e/foreign.png"),
  ]) {
    await mustFail(
      () => prepareAutomationMedia(client, organizationID, sessionID, "send_image", effectKey, badConfig),
      "whatsapp_media_download:cross_tenant_or_invalid_media_path",
    );
  }
  same(requests.length, 0);
  await mustFail(
    () => prepareAutomationMedia(client, organizationID, sessionID, "send_image", effectKey, config("images")),
    "whatsapp_media_download:invalid_automation_media_mime",
  );
  same(requests.length, 1);
});
