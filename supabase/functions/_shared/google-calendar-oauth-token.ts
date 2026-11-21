import {
  assertGoogleCalendarOAuthScope,
  googleCalendarFetchWithDeadline,
} from "./google-calendar-delivery.ts";

const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const VERIFICATION_FAILED =
  "Nao foi possivel verificar a autorizacao do Google Agenda. Tente conectar novamente.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// RFC 6749 section 5.1 permits an omitted scope. Verify it with Google rather
// than accepting scope echoed by the browser or assuming the requested grant.
export async function resolveGoogleCalendarOAuthTokenScope(
  token: unknown,
  expectedClientId: string,
): Promise<Record<string, unknown>> {
  if (!isRecord(token)) throw new Error(VERIFICATION_FAILED);

  if (Object.hasOwn(token, "scope")) {
    if (typeof token.scope !== "string" || !token.scope.trim()) {
      throw new Error(VERIFICATION_FAILED);
    }
    assertGoogleCalendarOAuthScope(token.scope);
    return token;
  }

  if (typeof token.access_token !== "string" || !token.access_token.trim() ||
    !expectedClientId.trim()) {
    throw new Error(VERIFICATION_FAILED);
  }

  try {
    const response = await googleCalendarFetchWithDeadline(GOOGLE_TOKEN_INFO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${token.access_token}`,
      },
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(VERIFICATION_FAILED);

    const info: unknown = await response.json();
    if (!isRecord(info) || typeof info.aud !== "string" ||
      info.aud !== expectedClientId || typeof info.scope !== "string" ||
      !info.scope.trim()) {
      throw new Error(VERIFICATION_FAILED);
    }
    assertGoogleCalendarOAuthScope(info.scope);
    console.info("google-calendar-oauth scopes verified via tokeninfo");
    return { ...token, scope: info.scope };
  } catch {
    // Provider payloads, request errors and credentials never escape this path.
    throw new Error(VERIFICATION_FAILED);
  }
}
