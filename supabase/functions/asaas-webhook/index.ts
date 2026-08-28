import {
  asaasPaymentWebhookShouldProvisionCardRecurrence,
  asaasWebhookRpcCall,
  constantTimeTextEqual,
  parseAsaasWebhook,
} from "../_shared/asaas-webhook.ts";
import { getSupabaseAdmin, jsonResponse } from "../_shared/asaas.ts";

const MAX_WEBHOOK_BYTES = 1_000_000;

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(
      { received: false, error: "Metodo nao permitido." },
      405,
    );
  }

  const configuredToken = Deno.env.get("ASAAS_WEBHOOK_TOKEN")?.trim() || "";
  if (configuredToken.length < 32 || configuredToken.length > 255) {
    console.error(
      "ASAAS_WEBHOOK_TOKEN is missing or does not meet the Asaas length requirements.",
    );
    return jsonResponse(
      { received: false, error: "Webhook indisponivel." },
      503,
    );
  }

  const providedToken = request.headers.get("asaas-access-token")?.trim() || "";
  if (!constantTimeTextEqual(providedToken, configuredToken)) {
    return jsonResponse(
      { received: false, error: "Webhook nao autorizado." },
      401,
    );
  }

  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return jsonResponse({
      received: false,
      error: "Payload excede o limite permitido.",
    }, 413);
  }

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).length > MAX_WEBHOOK_BYTES) {
      return jsonResponse({
        received: false,
        error: "Payload excede o limite permitido.",
      }, 413);
    }

    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ received: false, error: "JSON invalido." }, 400);
    }

    let webhook;
    try {
      webhook = parseAsaasWebhook(rawPayload);
    } catch (error) {
      return jsonResponse(
        {
          received: false,
          error: error instanceof Error ? error.message : "Payload invalido.",
        },
        400,
      );
    }

    const supabase = getSupabaseAdmin();
    const rpcCall = asaasWebhookRpcCall(webhook);
    const { data, error } = await supabase.rpc(rpcCall.name, rpcCall.args);

    if (error) {
      console.error("Failed to reconcile Asaas webhook.", {
        eventId: webhook.id,
        event: webhook.event,
        code: error.code,
      });
      return jsonResponse({
        received: false,
        error: "Falha ao reconciliar evento.",
      }, 500);
    }

    const result = data && typeof data === "object"
      ? data as Record<string, unknown>
      : {};

    if (
      asaasPaymentWebhookShouldProvisionCardRecurrence(webhook) &&
      result.outcome !== "unmatched"
    ) {
      // The canonical payment RPC atomically exposes the recurrence job. The
      // webhook never claims the job or performs provider work, so duplicate
      // deliveries remain idempotent and safe to acknowledge immediately.
      console.info("Paid card webhook reconciled for durable recurrence.", {
        eventId: webhook.id,
        event: webhook.event,
        outcome: result.outcome || "processed",
      });
    }

    if (result.outcome === "unmatched") {
      console.warn("Asaas webhook has no matching organization yet.", {
        eventId: webhook.id,
        event: webhook.event,
      });
    }

    return jsonResponse({
      received: true,
      outcome: result.outcome || "processed",
    });
  } catch (error) {
    console.error("Unexpected Asaas webhook failure.", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return jsonResponse(
      { received: false, error: "Falha interna no webhook." },
      500,
    );
  }
});
