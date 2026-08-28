import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push";
import { authorizePrivateWorkerRequest } from "../_shared/private-worker-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_VAPID_PUBLIC_KEY = "BC7q4HGKxwbHnzRl0uBTyTOm59GcEyxqM8fgSTGiSfNoxwYIIy8-HnbbpzQghQUzpzPmmifvn9t01EoTJaFa3uQ";

interface PushPayload {
  user_id: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  priority?: 'high' | 'normal';
}

interface WebPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// ==================== VAPID/Web Push Functions ====================

// Importa a chave privada VAPID
function getVapidKeys() {
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const publicKey =
    Deno.env.get("VAPID_PUBLIC_KEY") ||
    Deno.env.get("VITE_VAPID_PUBLIC_KEY") ||
    DEFAULT_VAPID_PUBLIC_KEY;
  
  if (!privateKey) {
    throw new Error("VAPID_PRIVATE_KEY not configured");
  }

  return { privateKey, publicKey };
}

// Base64URL encode/decode helpers
function base64UrlEncode(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const padding = '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Parse PEM private key
function parsePrivateKey(pem: string): Uint8Array {
  // Remove PEM headers if present
  const keyData = pem
    .replace(/-----BEGIN (EC )?PRIVATE KEY-----/g, '')
    .replace(/-----END (EC )?PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  
  return base64UrlDecode(keyData);
}

// Create VAPID JWT for authorization
async function createVapidJwt(audience: string, subject: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 12 * 60 * 60; // 12 hours

  const header = { alg: "ES256", typ: "JWT" };
  const payload = {
    aud: audience,
    exp: exp,
    sub: subject,
  };

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import the ECDSA private key
  const keyData = parsePrivateKey(privateKeyPem);
  
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData.buffer as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  // Sign the token
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  // Convert signature from DER to raw format (64 bytes: r + s)
  const sigArray = new Uint8Array(signature);
  const signatureB64 = base64UrlEncode(sigArray);

  return `${unsignedToken}.${signatureB64}`;
}

// Helper to extract raw P-256 key from SPKI/DER (91 bytes)
function getRawPublicKey(publicKeyB64: string): string {
  const normalized = publicKeyB64
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s/g, '');

  const bytes = base64UrlDecode(normalized);

  if (bytes.length === 91) {
    // Offset 26 is where the 65-byte raw uncompressed point starts
    return base64UrlEncode(bytes.slice(26));
  }

  if (bytes.length === 65) {
    return base64UrlEncode(bytes);
  }

  console.warn(`[WebPush] Invalid VAPID public key length (${bytes.length}); falling back to default frontend key.`);
  return getRawPublicKey(DEFAULT_VAPID_PUBLIC_KEY);
}

// Send Web Push notification
async function sendWebPushNotification(
  subscriptionJson: string,
  title: string,
  body: string,
  data: Record<string, any> = {},
  priority: 'high' | 'normal' = 'high'
): Promise<{ success: boolean; error?: string }> {
  try {
    const subscription: WebPushSubscription = JSON.parse(subscriptionJson);
    const { privateKey, publicKey } = getVapidKeys();

    const payload = JSON.stringify({
      title,
      body,
      data,
      priority,
      tag: `notification-${Date.now()}`,
    });

    console.log(`[WebPush] Sending to endpoint: ${subscription.endpoint.substring(0, 50)}...`);

    const rawPublicKey = getRawPublicKey(publicKey);

    webpush.setVapidDetails(
      Deno.env.get("VAPID_MAILTO") || "mailto:suporte@vimob.com.br",
      rawPublicKey,
      privateKey
    );

    await webpush.sendNotification(subscription, payload, {
      TTL: priority === 'high' ? 86400 : 3600,
      urgency: priority === 'high' ? "high" : "normal",
    });

    console.log("[WebPush] Sent successfully");
    return { success: true };

  } catch (error: any) {
    if (error?.statusCode === 404 || error?.statusCode === 410) {
      console.log("[WebPush] Subscription expired/invalid");
      return { success: false, error: "invalid_token" };
    }
    console.error("[WebPush] Error:", error);
    return { success: false, error: error?.body || error?.message || String(error) };
  }
}

// ==================== FCM Functions (existing) ====================

// Get Firebase access token using Service Account
async function getFirebaseAccessToken(): Promise<string> {
  const serviceAccountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!serviceAccountJson) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT not configured");
  }

  const serviceAccount = JSON.parse(serviceAccountJson);
  
  // Create JWT for Firebase auth
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  };

  // Base64URL encode
  const base64url = (str: string) => {
    return btoa(str)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signatureInput = `${headerB64}.${payloadB64}`;

  // Import private key and sign
  const pemContents = serviceAccount.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signatureInput)
  );

  const signatureB64 = base64url(
    String.fromCharCode(...new Uint8Array(signature))
  );

  const jwt = `${signatureInput}.${signatureB64}`;

  // Exchange JWT for access token
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const tokenData = await tokenResponse.json();
  
  if (!tokenResponse.ok) {
    console.error("Firebase token error:", tokenData);
    throw new Error(`Failed to get Firebase token: ${tokenData.error_description || tokenData.error}`);
  }

  return tokenData.access_token;
}

