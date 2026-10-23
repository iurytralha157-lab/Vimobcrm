import { useLayoutEffect, useRef, useState } from 'react';
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

export type TaskOutcomeDraft = {
  outcome: TaskOutcome | '';
  notes: string;
};

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
  onConfirm: (outcome: TaskOutcome, notes: string) => boolean | Promise<boolean>;
  isLoading?: boolean;
  confirmationBlockedReason?: string;
  confirmationRetry?: () => void;
  confirmationRetrying?: boolean;
  notesLimit?: number;
  draft?: TaskOutcomeDraft;
  onDraftChange?: (draft: TaskOutcomeDraft) => void;
}

export function TaskOutcomeDialog(props: TaskOutcomeDialogProps) {
  // Each opening/type owns its draft and pending callback. An older response
  // cannot clear a later opening, even when the controlled dialog stays mounted.
  return <TaskOutcomeDialogSession key={`${props.open}:${props.taskType}`} {...props} />;
}

function TaskOutcomeDialogSession({
  open,
  onOpenChange,
  taskType,
  onConfirm,
  isLoading = false,
  confirmationBlockedReason,
  confirmationRetry,
  confirmationRetrying = false,
  notesLimit,
  draft,
  onDraftChange,
}: TaskOutcomeDialogProps) {
  const [localDraft, setLocalDraft] = useState<TaskOutcomeDraft>({ outcome: '', notes: '' });
  const { outcome: selectedOutcome, notes } = draft ?? localDraft;
  const latestDraft = useRef(draft ?? localDraft);
  useLayoutEffect(() => { latestDraft.current = draft ?? localDraft; }, [draft, localDraft]);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const mountedRef = useRef(false);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const busy = isLoading || submitting;
  const notesTooLong = notesLimit !== undefined && Array.from(notes.trim()).length > notesLimit;
  const updateDraft = (next: TaskOutcomeDraft) => {
    // A controlled Query cache may notify after the next input event. Compose
    // that event with the latest edit, rather than an older rendered sibling.
    latestDraft.current = next;
    if (draft === undefined) setLocalDraft(next);
    onDraftChange?.(next);
  };

  const outcomes = outcomesByType[taskType] || [];
  const typeLabel = typeLabels[taskType] || 'tarefa';
  const TypeIcon = typeIcons[taskType] || Phone;

  const handleConfirm = async () => {
    if (!selectedOutcome || isLoading || submittingRef.current ||
      confirmationBlockedReason || confirmationRetrying || notesTooLong) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (await onConfirm(selectedOutcome, notes) === true && mountedRef.current) {
        updateDraft({ outcome: '', notes: '' });
      }
    } catch {
      // The owning mutation reports the error; keep the selection so the user can retry.
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (busy || submittingRef.current) return;
    updateDraft({ outcome: '', notes: '' });
    onOpenChange(false);
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
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (busy || target?.closest('[data-radix-popper-content-wrapper], [role="listbox"]')) {
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
            disabled={busy}
            value={selectedOutcome}
            onValueChange={(value) => updateDraft({ outcome: value as TaskOutcome, notes: latestDraft.current.notes })}
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
                      <p className="mt-0.5 text-xs font-light leading-normal text-muted-foreground/75">
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
              disabled={busy}
              aria-invalid={notesTooLong}
              onChange={(e) => updateDraft({ outcome: latestDraft.current.outcome, notes: e.target.value })}
              placeholder="Adicione detalhes sobre essa tentativa..."
              className="resize-none text-xs font-light"
              rows={2}
            />
            {notesTooLong && (
              <p role="alert" className="mt-1.5 text-xs font-light text-destructive">
                Use até {notesLimit} caracteres nas anotações. Seu texto foi mantido.
              </p>
            )}
          </div>
        </div>

        {confirmationBlockedReason && (
          <div className="space-y-2 rounded-[6px] bg-[var(--app-surface-soft)] p-2.5 text-xs font-light">
            <p role="status" className="text-muted-foreground">{confirmationBlockedReason}</p>
            {confirmationRetry && (
              <Button
                variant="ghost"
                className="h-8 rounded-[6px] px-2 text-xs font-light"
                disabled={busy || confirmationRetrying}
                onClick={confirmationRetry}
              >
                {confirmationRetrying ? 'Verificando...' : 'Tentar novamente'}
              </Button>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-0.5">
          <Button variant="outline" className="h-9 w-[40%] rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light shadow-none hover:bg-[var(--app-surface-hover)]" onClick={handleClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            className="h-9 w-[60%] rounded-[6px] text-xs font-light shadow-none"
            onClick={() => void handleConfirm()}
            disabled={!selectedOutcome || busy || Boolean(confirmationBlockedReason) || confirmationRetrying || notesTooLong}
          >
            {busy ? (
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
