import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { getPipelineLeadPageCursor, type PipelinePaginationStage } from '@/lib/pipeline-pagination-state';

/** A page belongs to one observed snapshot, including writes that share the same data reference. */
export function capturePipelinePageLease(client: QueryClient, key: QueryKey, params: {
  stageId: string;
  offset: number;
  cursorBefore?: string;
  cursorBeforeId?: string;
  signal: AbortSignal;
}) {
  const query = client.getQueryCache().find({ queryKey: key, exact: true });
  const stage = (query?.state.data as PipelinePaginationStage[] | undefined)?.find(item => item.id === params.stageId);
  const cursor = getPipelineLeadPageCursor(stage?.leads.at(-1));
  if (!query || !query.isActive() || query.state.fetchStatus !== 'idle' || query.state.isInvalidated
    || !stage?.has_more || stage.leads.length !== params.offset
    || cursor.cursorBefore !== params.cursorBefore || cursor.cursorBeforeId !== params.cursorBeforeId
    || params.signal.aborted) throw new Error('O quadro mudou. Aguarde a atualização antes de carregar mais leads.');
  const controller = new AbortController();
  let retired = false;
  const retire = () => { retired = true; controller.abort(); };
  params.signal.addEventListener('abort', retire, { once: true });
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.query !== query) return;
    if (event.type === 'removed' || event.type === 'observerRemoved' || event.type === 'updated') retire();
  });
  return {
    signal: controller.signal,
    isCurrent: () => !retired && !params.signal.aborted && query.isActive()
      && client.getQueryCache().find({ queryKey: key, exact: true }) === query,
    release: () => { unsubscribe(); params.signal.removeEventListener('abort', retire); },
  };
}
