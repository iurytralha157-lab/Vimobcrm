import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { XCircle, Loader2 } from 'lucide-react';
import { DEFAULT_LOSS_REASON_OPTIONS, LOSS_REASON_OTHER_VALUE } from '@/config/constants';
import { cn } from '@/lib/utils';
import { lostReasonSchema } from '@/lib/validation';

interface LostReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void | Promise<void>;
  leadName?: string;
  loading?: boolean;
}

export function LostReasonDialog({
  open,
  onOpenChange,
  onConfirm,
  leadName,
  loading = false,
}: LostReasonDialogProps) {
  const [selectedReason, setSelectedReason] = useState('');
  const [details, setDetails] = useState('');

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) {
        setSelectedReason('');
        setDetails('');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const finalReason = buildLostReasonValue(selectedReason, details);
  const reasonValidation = lostReasonSchema.safeParse(finalReason);
  const isOtherSelected = selectedReason === LOSS_REASON_OTHER_VALUE;

  const handleConfirm = async () => {
    if (!reasonValidation.success) return;
    await onConfirm(reasonValidation.data);
  };

  const handleClose = () => {
    if (!loading) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="w-[92vw] max-w-[92vw] max-h-[85vh] overflow-y-auto rounded-xl sm:max-w-xl p-5"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('[data-radix-popper-content-wrapper], [role="listbox"]')) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-extralight">
            <div className="h-7 w-7 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="h-3.5 w-3.5 text-destructive" />
            </div>
            <span>Marcar como perdido</span>
          </DialogTitle>
          <DialogDescription className="text-xs font-extralight text-muted-foreground/80 mt-1">
            {leadName ? (
              <>
                Por que o lead <span className="font-medium text-foreground">{leadName}</span> foi descartado?
              </>
            ) : (
              'Por que esse lead foi descartado?'
            )}{' '}
            O motivo será registrado no histórico.
          </DialogDescription>
        </DialogHeader>

        <div className="py-1">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {DEFAULT_LOSS_REASON_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelectedReason(option.value)}
                disabled={loading}
                className={cn(
                  "flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer text-left transition-all focus:outline-none focus:ring-1 focus:ring-destructive/30",
                  selectedReason === option.value
                    ? "border-transparent bg-destructive/10 dark:bg-destructive/20 text-destructive"
                    : "border-[var(--app-border)] bg-[var(--app-surface-soft)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]"
                )}
              >
                <div
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 rounded-[4px] border flex items-center justify-center transition-colors",
                    selectedReason === option.value
                      ? "border-destructive bg-destructive text-white"
                      : "border-muted-foreground/40"
                  )}
                >
                  {selectedReason === option.value && (
                    <div className="h-1.5 w-1.5 rounded-sm bg-white" />
                  )}
                </div>
                <span className="font-light text-xs leading-tight">{option.label}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelectedReason(LOSS_REASON_OTHER_VALUE)}
              disabled={loading}
              className={cn(
                "flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer text-left transition-all focus:outline-none focus:ring-1 focus:ring-destructive/30",
                isOtherSelected
                  ? "border-transparent bg-destructive/10 dark:bg-destructive/20 text-destructive"
                  : "border-[var(--app-border)] bg-[var(--app-surface-soft)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]"
              )}
            >
              <div
                className={cn(
                  "h-3.5 w-3.5 shrink-0 rounded-[4px] border flex items-center justify-center transition-colors",
                  isOtherSelected
                    ? "border-destructive bg-destructive text-white"
                    : "border-muted-foreground/40"
                )}
              >
                {isOtherSelected && (
                  <div className="h-1.5 w-1.5 rounded-sm bg-white" />
                )}
              </div>
              <span className="font-light text-xs leading-tight">Outros</span>
            </button>
          </div>

          <div className="mt-3">
            <Textarea
              id="lost-reason-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={
                isOtherSelected
                  ? 'Descreva o motivo da perda aqui... *'
                  : 'Adicione detalhes adicionais (opcional)...'
              }
              className="resize-none text-xs font-light"
              rows={3}
              maxLength={240}
            />
            <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground/70 mt-1.5 px-0.5">
              <span className="truncate max-w-[80%]">{reasonValidation.success ? finalReason : 'Selecione uma opção ou descreva o motivo.'}</span>
              <span className="shrink-0">{finalReason.length}/300</span>
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-0.5 mt-3">
          <Button
            variant="outline"
            className="w-[40%] rounded-xl text-xs font-light"
            onClick={handleClose}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            className="w-[60%] rounded-xl text-xs font-light"
            onClick={handleConfirm}
            disabled={loading || !reasonValidation.success}
          >
            {loading ? (
              <>
                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                Salvando...
              </>
            ) : (
              'Confirmar perda'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function buildLostReasonValue(selectedReason: string, details: string) {
  const trimmedDetails = details.trim();

  if (selectedReason === LOSS_REASON_OTHER_VALUE) {
    return trimmedDetails ? `Outros: ${trimmedDetails}` : '';
  }

  const option = DEFAULT_LOSS_REASON_OPTIONS.find((item) => item.value === selectedReason);
  if (!option) {
    return trimmedDetails;
  }

  if (!trimmedDetails) {
    return option.label;
  }

  return `${option.label}: ${trimmedDetails}`;
}
