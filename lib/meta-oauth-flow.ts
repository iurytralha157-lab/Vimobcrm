import type { MetaOAuthFlowResult } from "@/lib/validation/integrations";

export function canUseMetaOAuthFlow(
  flow: MetaOAuthFlowResult,
  organizationId: string | null | undefined,
  now = Date.now(),
) {
  const expiresAt = Date.parse(flow.expires_at ?? "");
  return Boolean(
    organizationId &&
      flow.organization_id === organizationId &&
      flow.connectable &&
      flow.status === "success" &&
      !flow.consumed_at &&
      Number.isFinite(expiresAt) &&
      expiresAt > now &&
      flow.payload?.success === true &&
      flow.payload?.flow_id === flow.id &&
      flow.payload.pages.length > 0,
  );
}
