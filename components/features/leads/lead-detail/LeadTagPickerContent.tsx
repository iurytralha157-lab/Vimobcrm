'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useLeadDetailOperationScope } from '@/hooks/leads/use-lead-detail-operation-scope';
import { useCreateTag, useTags } from '@/hooks/use-tags';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';
import { searchTextEquals, searchTextIncludes } from '@/lib/search-text';
import type { TagCatalog } from '@/lib/validation/tag-catalog';

type LeadTagPickerContentProps = {
  leadId: string;
  assignedTagIds: readonly string[];
  onAddTag: (tag: TagCatalog) => void | Promise<void>;
  onClose: () => void;
  disabled?: boolean;
  enabled?: boolean;
};

// The lead picker reads the catalog projection, never a management DTO whose
// editing revision may be unavailable from an older API.
export function LeadTagPickerContent({
  leadId, assignedTagIds, onAddTag, onClose, disabled = false, enabled = true,
}: LeadTagPickerContentProps) {
  const { activeOrganization, user, session } = useAuth();
  const { hasPermission } = useUserPermissions();
  const queryClient = useQueryClient();
  const catalog = useTags({ catalog: true, enabled });
  const createTag = useCreateTag();
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const tags = catalog.data || [];
  const filteredTags = tags.filter(tag => searchTextIncludes(tag.name, search));
  const name = search.trim();
  const exactMatch = tags.some(tag => searchTextEquals(tag.name, name));
  const busy = disabled || !enabled || createTag.isPending;
  const loading = catalog.isPending || catalog.isFetching;
  const creationAllowed = !disabled && enabled && hasPermission('tag_manage');
  const canCreate = creationAllowed && !createTag.isPending && !loading && !catalog.isError;
  const captureCreation = useLeadDetailOperationScope(
    leadId, activeOrganization.organizationId, user?.id || null, queryClient,
    creationAllowed, getGlobalSignOutSessionId(session),
  );
  const allAssigned = tags.length > 0 && tags.every(tag => assignedTagIds.includes(tag.id));

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const stopWheel = (event: WheelEvent) => event.stopPropagation();
    list.addEventListener('wheel', stopWheel, { passive: true });
    return () => list.removeEventListener('wheel', stopWheel);
  }, []);

  const addAndClose = async (tag: TagCatalog) => {
    try {
      const addition = onAddTag(tag);
      onClose();
      await addition;
    } catch {
      // The lead action owns association feedback and its optimistic rollback.
    }
  };

  const handleCreate = async () => {
    if (!canCreate || !name || exactMatch) return;
    const operation = captureCreation();
    try {
      const tag = await createTag.mutateAsync({ name, color: '#F97316' });
      if (!operation.isCurrent() || tag.organization_id !== activeOrganization.organizationId) return;
      await addAndClose(tag);
    } catch {
      // The existing mutation owns creation error feedback; keep the search.
    }
  };

  return (
    <div data-lead-tag-picker className="min-w-0 p-0">
      <div className="p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={inputRef}
            aria-label="Buscar tags"
            placeholder="Buscar tags..."
            value={search}
            onChange={event => setSearch(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}
            className="h-9 min-w-0 py-1 pl-8 text-base font-light md:text-xs"
          />
        </div>
      </div>
      <div ref={listRef} className="max-h-56 overflow-y-auto overscroll-contain p-1" aria-label="Tags da organização" aria-busy={loading} onWheel={event => event.stopPropagation()}>
        {enabled && loading && <p role="status" className="px-2 py-2 text-xs font-light text-muted-foreground">{tags.length ? 'Atualizando tags...' : 'Carregando tags...'}</p>}
        {!enabled && <p role="status" className="px-2 py-2 text-xs font-light text-muted-foreground">As tags estão indisponíveis para esta ação.</p>}
        {catalog.isError && (
          <div className="space-y-1 px-2 py-2 text-xs font-light">
            <p role="alert">{tags.length ? 'Não foi possível atualizar as tags.' : 'Não foi possível carregar as tags.'}</p>
            <Button type="button" variant="ghost" size="sm" className="h-9 rounded-[6px] text-xs font-light" disabled={catalog.isFetching || !enabled} onClick={() => void catalog.refetch()}>Tentar novamente</Button>
          </div>
        )}
        {filteredTags.map(tag => {
          const assigned = assignedTagIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              aria-label={`${tag.name}${assigned ? ', já adicionada' : ''}`}
              aria-pressed={assigned}
              disabled={busy || assigned}
              onClick={() => void addAndClose(tag)}
              className="flex min-h-9 w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left text-xs font-light hover:bg-accent disabled:cursor-default disabled:opacity-60"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />
              <span className="min-w-0 flex-1 break-words">{tag.name}</span>
              {assigned && <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
            </button>
          );
        })}
        {enabled && catalog.isSuccess && !catalog.isFetching && !tags.length && <p role="status" className="px-2 py-3 text-xs font-light text-muted-foreground">Nenhuma tag cadastrada nesta organização.</p>}
        {tags.length > 0 && !filteredTags.length && <p role="status" className="px-2 py-3 text-xs font-light text-muted-foreground">Nenhuma tag encontrada.</p>}
        {allAssigned && <p className="px-2 py-2 text-xs font-light text-muted-foreground">Todas as tags já estão neste lead.</p>}
      </div>
      {hasPermission('tag_manage') && (
        <div className="border-t border-[var(--app-border)] p-1">
          <Button
            type="button"
            variant="ghost"
            disabled={!canCreate || !name || exactMatch}
            onClick={() => void handleCreate()}
            className="min-h-9 w-full justify-start gap-2 rounded-[6px] px-2 text-xs font-light text-primary"
          >
            {createTag.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
            {name && !exactMatch ? <>Criar &quot;{name}&quot;</> : 'Criar nova tag'}
          </Button>
        </div>
      )}
    </div>
  );
}
