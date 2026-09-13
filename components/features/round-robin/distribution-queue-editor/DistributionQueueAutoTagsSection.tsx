import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  Plus,
  Tag as TagIcon,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { useCreateTag, type Tag } from "@/hooks/use-tags";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { MAX_DISTRIBUTION_QUEUE_AUTO_TAGS } from "@/lib/round-robin/distribution-queue-form";
import { searchTextEquals, searchTextIncludes } from "@/lib/search-text";
import { cn } from "@/lib/utils";

const DEFAULT_TAG_COLOR = "#3B82F6";

interface DistributionQueueAutoTagsSectionProps {
  open: boolean;
  tags: Tag[];
  selectedTagIds: string[];
  tagsLoading: boolean;
  tagsError: boolean;
  onToggle: () => void;
  onToggleTag: (tagId: string) => void;
}

export function DistributionQueueAutoTagsSection({
  open,
  tags,
  selectedTagIds,
  tagsLoading,
  tagsError,
  onToggle,
  onToggleTag,
}: DistributionQueueAutoTagsSectionProps) {
  const { hasPermission } = useUserPermissions();
  const createTag = useCreateTag();
  const [search, setSearch] = useState("");
  const canCreate = hasPermission("tag_manage");
  const visibleTags = useMemo(() => {
    const matches = search.trim()
      ? tags.filter((tag) => searchTextIncludes(tag.name, search))
      : tags;

    return [...matches].sort((left, right) => {
      const leftSelected = selectedTagIds.includes(left.id.toLowerCase());
      const rightSelected = selectedTagIds.includes(right.id.toLowerCase());
      return Number(rightSelected) - Number(leftSelected);
    });
  }, [search, selectedTagIds, tags]);
  const hasExactMatch = useMemo(
    () =>
      Boolean(search.trim()) &&
      tags.some((tag) => searchTextEquals(tag.name, search)),
    [search, tags],
  );
  const unavailableTagIds = useMemo(() => {
    const knownTagIds = new Set(tags.map((tag) => tag.id.toLowerCase()));
    return selectedTagIds.filter((tagId) => !knownTagIds.has(tagId));
  }, [selectedTagIds, tags]);

  const handleCreate = async () => {
    const name = search.trim();
    if (
      !name ||
      !canCreate ||
      hasExactMatch ||
      createTag.isPending ||
      selectedTagIds.length >= MAX_DISTRIBUTION_QUEUE_AUTO_TAGS
    ) {
      return;
    }

    try {
      const tag = await createTag.mutateAsync({
        name,
        color: DEFAULT_TAG_COLOR,
      });
      if (tag?.id) {
        onToggleTag(tag.id);
        setSearch("");
      }
    } catch {
      // useCreateTag already reports API failures through the shared toast.
    }
  };

  return (
    <Collapsible
      data-tour="distribution-queue-auto-tags"
      open={open}
      onOpenChange={onToggle}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-[6px] border-0 bg-[var(--app-surface-muted)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--app-surface-hover)] data-[state=open]:bg-primary/10">
        <div className="flex items-center gap-2">
          <TagIcon className="h-4 w-4 text-primary" />
          <span className="font-medium">Tags automáticas</span>
          {selectedTagIds.length > 0 && (
            <Badge
              variant="secondary"
              className="h-5 rounded-[5px] border-0 px-1.5 text-[10px] font-light"
            >
              {selectedTagIds.length}/{MAX_DISTRIBUTION_QUEUE_AUTO_TAGS}
            </Badge>
          )}
        </div>
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-0.5 pt-2.5">
        {!tagsError && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  canCreate &&
                  search.trim() &&
                  !hasExactMatch
                ) {
                  event.preventDefault();
                  void handleCreate();
                }
              }}
              placeholder={
                canCreate ? "Buscar ou criar tag..." : "Buscar tag..."
              }
              disabled={tagsLoading}
              className="h-10 flex-1 border-0 bg-[var(--app-surface-soft)] text-[12px] shadow-none"
            />
            {canCreate && search.trim() && !hasExactMatch && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleCreate()}
                disabled={
                  createTag.isPending ||
                  selectedTagIds.length >= MAX_DISTRIBUTION_QUEUE_AUTO_TAGS
                }
                className="h-10 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
              >
                {createTag.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Criar tag
              </Button>
            )}
          </div>
        )}

        <div className="scrollbar-thin flex max-h-[180px] min-h-10 flex-wrap content-start gap-2 overflow-y-auto rounded-[6px] bg-[var(--app-surface-soft)] p-2.5 [scrollbar-gutter:stable]">
          {tagsLoading && tags.length === 0 && (
            <span className="text-xs text-muted-foreground">
              Carregando tags...
            </span>
          )}
          {tagsError && (
            <span className="text-xs text-destructive">
              Não foi possível carregar as tags. As seleções salvas foram
              preservadas.
            </span>
          )}
          {!tagsLoading && !tagsError && tags.length === 0 && (
            <span className="text-xs text-muted-foreground">
              Nenhuma tag cadastrada nesta organização.
            </span>
          )}
          {!tagsLoading &&
            !tagsError &&
            tags.length > 0 &&
            visibleTags.length === 0 && (
              <span className="text-xs text-muted-foreground">
                Nenhuma tag encontrada para esta busca.
              </span>
            )}
          {visibleTags.map((tag) => {
            const selected = selectedTagIds.includes(tag.id.toLowerCase());
            return (
              <Badge
                key={tag.id}
                variant="secondary"
                role="button"
                aria-pressed={selected}
                tabIndex={0}
                title={tag.name}
                className={cn(
                  "h-8 max-w-[220px] cursor-pointer gap-1.5 rounded-[5px] border-0 px-3 py-0 text-[12px] font-light shadow-none transition-colors",
                  selected
                    ? "bg-primary/10 text-primary hover:bg-primary/15"
                    : "bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]",
                )}
                onClick={() => onToggleTag(tag.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onToggleTag(tag.id);
                  }
                }}
              >
                {selected ? (
                  <>
                    <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                      aria-hidden="true"
                    />
                  </>
                ) : (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: tag.color }}
                    aria-hidden="true"
                  />
                )}
                <span className="truncate">{tag.name}</span>
              </Badge>
            );
          })}
          {unavailableTagIds.map((tagId) => (
            <Badge
              key={tagId}
              variant="outline"
              className="h-8 max-w-[220px] gap-1 rounded-[5px] border-dashed px-2.5 py-0 text-[12px] font-light text-muted-foreground"
            >
              Tag indisponível
              <button
                type="button"
                aria-label="Remover tag indisponível"
                onClick={() => onToggleTag(tagId)}
                className="rounded p-0.5 hover:bg-black/10"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
