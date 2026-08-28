import { createClient } from "npm:@supabase/supabase-js@2";
import { decode } from "https://deno.land/std@0.177.0/encoding/base64.ts";

const MAGIC_BYTES: Record<string, string[]> = {
  'image/jpeg': ['FFD8FF'],
  'image/png': ['89504E47'],
  'image/gif': ['47494638'],
  'image/webp': ['52494646'],
  'audio/mpeg': ['494433', 'FFF1', 'FFF9'],
  'audio/ogg': ['4F676753'],
  'audio/mp4': ['000000'],
  'video/mp4': ['000000'],
  'application/pdf': ['25504446'],
};

function validateMagicBytes(content: Uint8Array, expectedMime: string): boolean {
  if (content.length < 4) return false;
  const hex = Array.from(content.slice(0, 8))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('').toUpperCase();

  const mimeBase = expectedMime.split(';')[0].toLowerCase();
  
  // Special cases for container formats
  if (mimeBase === 'image/webp' && hex.startsWith('52494646')) return true;
  if ((mimeBase === 'video/mp4' || mimeBase === 'audio/mp4') && hex.includes('66747970')) return true;

  const expectedSignatures = MAGIC_BYTES[mimeBase];
  if (!expectedSignatures) return true; // Allow if we don't have the signature defined

  return expectedSignatures.some(sig => hex.startsWith(sig));
}

function normalizeBase64(base64: string): string {
  if (!base64) return "";
  // Remove data URL prefix, whitespace and newlines
  return base64.replace(/^data:.*?;base64,/, '').replace(/[\r\n\s]/g, '');
}

function isValidBase64(str: string): boolean {
  if (!str || str.length % 4 !== 0) return false;
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  return base64Regex.test(str);
}

function firstPresent(...values: any[]) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function normalizeGoMediaPayload(media: any) {
  if (!media || typeof media !== "object") return null;
  return {
    ...media,
    url: firstPresent(media.url, media.URL, media.Url, media.mediaUrl, media.MediaUrl),
    directPath: firstPresent(media.directPath, media.DirectPath),
    mediaKey: firstPresent(media.mediaKey, media.MediaKey),
    fileSHA256: firstPresent(media.fileSHA256, media.FileSHA256, media.fileSha256),
    fileEncSHA256: firstPresent(media.fileEncSHA256, media.FileEncSHA256, media.fileEncSha256),
    fileLength: firstPresent(media.fileLength, media.FileLength),
    mimetype: firstPresent(media.mimetype, media.Mimetype),
  };
}

