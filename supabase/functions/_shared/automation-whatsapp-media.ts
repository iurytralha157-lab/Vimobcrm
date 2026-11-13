import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.1";
import { AutomationPhaseError } from "./automation-runtime-errors.ts";

const AUTOMATION_BUCKET = "automation-media";
const WHATSAPP_MEDIA_BUCKET = "whatsapp-media";
const MAX_AUTOMATION_MEDIA_BYTES = 10 * 1024 * 1024;

// Keep this allowlist aligned with the Go worker and canonical enqueue RPC.
const extensionsByAction: Record<string, Record<string, string>> = {
  send_image: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" },
  send_audio: {
    "audio/aac": "aac", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/ogg": "ogg",
    "audio/wav": "wav", "audio/webm": "webm", "audio/mp4": "m4a",
  },
  send_video: {
    "video/mp4": "mp4", "video/mpeg": "mpeg", "video/quicktime": "mov", "video/webm": "webm", "video/ogg": "ogv",
  },
};

const folderByAction: Record<string, string> = { send_image: "images", send_audio: "audios", send_video: "videos" };

function normalizeMimeType(value: unknown): string {
  return typeof value === "string" ? value.split(";", 1)[0].trim().toLowerCase() : "";
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function prepareAutomationMedia(
  client: SupabaseClient,
  organizationID: string,
  sessionID: string,
  actionType: string,
  effectKey: string,
  config: Record<string, unknown>,
): Promise<{ storagePath: string; mimeType: string; size: number }> {
  const folder = folderByAction[actionType];
  const sourcePath = typeof config.media_path === "string" ? config.media_path : "";
  const prefix = `${organizationID}/${folder}/`;
  const objectName = sourcePath.slice(prefix.length);
  if (!folder || config.media_bucket !== AUTOMATION_BUCKET || !sourcePath.startsWith(prefix) ||
      !objectName || objectName === "." || /[/%\\\p{Cc}]/u.test(objectName) || objectName.includes("..")) {
    throw new AutomationPhaseError("whatsapp_media_download", "cross_tenant_or_invalid_media_path");
  }
  const { data: blob, error: downloadError } = await client.storage.from(AUTOMATION_BUCKET).download(prefix + encodeURIComponent(objectName));
  if (downloadError || !blob) throw new AutomationPhaseError("whatsapp_media_download", downloadError || "media_download_failed");
  if (blob.size < 1 || blob.size > MAX_AUTOMATION_MEDIA_BYTES) {
    throw new AutomationPhaseError("whatsapp_media_download", "invalid_automation_media_size");
  }

  const storedMimeType = normalizeMimeType(blob.type);
  const configuredMimeType = normalizeMimeType(config.mimetype);
  const mimeType = !storedMimeType || storedMimeType === "application/octet-stream" ? configuredMimeType : storedMimeType;
  const extension = extensionsByAction[actionType][mimeType];
  if (!extension || (configuredMimeType && mimeType !== configuredMimeType)) {
    throw new AutomationPhaseError("whatsapp_media_download", "invalid_automation_media_mime");
  }

  const bytes = await blob.arrayBuffer();
  const [digest, clientDigest] = await Promise.all([
    sha256Hex(bytes),
    sha256Hex(new TextEncoder().encode(effectKey.trim()).buffer),
  ]);
  const providerID = clientDigest.slice(0, 32).toUpperCase();
  const storagePath = `orgs/${organizationID.toLowerCase()}/sessions/${sessionID.toLowerCase()}/outgoing/${providerID}/${digest}.${extension}`;
  const bucket = client.storage.from(WHATSAPP_MEDIA_BUCKET);
  const { error: uploadError } = await bucket.upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (uploadError) {
    // Storage can answer HTTP 400 with an embedded duplicate status of 409.
    const status = String(uploadError.status);
    const code = String(uploadError.statusCode).toLowerCase();
    const message = uploadError.message.toLowerCase();
    const duplicate = (status === "400" || status === "409") &&
      ((["409", "duplicate", "keyalreadyexists", "resourcealreadyexists"].includes(code) && message === "the resource already exists") ||
       message === "asset already exists");
    if (!duplicate) throw new AutomationPhaseError("whatsapp_media_upload", uploadError);

    const { data: existing, error: readError } = await bucket.download(storagePath);
    if (readError) throw new AutomationPhaseError("whatsapp_media_upload", readError);
    if (!existing || existing.size !== bytes.byteLength || normalizeMimeType(existing.type) !== mimeType ||
        await sha256Hex(await existing.arrayBuffer()) !== digest) {
      throw new AutomationPhaseError("whatsapp_media_upload", "automation_immutable_media_mismatch");
    }
  }

  // The worker verifies the stored bytes and creates a fresh signed URL for each attempt.
  return { storagePath, mimeType, size: bytes.byteLength };
}
