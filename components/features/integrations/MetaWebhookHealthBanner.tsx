import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { integrationsAPI } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getMetaWebhookFailureGuidance } from "@/components/features/integrations/meta-webhook-health";

const STATUS_LABELS: Record<string, string> = {
  failed: "falhas",
  skipped: "ignorados",
  duplicate: "duplicados",
};

export function MetaWebhookHealthBanner() {
  const { activeOrganization } = useAuth();
  const orgId = activeOrganization.organizationId;

  const { data } = useQuery({
    queryKey: ["meta-webhook-health", orgId],
    enabled: !!orgId,
    refetchInterval: 60_000,
    queryFn: () => integrationsAPI.metaWebhookHealth(orgId),
  });

  if (!data || data.missing) return null;

  const failed = data.counts.failed || 0;
  const skipped = data.counts.skipped || 0;
  if (failed === 0 && skipped === 0) return null;

  const variant: "destructive" | "default" = failed > 0 ? "destructive" : "default";
  const Icon = failed > 0 ? AlertTriangle : AlertCircle;
  const guidance = getMetaWebhookFailureGuidance(data.lastError);

  const parts: string[] = [];
  if (failed > 0) parts.push(`${failed} ${STATUS_LABELS.failed}`);
  if (skipped > 0) parts.push(`${skipped} ${STATUS_LABELS.skipped}`);

  return (
    <Alert variant={variant}>
      <Icon className="h-4 w-4" />
      <AlertTitle>Eventos Meta nos últimos 7 dias</AlertTitle>
      <AlertDescription className="space-y-1">
        <p>
          {parts.join(" e ")} no webhook do Meta.
          {skipped > 0 && " Leads ignorados normalmente significam formulário sem configuração ativa."}
        </p>
        {guidance && <p className="text-xs font-medium">{guidance}</p>}
        {data.lastError && <p className="text-xs opacity-80">Último motivo: {data.lastError}</p>}
      </AlertDescription>
    </Alert>
  );
}
