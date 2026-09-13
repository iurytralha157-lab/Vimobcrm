import { Check, Lightbulb, Loader2, MessageCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EventSheet } from '@/components/features/schedule/EventSheet';
import { LeadAttachmentViewer } from '@/components/features/leads/LeadAttachmentViewer';
import { LostReasonDialog } from '@/components/features/leads/LostReasonDialog';
import {
  TaskOutcomeDialog,
  type TaskOutcome,
} from '@/components/features/leads/TaskOutcomeDialog';
import type { LeadAttachment } from '@/hooks/use-lead-attachments';
import type { EventType, ScheduleEvent } from '@/hooks/use-schedule-events';
import type { LeadCadenceTaskState } from '@/lib/validation';
import type {
  AssigneeScheduleConfirmation,
  LeadDetailLead,
  ReopenStatusConfirmation,
} from './types';
import { getCadenceTaskType } from './utils';

type LeadDetailOverlaysProps = {
  lead: LeadDetailLead;
  leadName: string;
  selectedTask: LeadCadenceTaskState | null;
  roteiroDialogOpen: boolean;
  onRoteiroDialogOpenChange: (open: boolean) => void;
  onRoteiroAction: (action: 'complete' | 'message') => void | Promise<void>;
  taskForOutcome: LeadCadenceTaskState | null;
  outcomeDialogOpen: boolean;
  onOutcomeDialogOpenChange: (open: boolean) => void;
  onOutcomeConfirm: (outcome: TaskOutcome, notes: string) => void | Promise<void>;
  quickActionOutcomeOpen: boolean;
  quickActionOutcomeType: 'call' | 'email';
  onQuickActionOutcomeOpenChange: (open: boolean) => void;
  onQuickActionOutcomeConfirm: (
    outcome: TaskOutcome,
    notes: string,
  ) => void | Promise<void>;
  cadenceTaskPending: boolean;
  quickActionPending: boolean;
  reopenStatusConfirmation: ReopenStatusConfirmation | null;
  onReopenStatusConfirmationChange: (confirmation: ReopenStatusConfirmation | null) => void;
  onConfirmReopen: (confirmation: ReopenStatusConfirmation) => void | Promise<void>;
  assigneeScheduleConfirmation: AssigneeScheduleConfirmation | null;
  onAssigneeScheduleConfirmationChange: (
    confirmation: AssigneeScheduleConfirmation | null,
  ) => void;
  onConfirmAssignee: (confirmation: AssigneeScheduleConfirmation) => void | Promise<void>;
  dealStatusPending: boolean;
  lostReasonDialogOpen: boolean;
  onLostReasonDialogOpenChange: (open: boolean) => void;
  onConfirmLostReason: (reason: string) => void | Promise<void>;
  selectedAttachment: LeadAttachment | null;
  onSelectedAttachmentChange: (attachment: LeadAttachment | null) => void;
  hasAgendaModule: boolean;
  scheduleFormOpen: boolean;
  onCloseScheduleForm: () => void;
  editingScheduleEvent: ScheduleEvent | null;
  scheduleDefaultType: EventType;
};

