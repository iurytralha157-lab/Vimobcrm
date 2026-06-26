import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { integrationsAPI } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const STATUS_LABELS: Record<string, string> = {
  failed: "falhas",
  skipped: "ignorados",
  duplicate: "duplicados",
};

export function MetaWebhookHealthBanner() {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

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

  const parts: string[] = [];
  if (failed > 0) parts.push(`${failed} ${STATUS_LABELS.failed}`);
  if (skipped > 0) parts.push(`${skipped} ${STATUS_LABELS.skipped}`);

  return (
    <Alert variant={variant}>
      <Icon className="h-4 w-4" />
      <AlertTitle>Eventos Meta nos ultimos 7 dias</AlertTitle>
      <AlertDescription className="space-y-1">
        <p>
          {parts.join(" e ")} no webhook do Meta.
          {skipped > 0 && " Leads ignorados normalmente significam formulario sem configuracao ativa."}
        </p>
        {data.lastError && <p className="text-xs opacity-80">Ultimo motivo: {data.lastError}</p>}
      </AlertDescription>
    </Alert>
  );
}