// Send push notification via FCM HTTP v1 API
async function sendFCMNotification(
  token: string,
  accessToken: string,
  title: string,
  body: string,
  data: Record<string, any> = {},
  priority: 'high' | 'normal' = 'high'
): Promise<{ success: boolean; error?: string }> {
  const serviceAccountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  const serviceAccount = JSON.parse(serviceAccountJson!);
  const projectId = serviceAccount.project_id;

  // Convert all data values to strings (FCM requirement)
  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)])
  );

  // FCM HTTP v1 message structure optimized for iOS lock screen visibility
  const message = {
    message: {
      token: token,
      // notification field is REQUIRED for automatic display on iOS/Android
      notification: {
        title: title,
        body: body,
      },
      // data payload for custom handling when app is open
      data: stringData,
      // Android-specific configuration
      android: {
        priority: priority,
        notification: {
          sound: "default",
          click_action: "FCM_PLUGIN_ACTIVITY",
          channel_id: "crm_notifications",
          default_sound: true,
          default_vibrate_timings: true,
          visibility: "PUBLIC",
        },
      },
      // iOS-specific configuration (CRITICAL for lock screen notifications)
      apns: {
        headers: {
          "apns-priority": priority === 'high' ? "10" : "5",
          "apns-push-type": "alert",
        },
        payload: {
          aps: {
            alert: {
              title: title,
              body: body,
            },
            sound: "default",
            badge: 1,
            "mutable-content": 1,
            "content-available": 1,
          },
        },
      },
    },
  };

  console.log(`[FCM] Sending to token: ${token.substring(0, 20)}...`);
  console.log(`[FCM] Project ID: ${projectId}`);
  console.log(`[FCM] Title: ${title}, Body: ${body?.substring(0, 50) || '(empty)'}...`);

  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("[FCM] Error response:", JSON.stringify(result));
      
      // Check for invalid token errors
      const errorCode = result.error?.details?.find((d: any) => 
        d.errorCode === "UNREGISTERED" || 
        d.errorCode === "INVALID_ARGUMENT" ||
        d["@type"]?.includes("BadRequest")
      );
      
      if (errorCode || result.error?.code === 404 || result.error?.code === 400) {
        console.log("[FCM] Token is invalid or unregistered");
        return { success: false, error: "invalid_token" };
      }
      
      return { success: false, error: result.error?.message || "FCM send failed" };
    }

    console.log("[FCM] Sent successfully, message ID:", result.name);
    return { success: true };
  } catch (error) {
    console.error("[FCM] Request error:", error);
    return { success: false, error: String(error) };
  }
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  if (!authorizePrivateWorkerRequest(req)) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const payload: PushPayload = await req.json();
    
    if (!payload.user_id || !payload.title) {
      return new Response(
        JSON.stringify({ error: "user_id and title are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Standard Push Notification Logic
    console.log(`Sending push to user: ${payload.user_id}, title: ${payload.title}`);


    // Get active push tokens for user
    const { data: tokens, error: tokensError } = await supabase
      .from("push_tokens")
      .select("id, token, platform")
      .eq("user_id", payload.user_id)
      .eq("is_active", true);

    if (tokensError) {
      console.error("Error fetching tokens:", tokensError);
      throw tokensError;
    }

    if (!tokens || tokens.length === 0) {
      console.log("No active push tokens found for user");
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No active tokens" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${tokens.length} active tokens`);

    // Get Firebase access token only if we have non-web tokens
    const hasNativeTokens = tokens.some(t => t.platform !== 'web');
    let accessToken: string | null = null;
    
    if (hasNativeTokens) {
      try {
        accessToken = await getFirebaseAccessToken();
      } catch (error) {
        console.error("Failed to get Firebase access token:", error);
        // Continue - we might still send to web tokens
      }
    }

    // Send to all tokens
    let sentCount = 0;
    let failedCount = 0;
    const invalidTokenIds: string[] = [];
    const failures: Array<{ token_id: string; platform: string; error: string }> = [];

    for (const tokenRecord of tokens) {
      let result: { success: boolean; error?: string };
      
      if (tokenRecord.platform === 'web') {
        // Send via Web Push
        console.log(`[Push] Sending Web Push to token ID: ${tokenRecord.id}`);
        result = await sendWebPushNotification(
          tokenRecord.token,
          payload.title,
          payload.body || "",
          payload.data || {},
          payload.priority || "high"
        );
      } else {
        // Send via FCM for native apps
        if (!accessToken) {
          console.error("[Push] No FCM access token available for native token");
          result = { success: false, error: "No FCM access token" };
        } else {
          result = await sendFCMNotification(
            tokenRecord.token,
            accessToken,
            payload.title,
            payload.body || "",
            payload.data || {},
            payload.priority || "high"
          );
        }
      }

      if (result.success) {
        sentCount++;
      } else {
        failedCount++;
        failures.push({
          token_id: tokenRecord.id,
          platform: tokenRecord.platform,
          error: result.error || "unknown_error",
        });
        if (result.error === "invalid_token") {
          invalidTokenIds.push(tokenRecord.id);
        }
      }
    }

    // Deactivate invalid tokens
    if (invalidTokenIds.length > 0) {
      console.log(`Deactivating ${invalidTokenIds.length} invalid tokens`);
      await supabase
        .from("push_tokens")
        .update({ is_active: false })
        .in("id", invalidTokenIds);
    }

    console.log(`Push sent: ${sentCount} success, ${failedCount} failed`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        sent: sentCount, 
        failed: failedCount,
        deactivated: invalidTokenIds.length,
        failures: failures.slice(0, 10),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Push notification error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
