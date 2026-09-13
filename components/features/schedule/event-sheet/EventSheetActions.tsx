import { CheckCircle, Clock, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EventSheetActions({
  canManageSchedule,
  isExisting,
  isMasked,
  isCompleted,
  canReopen,
  canDelete,
  requiresAttendanceOutcome,
  isLoading,
  locked,
  isEditing,
  canSubmit,
  onDelete,
  onMarkDone,
  onReopen,
  onReset,
  onStartEditing,
  onClose,
  onSubmit,
}: {
  canManageSchedule: boolean;
  isExisting: boolean;
  isMasked: boolean;
  isCompleted: boolean;
  canReopen: boolean;
  canDelete: boolean;
  requiresAttendanceOutcome: boolean;
  isLoading: boolean;
  locked: boolean;
  isEditing: boolean;
  canSubmit: boolean;
  onDelete: () => void;
  onMarkDone: () => void;
  onReopen: () => void;
  onReset: () => void;
  onStartEditing: () => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--app-border)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:border-t-0 sm:px-5 sm:py-4">
      {canManageSchedule && isExisting && !isMasked && canDelete ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-10 w-10 rounded-[6px] border-0 bg-destructive/10 p-0 text-destructive shadow-none hover:bg-destructive/15 hover:text-destructive sm:h-9 sm:w-9"
              aria-label="Excluir atividade"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] !shadow-none">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-[14px] font-light">
                Excluir atividade?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-[12px] font-light leading-[18px]">
                Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]">
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={onDelete}
                className="h-9 rounded-[6px] border-0 bg-destructive/15 text-[12px] font-light text-destructive shadow-none hover:bg-destructive hover:text-destructive-foreground"
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : canManageSchedule && isExisting && !isMasked && !canDelete ? (
        <span
          title="Visitas e reuniões finalizadas permanecem no histórico."
          className="shrink-0 text-[11px] font-light text-[var(--app-text-tertiary)]"
        >
          Histórico preservado
        </span>
      ) : (
        <span />
      )}

      <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
        {canManageSchedule &&
          isExisting &&
          !isMasked &&
          !isCompleted &&
          !isEditing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onMarkDone}
              disabled={isLoading}
              className="h-10 gap-1.5 rounded-[6px] border-0 bg-emerald-500/15 px-3 text-[12px] font-light text-emerald-600 shadow-none hover:bg-emerald-500/25 hover:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-200 sm:h-9"
            >
              <CheckCircle size={13} />
              {requiresAttendanceOutcome ? "Resultado ou remarcar" : "Concluir"}
            </Button>
          )}
        {canManageSchedule &&
          isExisting &&
          !isMasked &&
          isCompleted &&
          canReopen && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReopen}
              disabled={isLoading}
              className="h-10 gap-1.5 rounded-[6px] border-0 bg-amber-500/15 px-3 text-[12px] font-light text-amber-700 shadow-none hover:bg-amber-500/25 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200 sm:h-9"
            >
              <Clock size={13} /> Corrigir status
            </Button>
          )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (canManageSchedule && isExisting && !isMasked && !isCompleted) {
              if (isEditing) onReset();
              else onStartEditing();
              return;
            }
            onClose();
          }}
          disabled={isLoading}
          className={cn(
            "h-10 min-w-0 rounded-[6px] border-0 text-[12px] font-light shadow-none sm:h-9",
            !locked
              ? "order-1 flex-[3] bg-[var(--app-surface-soft)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
              : "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
          )}
        >
          {canManageSchedule && isExisting && !isMasked && !isCompleted
            ? isEditing
              ? "Cancelar"
              : "Editar"
            : "Fechar"}
        </Button>
        {!locked && (
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={!canSubmit || isLoading}
            className="order-2 h-10 min-w-0 flex-[7] rounded-[6px] border-0 bg-primary px-5 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary/90 hover:text-primary-foreground sm:h-9 sm:px-7"
          >
            {isLoading ? "Salvando..." : isExisting ? "Salvar" : "Adicionar"}
          </Button>
        )}
      </div>
    </div>
  );
}
