import { useDashboardAlerts } from "@/hooks/use-dashboard-alerts";
import { Clock, ChevronRight } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export function DashboardAlertBar() {
  const { data: alerts, isLoading } = useDashboardAlerts();
  const router = useRouter();

  if (isLoading || !alerts || alerts.total === 0) return null;

  return (
    <div className="space-y-2 mb-6">
      {alerts.finance.length > 0 && (
        <Alert className="flex items-center justify-between border-amber-500/20 bg-amber-500/[0.08] py-3 text-amber-200">
          <div className="flex items-center gap-3">
            <Clock className="h-4 w-4 text-amber-300" />
            <div>
              <AlertTitle className="text-xs font-bold uppercase tracking-tight">Financeiro Pendente</AlertTitle>
              <AlertDescription className="text-xs">
                Você possui {alerts.finance.length} contas vencidas aguardando pagamento.
              </AlertDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs font-bold text-amber-100 hover:bg-amber-500/10"
            onClick={() => router.push("/financeiro/contas")}
          >
            Ir para Contas
            <ChevronRight className="ml-1 h-3 w-3" />
          </Button>
        </Alert>
      )}
    </div>
  );
}
