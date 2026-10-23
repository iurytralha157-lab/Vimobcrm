import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getTagColorStyle } from "@/lib/tag-color";
import type { ConversationLeadDetail } from "@/lib/api/conversation-lead-detail";
import type { TagCatalog } from "@/lib/validation/tag-catalog";
import { WHATSAPP_NEUTRAL_FOCUS_CLASS_NAME } from "@/components/features/whatsapp/conversation-list-ui";
import { searchTextIncludes } from "@/lib/search-text";
import { ConversationTagSearchInput, handleConversationTagOptionsKeyDown } from "@/components/features/whatsapp/conversations/ConversationTagSearchInput";

type ConversationLeadTagBarProps = {
  tags: ConversationLeadDetail["tags"];
  availableTags: TagCatalog[];
  canManage: boolean;
  busy: boolean;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onAdd: (tagId: string) => void;
  onRemove: (tagId: string) => void;
};

export function ConversationLeadTagBar({ tags, availableTags, canManage, busy, loading, failed, onRetry, onAdd, onRemove }: ConversationLeadTagBarProps) {
  const [search, setSearch] = useState("");
  const hasCatalog = availableTags.length > 0;
  const visibleTags = availableTags.filter(tag => searchTextIncludes(tag.name, search));
  const removeClass = `flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] hover:bg-[var(--app-surface-hover)] disabled:opacity-50 ${WHATSAPP_NEUTRAL_FOCUS_CLASS_NAME}`;
  return (
    <div data-conversation-lead-tags className="mt-2 flex w-full min-w-0 flex-wrap gap-1.5">
      {tags.slice(0, 3).map(({ tag }) => (
        <Badge key={tag.id} className="flex h-5 max-w-full items-center gap-1 rounded-[4px] border-0 px-1.5 text-[10px]" style={{ ...getTagColorStyle(tag.color), color: "#ffffff" }} title={tag.name || "Tag"} aria-label={`Tag ${tag.name || "Tag"}`}>
          <span className="max-w-[130px] truncate">{tag.name || "Tag"}</span>
          {canManage && <button type="button" disabled={busy} className={removeClass} onClick={() => onRemove(tag.id)} aria-label={`Remover tag ${tag.name || "Tag"}`}><X className="h-2.5 w-2.5" aria-hidden="true" /></button>}
        </Badge>
      ))}
      {tags.length > 3 && (
        <Popover>
          <PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" className={`h-6 rounded-[4px] border-0 bg-[var(--app-surface-soft)] px-1.5 text-[10px] font-light ${WHATSAPP_NEUTRAL_FOCUS_CLASS_NAME}`} aria-label={`Ver mais ${tags.length - 3} tags`}>+{tags.length - 3}</Button></PopoverTrigger>
          <PopoverContent className="w-64 max-w-[calc(100vw-24px)] p-2" align="start" collisionPadding={12}>
            <p className="mb-1 px-1 text-[10px] font-medium text-muted-foreground">Todas as tags</p>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {tags.map(({ tag }) => <div key={tag.id} className="flex min-w-0 items-center gap-2 rounded-[6px] px-2 py-1.5 text-xs font-light"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={getTagColorStyle(tag.color)} aria-hidden="true" /><span className="min-w-0 flex-1 break-words">{tag.name || "Tag"}</span>{canManage && <button type="button" disabled={busy} className={removeClass} onClick={() => onRemove(tag.id)} aria-label={`Remover tag ${tag.name || "Tag"}`}><X className="h-3 w-3" aria-hidden="true" /></button>}</div>)}
            </div>
          </PopoverContent>
        </Popover>
      )}
      {canManage && (availableTags.length > 0 || loading || failed) && (
        <Popover onOpenChange={() => setSearch("")}>
          <PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" disabled={busy} className={`h-6 rounded-[4px] border-0 bg-[var(--app-surface-soft)] px-1.5 text-[10px] font-light ${WHATSAPP_NEUTRAL_FOCUS_CLASS_NAME}`} aria-label="Adicionar tag"><Plus className="mr-1 h-3 w-3" aria-hidden="true" />Tag</Button></PopoverTrigger>
          <PopoverContent data-conversation-tag-picker className="w-64 max-w-[calc(100vw-24px)] p-1" align="start" collisionPadding={12}>
            <ConversationTagSearchInput value={search} onChange={setSearch} />
            <div className="max-h-64 overflow-y-auto overscroll-contain" aria-busy={loading} onKeyDown={handleConversationTagOptionsKeyDown}>
              {loading && <p role="status" className="p-2 text-[11px] font-light text-muted-foreground">{hasCatalog ? "Atualizando tags..." : "Carregando tags..."}</p>}
              {failed && <div className="p-2 text-xs font-light"><p role="alert">{hasCatalog ? "Não foi possível atualizar as tags." : "Não foi possível carregar as tags."}</p><Button type="button" variant="ghost" size="sm" className={`h-8 rounded-[6px] text-xs font-light ${WHATSAPP_NEUTRAL_FOCUS_CLASS_NAME}`} disabled={loading} onClick={onRetry}>Tentar novamente</Button></div>}
              {visibleTags.map(tag => <button key={tag.id} data-conversation-tag-option type="button" disabled={busy} className={`flex min-h-8 w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left text-xs font-light hover:bg-accent disabled:opacity-50 ${WHATSAPP_NEUTRAL_FOCUS_CLASS_NAME}`} onClick={() => onAdd(tag.id)}><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={getTagColorStyle(tag.color)} aria-hidden="true" /><span className="min-w-0 truncate">{tag.name}</span></button>)}
              {hasCatalog && !visibleTags.length && <p role="status" className="p-2 text-[11px] font-light text-muted-foreground">Nenhuma tag encontrada.</p>}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