export function LeadDetailOverlays({
  lead,
  leadName,
  selectedTask,
  roteiroDialogOpen,
  onRoteiroDialogOpenChange,
  onRoteiroAction,
  taskForOutcome,
  outcomeDialogOpen,
  onOutcomeDialogOpenChange,
  onOutcomeConfirm,
  quickActionOutcomeOpen,
  quickActionOutcomeType,
  onQuickActionOutcomeOpenChange,
  onQuickActionOutcomeConfirm,
  cadenceTaskPending,
  quickActionPending,
  reopenStatusConfirmation,
  onReopenStatusConfirmationChange,
  onConfirmReopen,
  assigneeScheduleConfirmation,
  onAssigneeScheduleConfirmationChange,
  onConfirmAssignee,
  dealStatusPending,
  lostReasonDialogOpen,
  onLostReasonDialogOpenChange,
  onConfirmLostReason,
  selectedAttachment,
  onSelectedAttachmentChange,
  hasAgendaModule,
  scheduleFormOpen,
  onCloseScheduleForm,
  editingScheduleEvent,
  scheduleDefaultType,
}: LeadDetailOverlaysProps) {
  const currentAssigneeConfirmation =
    assigneeScheduleConfirmation?.leadId === lead.id
      ? assigneeScheduleConfirmation
      : null;
  const fromStatusLabel =
    reopenStatusConfirmation?.fromStatus === 'won'
      ? 'ganho'
      : reopenStatusConfirmation?.fromStatus === 'lost'
        ? 'perdido'
        : 'finalizado';

  return (
    <>
      {selectedTask && (
        <Dialog open={roteiroDialogOpen} onOpenChange={onRoteiroDialogOpenChange}>
          <DialogContent className="w-[calc(100vw-2rem)] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 text-[var(--app-text-primary)] shadow-none sm:w-full sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-normal">
                <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-amber-500/12">
                  <Lightbulb className="h-4 w-4 text-amber-600" />
                </div>
                {selectedTask.title || 'Roteiro'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-[8px] border-0 bg-amber-500/10 p-3">
                <div className="flex items-start gap-3">
                  <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-amber-800 dark:text-amber-200">
                    {selectedTask.observation}
                  </p>
                </div>
              </div>

              {selectedTask.recommended_message && (
                <div className="rounded-[8px] border-0 bg-primary/5 p-3">
                  <div className="flex items-start gap-3">
                    <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    <div>
                      <p className="mb-1 text-xs font-normal text-primary">Mensagem sugerida:</p>
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {selectedTask.recommended_message
                          .replace(/{nome}/gi, lead.name || '')
                          .replace(/{empresa}/gi, lead.empresa || '')
                          .replace(/{email}/gi, lead.email || '')}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  className="h-8 flex-1 rounded-[6px] text-[11px] font-light"
                  disabled={cadenceTaskPending}
                  onClick={() => void onRoteiroAction('complete')}
                >
                  <Check className="mr-2 h-4 w-4" />
                  Marcar como feito
                </Button>
                {selectedTask.recommended_message && lead.phone && (
                  <Button
                    variant="outline"
                    className="h-8 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] font-light shadow-none"
                    disabled={cadenceTaskPending}
                    onClick={() => void onRoteiroAction('message')}
                  >
                    <MessageCircle className="mr-2 h-4 w-4" />
                    Enviar mensagem
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {taskForOutcome && (
        <TaskOutcomeDialog
          open={outcomeDialogOpen}
          onOpenChange={onOutcomeDialogOpenChange}
          taskType={getCadenceTaskType(taskForOutcome.type)}
          taskTitle={taskForOutcome.title || ''}
          onConfirm={onOutcomeConfirm}
          isLoading={cadenceTaskPending}
        />
      )}
      <TaskOutcomeDialog
        open={quickActionOutcomeOpen}
        onOpenChange={onQuickActionOutcomeOpenChange}
        taskType={quickActionOutcomeType}
        taskTitle={
          quickActionOutcomeType === 'call' ? 'Tentativa de ligação' : 'Email enviado'
        }
        onConfirm={onQuickActionOutcomeConfirm}
        isLoading={quickActionPending}
      />

      <AlertDialog
        open={Boolean(reopenStatusConfirmation)}
        onOpenChange={(open) => {
          if (!open) onReopenStatusConfirmationChange(null);
        }}
      >
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] shadow-none">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-normal">Confirmar reabertura do lead?</AlertDialogTitle>
            <AlertDialogDescription>
              {reopenStatusConfirmation?.leadName || 'Este lead'} está marcado como{' '}
              {fromStatusLabel}. Ao confirmar, ele volta para Aberto e pode entrar novamente no
              fluxo comercial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
              disabled={dealStatusPending}
            >
              Não reabrir
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-[6px] bg-primary font-normal tracking-normal text-primary-foreground antialiased hover:bg-primary/90"
              disabled={dealStatusPending || !reopenStatusConfirmation}
              onClick={() => {
                if (reopenStatusConfirmation) void onConfirmReopen(reopenStatusConfirmation);
              }}
            >
              {dealStatusPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Reabrindo...
                </>
              ) : (
                'Sim, reabrir lead'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(currentAssigneeConfirmation)}
        onOpenChange={(open) => {
          if (!open) onAssigneeScheduleConfirmationChange(null);
        }}
      >
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] shadow-none">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-normal">Responsável fora da escala</AlertDialogTitle>
            <AlertDialogDescription>
              {currentAssigneeConfirmation?.userName || 'Este usuário'} está fora da
              disponibilidade configurada. {currentAssigneeConfirmation?.description} Deseja
              atribuir o lead mesmo assim?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-[6px] bg-primary font-normal tracking-normal text-primary-foreground antialiased hover:bg-primary/90"
              disabled={!currentAssigneeConfirmation}
              onClick={() => {
                if (currentAssigneeConfirmation) {
                  void onConfirmAssignee(currentAssigneeConfirmation);
                }
              }}
            >
              Atribuir mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LostReasonDialog
        open={lostReasonDialogOpen}
        onOpenChange={onLostReasonDialogOpenChange}
        onConfirm={onConfirmLostReason}
        leadName={leadName}
        loading={dealStatusPending}
      />
      <LeadAttachmentViewer
        key={selectedAttachment ? `${selectedAttachment.id}:${selectedAttachment.file_url}` : 'no-attachment'}
        attachment={selectedAttachment}
        open={Boolean(selectedAttachment)}
        onOpenChange={(open) => {
          if (!open) onSelectedAttachmentChange(null);
        }}
      />
      {hasAgendaModule && (
        <EventSheet
          open={scheduleFormOpen}
          onOpenChange={(open) => !open && onCloseScheduleForm()}
          leadId={lead.id}
          leadName={leadName}
          event={editingScheduleEvent}
          defaultUserId={lead.assigned_user_id ?? undefined}
          defaultType={scheduleDefaultType}
        />
      )}
    </>
  );
}
