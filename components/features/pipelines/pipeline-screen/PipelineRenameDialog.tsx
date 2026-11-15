'use client';

import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePipelineUpdateMutation } from '@/hooks/pipelines/use-pipeline-mutations';
import { usePipelineEditorVisit } from '@/hooks/pipelines/use-pipeline-editor-visit';
import { getStructuredErrorMessage } from '@/lib/api/vimob-error';
import { pipelineUpdateInputSchema } from '@/lib/validation/pipelines';
import type { PipelineSummary } from './model';

export function PipelineRenameDialog({ pipeline, selectedPipelineId, canEdit, onClose }: {
  pipeline: PipelineSummary;
  selectedPipelineId: string | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  const update = usePipelineUpdateMutation();
  const [initialScope] = useState(update.scopeKey);
  const inFlight = useRef(false);
  const [name, setName] = useState(pipeline.name);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const active = canEdit && selectedPipelineId === pipeline.id && initialScope === update.scopeKey;
  const visit = usePipelineEditorVisit(update.scopeKey, JSON.stringify([pipeline.id, selectedPipelineId]), update.captureScopeGuard);
  useLayoutEffect(() => { if (!active) onClose(); }, [active, onClose]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const operation = visit.capture();
    if (!active || !operation.isCurrent() || inFlight.current || update.isPending || conflict) return;
    const parsed = pipelineUpdateInputSchema.safeParse({ name, expectedRevision: pipeline.revision });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.path[0] === 'name'
        ? 'O nome da pipeline deve ter entre 2 e 120 caracteres.'
        : 'Atualize a lista de pipelines e reabra esta janela para continuar.');
      return;
    }
    inFlight.current = true;
    setError(null);
    try {
      await update.mutateAsync({ id: pipeline.id, ...parsed.data });
      if (!operation.isCurrent()) return;
      toast.success('Pipeline renomeada com sucesso!');
      onClose();
    } catch (failure: unknown) {
      if (!operation.isCurrent()) return;
      const changed = typeof failure === 'object' && failure !== null && 'code' in failure && failure.code === 'pipeline_changed';
      setConflict(changed);
      setError(changed
        ? 'O funil mudou em outra sessão. Feche esta janela e reabra após atualizar para revisar o nome.'
        : getStructuredErrorMessage(failure));
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <Dialog open={active} onOpenChange={(open) => { if (!open && !update.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Renomear pipeline</DialogTitle>
            <DialogDescription>Atualize o nome de {pipeline.name}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="pipeline-rename-name">Nome da pipeline</Label>
            <Input id="pipeline-rename-name" value={name} onChange={(event) => { setName(event.target.value); if (!conflict) setError(null); }} maxLength={120} disabled={update.isPending || conflict} aria-invalid={Boolean(error)} aria-describedby={error ? 'pipeline-rename-error' : undefined} autoFocus />
          </div>
          {error && <p id="pipeline-rename-error" role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={update.isPending} onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={update.isPending || conflict || name.trim() === pipeline.name.trim()}>
              {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Salvar nome
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
