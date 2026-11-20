"use client";

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
import { Button } from "@/components/ui/button";
import { useDeleteProperty, usePropertyDeletionImpact, type Property } from "@/hooks/use-properties";
import { isPropertyWorkspaceConflict } from "@/lib/property-concurrency";

type PropertyDeleteDialogProps = {
  property: Property;
  onClose: () => void;
};

export function PropertyDeleteDialog({ property, onClose }: PropertyDeleteDialogProps) {
  const impact = usePropertyDeletionImpact(property);
  const deletion = useDeleteProperty();
  const checkingImpact = impact.isFetching || impact.isPending;
  const count = impact.isSuccess && !checkingImpact ? impact.data : undefined;
  const propertyLabel = property.code || property.title;
  const linkedLeadsWarning = count === 1
    ? "Este imóvel tem 1 lead vinculado. O lead será mantido e apenas desvinculado do imóvel."
    : count
      ? `Este imóvel tem ${count.toLocaleString("pt-BR")} leads vinculados. Os leads serão mantidos e apenas desvinculados do imóvel.`
      : null;

  const confirmDelete = async () => {
    if (count === undefined || deletion.isPending) return;
    try {
      await deletion.mutateAsync({
        id: property.id,
        expected_updated_at: property.updated_at,
        expected_linked_leads_count: count,
      });
      onClose();
    } catch (error) {
      if (isPropertyWorkspaceConflict(error)) onClose();
      // Other errors stay in the dialog while the mutation reports or refreshes the impact.
    }
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !deletion.isPending) onClose();
      }}
    >
      <AlertDialogContent className="w-[calc(100vw-24px)] max-w-[440px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 shadow-none">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[14px] font-normal">Excluir imóvel?</AlertDialogTitle>
          <AlertDialogDescription className="text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
            O imóvel{propertyLabel ? ` ${propertyLabel}` : ""} será removido da carteira. Esta ação não pode ser desfeita.
            <span className="mt-2 block empty:hidden" role="status">
              {checkingImpact
                ? "Verificando leads vinculados…"
                : impact.isError
                  ? "Não foi possível verificar os leads vinculados."
                  : linkedLeadsWarning}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={deletion.isPending}
            className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
          >
            Cancelar
          </AlertDialogCancel>
          {impact.isError && !impact.isFetching ? (
            <Button variant="outline" onClick={() => void impact.refetch()}>
              Tentar novamente
            </Button>
          ) : (
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
              disabled={count === undefined || deletion.isPending}
              className="h-9 rounded-[6px] bg-destructive/70 text-[12px] font-light text-destructive-foreground shadow-none hover:bg-destructive"
            >
              {deletion.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Excluir imóvel
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
