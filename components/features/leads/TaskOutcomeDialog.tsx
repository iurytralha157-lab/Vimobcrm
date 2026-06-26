import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
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
  { value: 'invalid_number', label: 'Número inexistente / Errado', description: 'Número não existe ou está errado' },
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
  onConfirm: (outcome: TaskOutcome, notes: string) => void;
  isLoading?: boolean;
}

export function TaskOutcomeDialog({
  open,
  onOpenChange,
  taskType,
  taskTitle,
  onConfirm,
  isLoading = false,
}: TaskOutcomeDialogProps) {
  const [selectedOutcome, setSelectedOutcome] = useState<TaskOutcome | ''>('');
  const [notes, setNotes] = useState('');

  const outcomes = outcomesByType[taskType] || [];
  const typeLabel = typeLabels[taskType] || 'tarefa';
  const TypeIcon = typeIcons[taskType] || Phone;

  const handleConfirm = () => {
    if (!selectedOutcome) return;
    onConfirm(selectedOutcome, notes);
    // Reset state
    setSelectedOutcome('');
    setNotes('');
  };

  const handleClose = () => {
    onOpenChange(false);
    setSelectedOutcome('');
    setNotes('');
  };

  // For note type, we don't need outcomes - just complete it
  if (taskType === 'note') {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[92vw] max-w-[92vw] max-h-[80vh] overflow-y-auto rounded-lg sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <TypeIcon className="h-4 w-4 text-primary" />
            </div>
            <span>Como foi essa {typeLabel}?</span>
          </DialogTitle>
        </DialogHeader>

        <div className="py-2">
          <p className="text-sm text-muted-foreground mb-4">
            {taskTitle}
          </p>

          <RadioGroup
            value={selectedOutcome}
            onValueChange={(value) => setSelectedOutcome(value as TaskOutcome)}
            className="grid grid-cols-1 gap-2 md:grid-cols-2"
          >
            {outcomes.map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                  selectedOutcome === option.value
                    ? "border-primary bg-primary/5"
                    : "border-white/[0.055] hover:border-primary/50 hover:bg-white/[0.055]"
                )}
              >
                <RadioGroupItem value={option.value} className="mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-sm">{option.label}</p>
                  {option.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {option.description}
                    </p>
                  )}
                </div>
              </label>
            ))}
          </RadioGroup>

          <div className="mt-4">
            <Label htmlFor="notes" className="text-sm font-medium">
              Observação (opcional)
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Adicione detalhes sobre essa tentativa..."
              className="mt-2 resize-none"
              rows={3}
            />
          </div>
        </div>

        <div className="flex gap-2 pt-4">
          <Button variant="outline" className="w-[40%] rounded-xl" onClick={handleClose} disabled={isLoading}>
            Cancelar
          </Button>
          <Button
            className="w-[60%] rounded-xl"
            onClick={handleConfirm}
            disabled={!selectedOutcome || isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
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
