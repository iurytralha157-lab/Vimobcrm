import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { XCircle } from 'lucide-react';

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
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) setReason('');
    });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleConfirm = async () => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    await onConfirm(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!loading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-destructive" />
            Marcar como perdido
          </DialogTitle>
          <DialogDescription>
            {leadName
              ? <>Por que o lead <span className="font-medium text-foreground">{leadName}</span> foi descartado?</>
              : 'Por que esse lead foi descartado?'}
            {' '}O motivo será registrado no histórico.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="lost-reason">Motivo da perda *</Label>
          <Textarea
            id="lost-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: Sem orçamento, escolheu concorrente, não respondeu..."
            rows={4}
            autoFocus
            maxLength={500}
          />
          <div className="text-xs text-muted-foreground text-right">
            {reason.length}/500
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading || !reason.trim()}
          >
            {loading ? 'Salvando...' : 'Confirmar perda'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
