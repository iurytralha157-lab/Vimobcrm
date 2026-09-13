import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { SubscriptionPlan } from "@/lib/api/settings";
import { formatBillingMoney } from "@/lib/billing/subscription-presentation";

type PlanConfirmationDialogProps = {
  changingPlanId: string | null;
  managedPlanChangeAvailable: boolean;
  plan: SubscriptionPlan | null;
  onConfirm: (plan: SubscriptionPlan) => void;
  onOpenChange: (open: boolean) => void;
};

export function PlanConfirmationDialog({
  changingPlanId,
  managedPlanChangeAvailable,
  plan,
  onConfirm,
  onOpenChange,
}: PlanConfirmationDialogProps) {
  return (
    <AlertDialog open={Boolean(plan)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmar escolha do plano?</AlertDialogTitle>
          <AlertDialogDescription>
            {managedPlanChangeAvailable
              ? `A troca para ${plan?.name || "o plano selecionado"} será agendada para a próxima cobrança.`
              : `O plano ${plan?.name || "selecionado"} será preparado para o checkout por ${formatBillingMoney(plan?.price || 0)}.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={Boolean(changingPlanId)}>
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              if (plan) onConfirm(plan);
            }}
            disabled={!plan || Boolean(changingPlanId)}
          >
            {changingPlanId ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Confirmar plano
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
