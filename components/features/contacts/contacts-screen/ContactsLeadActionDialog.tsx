'use client';

import { useId, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import type { ContactLeadActionKind } from '@/components/features/contacts/contacts-screen/ContactLeadActionMenuItems';
import { LostReasonDialog } from '@/components/features/leads/LostReasonDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ContactLeadActionRequest } from '@/hooks/contacts/use-contact-lead-action-selection';
import type { ContactLeadAction } from '@/hooks/contacts/use-contact-lead-actions';
import { useStageAutomations } from '@/hooks/use-stage-automations';
import { usePipelines, useStages } from '@/hooks/use-stages';
import { useOrganizationUsers } from '@/hooks/use-users';
import { getPipelineStageOutcome } from '@/lib/pipeline-stage-outcome';

const titles: Record<ContactLeadActionKind, string> = {
  'move-stage': 'Mover para funil/etapa',
  assign: 'Alterar responsável',
  'deal-status': 'Alterar status',
};

const dealStatuses = [
  { id: 'open', name: 'Aberto' },
  { id: 'won', name: 'Ganho' },
  { id: 'lost', name: 'Perdido' },
];

type LossAction = Exclude<ContactLeadAction, { kind: 'assign' }>;

function ActionSelect({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly { id: string; name: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-light">{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled || options.length === 0}>
        <SelectTrigger id={id}><SelectValue placeholder="Selecione" /></SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ContactsLeadActionDialog({
  request,
  onClose,
  onConfirm,
}: {
  request: ContactLeadActionRequest;
  onClose: () => void;
  onConfirm: (action: ContactLeadAction) => Promise<void>;
}) {
  const { kind, contacts, review, error } = request;
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [status, setStatus] = useState('');
  const [lossAction, setLossAction] = useState<LossAction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submission = useRef(false);
  const pipelinesQuery = usePipelines();
  const stagesQuery = useStages(kind === 'move-stage' && pipelineId ? pipelineId : undefined);
  const automationsQuery = useStageAutomations(stageId || undefined);
  const usersQuery = useOrganizationUsers({ enabled: kind === 'assign' });
  const pipelines = (pipelinesQuery.data ?? []).filter((pipeline) => pipeline.is_active !== false);
  const stages = (stagesQuery.data ?? []).filter((stage) => stage.is_active !== false && stage.pipeline_id === pipelineId);
  const users = (usersQuery.data ?? []).filter((user) => user.is_active);
  const stage = stages.find((item) => item.id === stageId);
  const ready = review && review.targets.length > 0 && !submitting;
  const fetchError = kind === 'move-stage' && (pipelinesQuery.isError || stagesQuery.isError)
    ? 'Não foi possível carregar os funis ou etapas.'
    : kind === 'assign' && usersQuery.isError ? 'Não foi possível carregar os responsáveis.' : null;

  let action: ContactLeadAction | null = null;
  if (kind === 'move-stage' && stage && pipelines.some((pipeline) => pipeline.id === pipelineId)) {
    action = { kind, pipelineId, stageId };
  } else if (kind === 'assign' && users.some((user) => user.id === assigneeId)) {
    action = { kind, assignedUserId: assigneeId };
  } else if (kind === 'deal-status' && (status === 'open' || status === 'won' || status === 'lost')) {
    action = { kind, status };
  }
  const stageIsLost = getPipelineStageOutcome(stage, automationsQuery.data) === 'lost';
  const isLostStatus = action?.kind === 'deal-status' && action.status === 'lost';
  const reopening = action?.kind === 'deal-status' && action.status === 'open'
    && review?.targets.some((target) => target.status !== 'open');
  const reopeningWon = reopening && review?.targets.some((target) => target.status === 'won');

  const submit = async (confirmedAction: ContactLeadAction) => {
    if (!ready || submission.current) return;
    submission.current = true;
    setSubmitting(true);
    try {
      await onConfirm(confirmedAction);
    } finally {
      submission.current = false;
      setSubmitting(false);
    }
  };

  const confirm = () => {
    if (!action || !ready || fetchError) return;
    if (action.kind !== 'assign' && (isLostStatus || stageIsLost)) {
      setLossAction(action);
      return;
    }
    void submit(action);
  };

  if (lossAction) {
    const target = review?.targets[0];
    return (
      <LostReasonDialog
        open
        leadName={review?.targets.length === 1 ? target?.name : undefined}
        loading={submitting}
        onOpenChange={(open) => { if (!open && !submission.current) setLossAction(null); }}
        onConfirm={(lostReason) => submit({ ...lossAction, lostReason })}
      />
    );
  }

  const excludedCount = (review?.failures.length ?? 0) + (review?.unstartedIds.length ?? 0);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submission.current) onClose(); }}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 text-[var(--app-text-primary)] shadow-none sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base font-normal">{titles[kind]}</DialogTitle>
          <DialogDescription>
            Confira {contacts.length === 1 ? 'o contato' : `os ${contacts.length} contatos`} antes de confirmar a alteração.
          </DialogDescription>
        </DialogHeader>
        {!review && !error && (
          <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Revisando contatos...
          </p>
        )}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {review && (
          <>
            {review.targets.length > 0 && (
              <ul aria-label="Contatos para alteração" className="max-h-28 space-y-1 overflow-y-auto rounded-[6px] border border-border/40 px-3 py-2 text-xs">
                {review.targets.map((target) => <li key={target.id}>{target.name || 'Contato sem nome'}</li>)}
              </ul>
            )}
            {excludedCount > 0 && (
              <div role="status" className="space-y-1 text-xs text-muted-foreground">
                <p>{excludedCount} contato(s) fora da ação. Somente os contatos revisados podem ser alterados.</p>
                <ul className="max-h-20 space-y-1 overflow-y-auto">
                  {review.failures.map(({ id, message }) => (
                    <li key={id}>{contacts.find((contact) => contact.id === id)?.name || 'Contato'} — {message}</li>
                  ))}
                </ul>
              </div>
            )}
            {review.targets.length > 0 && (
              <div className="space-y-3">
                {kind === 'move-stage' && (
                  <>
                    <ActionSelect label="Funil" options={pipelines} value={pipelineId} onChange={(value) => { setPipelineId(value); setStageId(''); }} disabled={submitting} />
                    <ActionSelect label="Etapa" options={stages} value={stageId} onChange={setStageId} disabled={submitting} />
                    {action?.kind === 'move-stage' && !stageIsLost && !automationsQuery.data && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setLossAction(action)} disabled={submitting} className="h-auto whitespace-normal px-0 text-left text-xs font-light">
                        Informar motivo se a etapa marcar como perdido
                      </Button>
                    )}
                  </>
                )}
                {kind === 'assign' && <ActionSelect label="Responsável" options={users} value={assigneeId} onChange={setAssigneeId} disabled={submitting} />}
                {kind === 'deal-status' && <ActionSelect label="Status" options={dealStatuses} value={status} onChange={setStatus} disabled={submitting} />}
                {reopening && (
                  <p className="rounded-[6px] bg-[var(--app-surface-soft)] p-2 text-xs text-muted-foreground">
                    Ao confirmar, os contatos ganhos ou perdidos voltam para Aberto e podem entrar novamente no fluxo comercial.
                    {reopeningWon && ' Lançamentos e comissões existentes serão mantidos; solicite a revisão financeira.'}
                  </p>
                )}
                {fetchError && <p role="alert" className="text-xs text-destructive">{fetchError}</p>}
              </div>
            )}
          </>
        )}
        {submitting && request.progress && (
          <p role="status" className="text-xs text-muted-foreground">{request.progress.completed} de {request.progress.total} contatos processados</p>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-8 rounded-[6px]" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button type="button" size="sm" className="h-8 rounded-[6px]" onClick={confirm} disabled={!ready || !action || Boolean(fetchError)}>
            {submitting ? 'Aplicando...' : reopening ? 'Reabrir' : 'Confirmar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
