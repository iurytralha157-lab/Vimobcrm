import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Phone, MessageCircle, Mail, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TaskOutcome =
  // Call outcomes
  | 'answered'
  | 'not_answered'
  | 'invalid_number'
  | 'busy'
  | 'scheduled'
  // Message outcomes
  | 'replied'
  | 'seen_no_reply'
  | 'not_seen'
  | 'no_whatsapp'
  // Email outcomes
  | 'not_replied'
  | 'bounced';

interface OutcomeOption {
  value: TaskOutcome;
  label: string;
  description?: string;
}

const callOutcomes: OutcomeOption[] = [
  { value: 'answered', label: 'Atendeu - Conversamos', description: 'Consegui falar com o lead' },
  { value: 'not_answered', label: 'Não atendeu / Caixa postal', description: 'Chamou mas não atendeu' },
  { value: 'invalid_number', label: 'Número inexistente', description: 'Número não existe ou está errado' },
  { value: 'busy', label: 'Linha ocupada', description: 'Linha estava ocupada' },
  { value: 'scheduled', label: 'Agendou retorno', description: 'Combinou de ligar depois' },
];

const messageOutcomes: OutcomeOption[] = [
  { value: 'replied', label: 'Respondeu', description: 'Lead respondeu a mensagem' },
  { value: 'seen_no_reply', label: 'Visualizou mas não respondeu', description: 'Viu mas não respondeu' },
  { value: 'not_seen', label: 'Não visualizou', description: 'Ainda não viu a mensagem' },
  { value: 'no_whatsapp', label: 'Número sem WhatsApp', description: 'O número não tem WhatsApp' },
  { value: 'scheduled', label: 'Agendou visita/reunião', description: 'Marcou um compromisso' },
];

const emailOutcomes: OutcomeOption[] = [
  { value: 'replied', label: 'Respondeu', description: 'Lead respondeu o email' },
  { value: 'not_replied', label: 'Não respondeu', description: 'Enviado mas sem resposta' },
  { value: 'bounced', label: 'Email inválido / Retornou', description: 'Email voltou ou não existe' },
];

const outcomesByType: Record<string, OutcomeOption[]> = {
  call: callOutcomes,
  message: messageOutcomes,
  email: emailOutcomes,
};

const typeLabels: Record<string, string> = {
  call: 'ligação',
  message: 'mensagem',
  email: 'email',
};

const typeIcons: Record<string, typeof Phone> = {
  call: Phone,
  message: MessageCircle,
  email: Mail,
};

interface TaskOutcomeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskType: 'call' | 'message' | 'email' | 'note';
  taskTitle: string;
  onConfirm: (outcome: TaskOutcome, notes: string) => void | Promise<void>;
  isLoading?: boolean;
}

export function TaskOutcomeDialog({
  open,
  onOpenChange,
  taskType,
  onConfirm,
  isLoading = false,
}: TaskOutcomeDialogProps) {
  const [selectedOutcome, setSelectedOutcome] = useState<TaskOutcome | ''>('');
  const [notes, setNotes] = useState('');

  const outcomes = outcomesByType[taskType] || [];
  const typeLabel = typeLabels[taskType] || 'tarefa';
  const TypeIcon = typeIcons[taskType] || Phone;

  const handleConfirm = async () => {
    if (!selectedOutcome) return;
    try {
      await onConfirm(selectedOutcome, notes);
      setSelectedOutcome('');
      setNotes('');
    } catch {
      // The owning mutation reports the error; keep the selection so the user can retry.
    }
  };

  const handleClose = () => {
    if (isLoading) return;
    onOpenChange(false);
    setSelectedOutcome('');
    setNotes('');
  };

  // For note type, we don't need outcomes - just complete it
  if (taskType === 'note') {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent
        className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 text-[var(--app-text-primary)] shadow-none sm:max-w-xl"
        onEscapeKeyDown={(event) => {
          if (isLoading) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('[data-radix-popper-content-wrapper], [role="listbox"]')) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-normal">
            <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-primary/10">
              <TypeIcon className="h-3.5 w-3.5 text-primary" />
            </div>
            <span>Como foi essa {typeLabel}?</span>
          </DialogTitle>
        </DialogHeader>

        <div className="py-1">
          <RadioGroup
            value={selectedOutcome}
            onValueChange={(value) => setSelectedOutcome(value as TaskOutcome)}
            className="grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            {outcomes.map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-[6px] border p-2.5 font-light transition-colors",
                  selectedOutcome === option.value
                    ? "border-transparent bg-primary/10 dark:bg-primary/20 text-primary"
                    : "border-[var(--app-border)] bg-[var(--app-surface-soft)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]"
                )}
              >
                <RadioGroupItem
                  value={option.value}
                  className={cn(
                    "mt-1 shrink-0 transition-colors rounded-[4px]",
                    selectedOutcome === option.value
                      ? "border-primary text-primary"
                      : "border-muted-foreground/40 text-muted-foreground/40"
                  )}
                />
                <div className="flex-1">
                  <p className="font-light text-xs leading-tight">{option.label}</p>
                  {option.description && (
                      <p className="mt-0.5 text-[10px] font-light leading-normal text-muted-foreground/75">
                      {option.description}
                    </p>
                  )}
                </div>
              </label>
            ))}
          </RadioGroup>

          <div className="mt-3">
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Adicione detalhes sobre essa tentativa..."
              className="resize-none text-xs font-light"
              rows={2}
            />
          </div>
        </div>

        <div className="flex gap-2 pt-0.5">
          <Button variant="outline" className="h-8 w-[40%] rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light shadow-none hover:bg-[var(--app-surface-hover)]" onClick={handleClose} disabled={isLoading}>
            Cancelar
          </Button>
          <Button
            className="h-8 w-[60%] rounded-[6px] text-xs font-light shadow-none"
            onClick={() => void handleConfirm()}
            disabled={!selectedOutcome || isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                Salvando...
              </>
            ) : (
              'Registrar'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Helper to get outcome label
export function getOutcomeLabel(outcome: TaskOutcome | string | null | undefined): string {
  if (!outcome) return '';

  const allOutcomes = [...callOutcomes, ...messageOutcomes, ...emailOutcomes];
  const found = allOutcomes.find((o) => o.value === outcome);
  return found?.label || outcome;
}

// Helper to determine if outcome is positive/negative
export function getOutcomeVariant(outcome: TaskOutcome | string | null | undefined): 'success' | 'warning' | 'error' | 'default' {
  if (!outcome) return 'default';

  const positiveOutcomes = ['answered', 'replied', 'scheduled'];
  const negativeOutcomes = ['invalid_number', 'no_whatsapp', 'bounced'];

  if (positiveOutcomes.includes(outcome)) return 'success';
  if (negativeOutcomes.includes(outcome)) return 'error';
  return 'warning';
}