function pickGoMediaPayload(messageKey: any, mediaType: string) {
  const direct = normalizeGoMediaPayload(messageKey?.media);
  if (direct) return direct;

  const rawMessage = messageKey?.raw_message?.message || messageKey?.raw_message?.Message || messageKey?.raw_message;
  const candidates = [
    rawMessage?.imageMessage,
    rawMessage?.ImageMessage,
    rawMessage?.audioMessage,
    rawMessage?.AudioMessage,
    rawMessage?.videoMessage,
    rawMessage?.VideoMessage,
    rawMessage?.documentMessage,
    rawMessage?.DocumentMessage,
    rawMessage?.stickerMessage,
    rawMessage?.StickerMessage,
  ];
  const byType: Record<string, number[]> = {
    image: [0, 1],
    audio: [2, 3],
    video: [4, 5],
    document: [6, 7],
    sticker: [8, 9],
  };
  for (const index of byType[mediaType] || []) {
    const normalized = normalizeGoMediaPayload(candidates[index]);
    if (normalized) return normalized;
  }
  for (const candidate of candidates) {
    const normalized = normalizeGoMediaPayload(candidate);
    if (normalized) return normalized;
  }
  return null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL");
    const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");
    const EVOLUTION_GO_API_URL = (Deno.env.get("EVOLUTION_GO_API_URL") || "").replace(/\/+$/, "");
    const EVOLUTION_GO_API_KEY = Deno.env.get("EVOLUTION_GO_API_KEY") || "";

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bearerToken = authHeader.replace("Bearer ", "").trim();
    const isServiceRoleRequest = bearerToken === SUPABASE_SERVICE_ROLE_KEY;
    let requesterUserId: string | null = null;

    if (!isServiceRoleRequest) {
      const { data: claims, error: claimsError } = await supabase.auth.getClaims(bearerToken);
      requesterUserId = claims?.claims?.sub ? String(claims.claims.sub) : null;
      if (claimsError || !requesterUserId) {
        return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Check if this is a forced retry for a specific message
    let body: { message_id?: string; force?: boolean; scan_orphans?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // No body is fine for cron jobs
    }

    if (!isServiceRoleRequest && !(body.message_id && body.force)) {
      return new Response(JSON.stringify({ success: false, error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Scan mode: create jobs for all messages that are 'pending' without a job
    if (body.scan_orphans) {
      if (!isServiceRoleRequest) {
        return new Response(JSON.stringify({ success: false, error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.log("Scanning for orphan pending media messages...");
      const { data: orphans } = await supabase
        .from("whatsapp_messages")
        .select(`
          id, 
          session_id, 
          conversation_id, 
          message_type, 
          media_mime_type, 
          message_id, 
          from_me,
          metadata,
          session:whatsapp_sessions(organization_id),
          conversation:whatsapp_conversations(remote_jid)
        `)
        .eq("media_status", "pending")
        .is("media_url", null)
        .in("message_type", ["image", "audio", "video", "document", "sticker"])
        .gte("sent_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

      let created = 0;
      for (const msg of orphans || []) {
        const { data: existing } = await supabase
          .from("media_jobs")
          .select("id")
          .eq("message_id", msg.id)
          .in("status", ["pending", "processing"])
          .maybeSingle();
        
        if (existing) continue;

        const orgId = (msg as any).session?.organization_id;
        const remoteJid = (msg as any).conversation?.remote_jid;
        if (!orgId || !remoteJid) continue;

        const metadataObj = (msg as any).metadata || {};
        const mediaPayload = metadataObj.media_payload || metadataObj.raw_message || null;

        const { error: insErr } = await supabase.from("media_jobs").insert({
          organization_id: orgId,
          message_id: msg.id,
          session_id: msg.session_id,
          conversation_id: msg.conversation_id,
          message_key: { 
            id: msg.message_id,
            remoteJid: remoteJid,
            fromMe: msg.from_me,
            media: mediaPayload
          },
          media_type: msg.message_type,
          media_mime_type: msg.media_mime_type,
          status: 'pending',
          attempts: 0,
          next_retry_at: new Date().toISOString(),
        });
        if (!insErr) created++;
      }
      console.log(`Scan complete: ${created} jobs created out of ${orphans?.length || 0} orphans`);
      return new Response(
        JSON.stringify({ success: true, orphans_found: orphans?.length || 0, jobs_created: created }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (body.message_id && body.force) {
      // Handle single message retry
      const { data: message } = await supabase
        .from("whatsapp_messages")
        .select("*, session:whatsapp_sessions(*)")
        .eq("id", body.message_id)
        .single();

      if (message) {
        if (!isServiceRoleRequest && message.session?.owner_user_id !== requesterUserId) {
          return new Response(JSON.stringify({ success: false, error: "Forbidden" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (message.media_url && message.media_status === "ready") {
          return new Response(
            JSON.stringify({ success: true, message: "Media already ready", media_url: message.media_url }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log(`Force retry for message ${body.message_id}`);
        
        // Mark as pending
        await supabase
          .from("whatsapp_messages")
          .update({ media_status: 'pending', media_error: null })
          .eq("id", body.message_id);

        // Check if job already exists
        const { data: existingJob } = await supabase
          .from("media_jobs")
          .select("id")
          .eq("message_id", body.message_id)
          .eq("status", "pending")
          .maybeSingle();

        if (!existingJob) {
          // Create a new job
          await supabase.from("media_jobs").insert({
            organization_id: message.session.organization_id,
            message_id: message.id,
            session_id: message.session_id,
            conversation_id: message.conversation_id,
            message_key: { id: message.message_id },
            media_type: message.message_type,
            media_mime_type: message.media_mime_type,
            status: 'pending',
            attempts: 0,
            next_retry_at: new Date().toISOString(),
          });
        } else {
          // Reset existing job
          await supabase
            .from("media_jobs")
            .update({
              status: 'pending',
              attempts: 0,
              next_retry_at: new Date().toISOString(),
              error_message: null,
            })
            .eq("id", existingJob.id);
        }
      }

      return new Response(
        JSON.stringify({ success: true, message: "Retry scheduled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Safety net: every worker run also creates missing jobs for recent pending media.
    // This keeps media recoverable if a webhook insert succeeds but job creation is skipped.
    const { data: orphanCandidates } = await supabase
      .from("whatsapp_messages")
      .select(`
        id,
        session_id,
        conversation_id,
        message_type,
        media_mime_type,
        message_id,
        from_me,
        metadata,
        session:whatsapp_sessions(organization_id),
        conversation:whatsapp_conversations(remote_jid)
      `)
      .eq("media_status", "pending")
      .is("media_url", null)
      .is("media_storage_path", null)
      .in("message_type", ["image", "audio", "video", "document", "sticker"])
      .gte("sent_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .order("sent_at", { ascending: false })
      .limit(50);

    let autoCreatedJobs = 0;
    for (const msg of orphanCandidates || []) {
      const { data: existing } = await supabase
        .from("media_jobs")
        .select("id")
        .eq("message_id", msg.id)
        .in("status", ["pending", "processing", "completed"])
        .maybeSingle();

      if (existing) continue;

      const orgId = (msg as any).session?.organization_id;
      const remoteJid = (msg as any).conversation?.remote_jid;
      if (!orgId || !remoteJid) continue;

      const metadataObj = (msg as any).metadata || {};
      const mediaPayload = metadataObj.media_payload || metadataObj.raw_message || null;

      const { error: autoJobError } = await supabase.from("media_jobs").insert({
        organization_id: orgId,
        message_id: msg.id,
        session_id: msg.session_id,
        conversation_id: msg.conversation_id,
        message_key: {
          id: msg.message_id,
          remoteJid,
          fromMe: msg.from_me,
          media: mediaPayload,
        },
        media_type: msg.message_type,
        media_mime_type: msg.media_mime_type,
        status: "pending",
        attempts: 0,
        next_retry_at: new Date().toISOString(),
      });

      if (!autoJobError) autoCreatedJobs++;
    }

    if (autoCreatedJobs > 0) {
      console.log(`Auto-created ${autoCreatedJobs} media jobs for orphan pending messages`);
    }

    // Fetch pending media jobs
    const { data: jobs, error: fetchError } = await supabase
      .from("media_jobs")
      .select("*")
      .eq("status", "pending")
      .lte("next_retry_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(10);

    if (fetchError) {
      console.error("Error fetching media jobs:", fetchError);
      return new Response(
        JSON.stringify({ success: false, error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${jobs?.length || 0} media jobs`);

    const results = [];

    for (const job of jobs || []) {
      try {
        // Mark job as processing
        await supabase
          .from("media_jobs")
          .update({ status: "processing", updated_at: new Date().toISOString() })
          .eq("id", job.id);

        // Get session info
        const { data: session } = await supabase
          .from("whatsapp_sessions")
          .select("*")
          .eq("id", job.session_id)
          .single();

        if (!session) {
          throw new Error("Session not found");
        }

        // Try multiple strategies to download media
        let mediaContent: Uint8Array | null = null;
        const messageId = job.message_key?.id;
        const failureReasons: string[] = [];
        let messageNotFound = false;

        if (session.provider === "evolution_go") {
          const token = (session.advanced_settings as any)?.token || EVOLUTION_GO_API_KEY;
          const resultGo = await tryEvolutionGoDownloadMedia(
            EVOLUTION_GO_API_URL,
            token,
            session.instance_id || session.instance_name,
            pickGoMediaPayload(job.message_key, job.media_type),
            job.media_mime_type || "",
          );

          if (resultGo.content) {
            mediaContent = resultGo.content;
          } else {
            failureReasons.push(`GO: ${resultGo.error || "Unknown error"}`);
          }
        } else if (EVOLUTION_API_URL && messageId) {
          const token = (session.advanced_settings as any)?.token || EVOLUTION_API_KEY;
          if (token) {
            // Strategy 1a: getBase64FromMediaMessage with full key
            let result1 = await tryGetBase64(
              EVOLUTION_API_URL,
              token,
              session.instance_name,
              job.message_key,
              job.media_type,
              job.media_mime_type || ""
            );

            // Strategy 1b: retry with minimal key { id } — Evolution sometimes
            // rejects extra fields (remoteJidAlt, addressingMode, empty participant).
            if (!result1.content && /Message not found/i.test(result1.error || "")) {
              console.log("Retrying Strategy 1 with minimal key { id } only...");
              result1 = await tryGetBase64(
                EVOLUTION_API_URL,
                token,
                session.instance_name,
                { id: messageId },
                job.media_type,
                job.media_mime_type || ""
              );
            }

            if (result1.content) {
              mediaContent = result1.content;
            } else {
              const err = result1.error || "Unknown error";
              failureReasons.push(`S1: ${err}`);
              if (/Message not found/i.test(err)) messageNotFound = true;

              const isDiagnostic = Deno.env.get("DEBUG_MEDIA") === "true";
              if (isDiagnostic) {
                const result2 = await tryDownloadMedia(
                  EVOLUTION_API_URL,
                  token,
                  session.instance_name,
                  job.message_key,
                  job.media_mime_type || ""
                );
                if (result2.content) {
                  mediaContent = result2.content;
                } else {
                  failureReasons.push(`S2: ${result2.error || "Unknown error"}`);
                }
              } else {
                failureReasons.push("S2 skipped (non-diagnostic mode)");
              }
            }
          } else {
            failureReasons.push("Missing Evolution API key");
          }
        } else {
          failureReasons.push("Missing configuration or message ID");
        }

        if (mediaContent && mediaContent.length > 100) {
          // Store in Supabase Storage with standardized path
          // Usa job.message_id (UUID interno) como fallback se o messageId do WhatsApp não estiver disponível
          const extension = getExtensionFromMime(job.media_mime_type || "");
          const safeFileId = messageId || job.message_id;
          const filePath = `orgs/${session.organization_id}/sessions/${session.id}/media/${safeFileId}.${extension}`;
          
          const { error: uploadError } = await supabase.storage
            .from("whatsapp-media")
            .upload(filePath, mediaContent, {
              contentType: job.media_mime_type?.split(";")[0] || "application/octet-stream",
              upsert: true,
            });

          if (uploadError) {
            throw new Error(`Upload failed: ${uploadError.message}`);
          }

          // Success - update message
          await supabase
            .from("whatsapp_messages")
            .update({
              media_url: null,
              media_storage_path: filePath,
              media_status: "ready",
              media_error: null,
            })
            .eq("id", job.message_id);

          // Mark job as completed
          await supabase
            .from("media_jobs")
            .update({
              status: "completed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          console.log(`Job ${job.id} completed: ${filePath}`);
          results.push({ job_id: job.id, status: "completed", media_storage_path: filePath });
        } else {
          const reason = mediaContent ? `Media too small: ${mediaContent.length} bytes` : failureReasons.join(" | ");
          const isValidationError = reason.includes("Magic bytes validation failed");
          // Fail fast also when Evolution can't find the message — retrying won't help
          const isUnrecoverable = isValidationError || messageNotFound;

          if (isUnrecoverable) {
            const errorLabel = isValidationError
              ? `Falha de validação: ${reason}`
              : `Mídia indisponível: a Evolution não encontrou esta mensagem (provavelmente expirou no servidor do WhatsApp).`;

            await supabase
              .from("whatsapp_messages")
              .update({
                media_status: "failed",
                media_error: errorLabel,
              })
              .eq("id", job.message_id);

            await supabase
              .from("media_jobs")
              .update({
                status: "failed",
                error_message: reason,
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id);

            results.push({ job_id: job.id, status: "failed", error: reason });
            continue;
          }

          throw new Error(`Could not download media. ${reason}`);
        }

      } catch (error) {
        console.error(`Error processing job ${job.id}:`, error);
        
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const newAttempts = job.attempts + 1;
        const isFinalAttempt = newAttempts >= job.max_attempts;

        if (isFinalAttempt) {
          // Mark as permanently failed
          await supabase
            .from("whatsapp_messages")
            .update({
              media_status: "failed",
              media_error: `Falha após ${newAttempts} tentativas: ${errorMessage}`,
            })
            .eq("id", job.message_id);

          await supabase
            .from("media_jobs")
            .update({
              status: "failed",
              error_message: errorMessage,
              attempts: newAttempts,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          console.log(`Job ${job.id} permanently failed after ${newAttempts} attempts`);
        } else {
          // Schedule retry with exponential backoff
          // Backoff: 30s, 2min, 8min, 30min
          const backoffSeconds = Math.pow(4, newAttempts) * 30;
          const nextRetry = new Date(Date.now() + backoffSeconds * 1000);

          await supabase
            .from("media_jobs")
            .update({
              status: "pending",
              attempts: newAttempts,
              next_retry_at: nextRetry.toISOString(),
              error_message: errorMessage,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          console.log(`Job ${job.id} retry scheduled in ${backoffSeconds}s (attempt ${newAttempts})`);
        }

        results.push({
          job_id: job.id,
          status: isFinalAttempt ? "failed" : "retry_scheduled",
          error: errorMessage,
          attempt: newAttempts,
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Media worker error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Strategy 1: Try getBase64FromMediaMessage with retries
async function tryGetBase64(
  apiUrl: string,
  apiKey: string,
  instanceName: string,
  messageKey: any,
  mediaType: string,
  expectedMime: string
): Promise<{ content: Uint8Array | null; error?: string }> {
  console.log("Strategy 1: Trying getBase64FromMediaMessage...");
  
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  let lastError = "";
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt > 1) {
        await delay(2000 * attempt);
      }

      const response = await fetch(
        `${apiUrl}/chat/getBase64FromMediaMessage/${instanceName}`,
        {
          method: "POST",
          headers: {
            "apikey": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: { key: messageKey },
            // Only convert to mp4 for videos as per requirement
            convertToMp4: mediaType === "video",
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const base64 = data.base64;
        
        if (base64) {
          const normalized = normalizeBase64(base64);
          if (!isValidBase64(normalized)) {
            lastError = `Invalid base64 received (attempt ${attempt})`;
            continue;
          }

          const content = decode(normalized);
          
          if (validateMagicBytes(content, expectedMime)) {
            console.log(`Strategy 1 success on attempt ${attempt}`);
            return { content };
          } else {
            lastError = `Magic bytes validation failed (attempt ${attempt})`;
            console.warn(`Magic bytes validation failed for ${expectedMime}`);
          }
        } else {
          lastError = `No base64 in response (attempt ${attempt})`;
        }
      } else {
        const text = await response.text();
        lastError = `HTTP ${response.status}: ${text.substring(0, 100)} (attempt ${attempt})`;
      }
    } catch (e) {
      lastError = `${e instanceof Error ? e.message : String(e)} (attempt ${attempt})`;
      console.error(`Strategy 1 attempt ${attempt} error:`, e);
    }
  }
  
  return { content: null, error: lastError };
}

// Strategy 2: Try downloadMedia endpoint
async function tryDownloadMedia(
  apiUrl: string,
  apiKey: string,
  instanceName: string,
  messageKey: any,
  expectedMime: string
): Promise<{ content: Uint8Array | null; error?: string }> {
  console.log("Strategy 2: Trying downloadMedia endpoint...");
  
  const endpoints = [
    `${apiUrl}/chat/downloadMedia/${instanceName}`,
    `${apiUrl}/message/downloadMedia/${instanceName}`,
  ];

  const errors: string[] = [];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "apikey": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: { key: messageKey } }),
      });

      if (response.ok) {
        const contentType = response.headers.get("content-type") || "";
        
        if (!contentType.includes("application/json")) {
          const buffer = await response.arrayBuffer();
          const content = new Uint8Array(buffer);
          
          if (content.length > 100 && validateMagicBytes(content, expectedMime)) {
            console.log(`Strategy 2 success: ${content.length} bytes`);
            return { content };
          }
          errors.push(`${endpoint}: Validation failed or too small (${content.length} bytes)`);
        } else {
          const data = await response.json();
          const base64 = data.base64;
          if (base64) {
            const normalized = normalizeBase64(base64);
            const content = decode(normalized);
            if (validateMagicBytes(content, expectedMime)) {
              console.log("Strategy 2 success via base64");
              return { content };
            }
            errors.push(`${endpoint}: Magic bytes validation failed`);
          } else {
            errors.push(`${endpoint}: No base64 in JSON response`);
          }
        }
      } else {
        const text = await response.text();
        errors.push(`${endpoint}: HTTP ${response.status} - ${text.substring(0, 50)}`);
      }
    } catch (e) {
      errors.push(`${endpoint}: ${e instanceof Error ? e.message : String(e)}`);
      console.log(`Endpoint ${endpoint} failed:`, e);
    }
  }

  return { content: null, error: errors.join(" | ") };
}

async function tryEvolutionGoDownloadMedia(
  apiUrl: string,
  apiKey: string,
  instanceId: string,
  media: any,
  expectedMime: string
): Promise<{ content: Uint8Array | null; error?: string }> {
  if (!apiUrl || !apiKey || !instanceId) return { content: null, error: "Missing Evolution Go configuration" };
  if (!media || typeof media !== "object") return { content: null, error: "Missing media payload" };

  // Evolution Go (Xungoo/Whatsmeow) utiliza a rota /message/downloadimage como endpoint único para download e descriptografia de qualquer tipo de mídia
  const endpoints = [
    "/message/downloadimage",
    "/message/downloadMedia",
    "/message/downloadmedia",
    "/chat/downloadMedia",
    "/chat/downloadmedia",
    "/media/download",
  ];
  const errors: string[] = [];
  const payloads = [
    media,
    { media },
    { message: media },
    { message: { key: media } },
  ];

  for (const endpoint of endpoints) {
    for (const payload of payloads) {
    try {
      const response = await fetch(`${apiUrl}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": apiKey,
          "instanceId": instanceId,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        errors.push(`${endpoint}: HTTP ${response.status}: ${text.substring(0, 120)}`);
        continue;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const buffer = await response.arrayBuffer();
        const content = new Uint8Array(buffer);
        if (content.length > 100 && validateMagicBytes(content, expectedMime)) {
          console.log(`Evolution Go ${endpoint} success: ${content.length} bytes`);
          return { content };
        }
        errors.push(`${endpoint}: Invalid binary (${content.length} bytes)`);
        continue;
      }

      const data = await response.json();
      const rawBase64 =
        data.base64 ||
        data.image ||
        data.audio ||
        data.video ||
        data.document ||
        data.sticker ||
        data.media ||
        data.file ||
        data.url ||
        data.data?.base64 ||
        data.data?.image ||
        data.data?.audio ||
        data.data?.video ||
        data.data?.document ||
        data.data?.sticker ||
        data.data?.media ||
        data.data?.file;

      if (typeof rawBase64 !== "string") {
        errors.push(`${endpoint}: No media content in JSON response`);
        continue;
      }

      const normalized = normalizeBase64(rawBase64);
      if (!isValidBase64(normalized)) {
        errors.push(`${endpoint}: Invalid base64`);
        continue;
      }

      const content = decode(normalized);
      if (content.length > 100 && validateMagicBytes(content, expectedMime)) {
        console.log(`Evolution Go ${endpoint} (base64) success: ${content.length} bytes`);
        return { content };
      }
      errors.push(`${endpoint}: Magic bytes validation failed or too small (${content.length} bytes)`);

    } catch (e) {
      errors.push(`${endpoint}: ${e instanceof Error ? e.message : String(e)}`);
    }
    }
  }

  return { content: null, error: errors.join(" | ") };
}


function getExtensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/heic": "heic",
    "video/mp4": "mp4",
    "video/3gpp": "3gp",
    "video/quicktime": "mov",
    "audio/ogg": "ogg",
    "audio/ogg; codecs=opus": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/csv": "csv",
  };
  return map[mime] || mime.split("/")[1]?.split(";")[0] || "bin";
}
