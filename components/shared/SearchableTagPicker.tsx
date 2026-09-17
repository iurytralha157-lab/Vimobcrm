"use client";

import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  Check,
  ChevronsUpDown,
  Loader2,
  Plus,
  Search,
  Tag as TagIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCreateTag } from "@/hooks/use-tags";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { searchTextEquals, searchTextIncludes } from "@/lib/search-text";
import { cn } from "@/lib/utils";

const DEFAULT_MAX_SELECTED_TAGS = 50;
const DEFAULT_TAG_COLOR = "#3B82F6";
const TAG_COLORS = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#06B6D4",
  "#F97316",
] as const;

export interface SearchableTagPickerTag {
  id: string;
  name: string;
  color?: string | null;
}

export interface SearchableTagPickerProps {
  tags: readonly SearchableTagPickerTag[];
  selectedTagIds: readonly string[];
  onToggleTag: (tagId: string) => void;
  loading?: boolean;
  error?: unknown;
  disabled?: boolean;
  placeholder?: string;
  triggerLabel?: ReactNode;
  triggerClassName?: string;
  showSelectedBadges?: boolean;
  allowCreate?: boolean;
  maxSelected?: number;
}

function normalizeTagId(value: string) {
  return value.trim().toLowerCase();
}

function tagColor(tag: SearchableTagPickerTag) {
  return tag.color?.trim() || DEFAULT_TAG_COLOR;
}

export function SearchableTagPicker({
  tags,
  selectedTagIds,
  onToggleTag,
  loading = false,
  error,
  disabled = false,
  placeholder = "Selecionar tags...",
  triggerLabel,
  triggerClassName,
  showSelectedBadges = true,
  allowCreate = true,
  maxSelected = DEFAULT_MAX_SELECTED_TAGS,
}: SearchableTagPickerProps) {
  const { hasPermission } = useUserPermissions();
  const createTag = useCreateTag();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollListRef = useRef<HTMLDivElement>(null);
  const selectionLimit = Math.max(0, Math.floor(maxSelected));
  const hasError = Boolean(error);
  const canCreate =
    allowCreate && hasPermission("tag_manage") && !loading && !hasError;

  const normalizedSelectedIds = useMemo(() => {
    const selected = new Map<string, string>();
    for (const rawId of selectedTagIds) {
      const normalizedId = normalizeTagId(rawId);
      if (normalizedId && !selected.has(normalizedId)) {
        selected.set(normalizedId, rawId);
      }
    }
    return selected;
  }, [selectedTagIds]);

  const normalizedTags = useMemo(() => {
    const uniqueTags = new Map<string, SearchableTagPickerTag>();
    for (const tag of tags) {
      const normalizedId = normalizeTagId(tag.id);
      if (normalizedId && !uniqueTags.has(normalizedId)) {
        uniqueTags.set(normalizedId, tag);
      }
    }
    return Array.from(uniqueTags.values());
  }, [tags]);

  const knownTagIds = useMemo(
    () => new Set(normalizedTags.map((tag) => normalizeTagId(tag.id))),
    [normalizedTags],
  );
  const selectedTags = useMemo(
    () =>
      normalizedTags.filter((tag) =>
        normalizedSelectedIds.has(normalizeTagId(tag.id)),
      ),
    [normalizedSelectedIds, normalizedTags],
  );
  const unavailableTagIds = useMemo(
    () =>
      Array.from(normalizedSelectedIds.entries())
        .filter(([normalizedId]) => !knownTagIds.has(normalizedId))
        .map(([, originalId]) => originalId),
    [knownTagIds, normalizedSelectedIds],
  );
  const visibleTags = useMemo(
    () =>
      search.trim()
        ? normalizedTags.filter((tag) => searchTextIncludes(tag.name, search))
        : normalizedTags,
    [normalizedTags, search],
  );
  const hasExactMatch = useMemo(
    () =>
      Boolean(search.trim()) &&
      normalizedTags.some((tag) => searchTextEquals(tag.name, search)),
    [normalizedTags, search],
  );
  const selectedCount = normalizedSelectedIds.size;
  const isAtLimit = selectedCount >= selectionLimit;
  const resolvedTriggerLabel =
    triggerLabel ??
    (selectedCount === 0
      ? placeholder
      : selectedCount === 1 && selectedTags.length === 1
        ? selectedTags[0].name
        : `${selectedCount} tags selecionadas`);
  useEffect(() => {
    if (!open) return;
    const timeoutId = window.setTimeout(() => inputRef.current?.focus(), 100);
    return () => window.clearTimeout(timeoutId);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const element = scrollListRef.current;
    if (!element) return;

    const handleWheel = (event: WheelEvent) => event.stopPropagation();
    element.addEventListener("wheel", handleWheel, { passive: true });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [open]);

  const isSelected = (tagId: string) =>
    normalizedSelectedIds.has(normalizeTagId(tagId));

  const toggleTag = (tagId: string) => {
    if (disabled) return;
    if (!isSelected(tagId) && isAtLimit) {
      toast.error(`Selecione no máximo ${selectionLimit} tags.`);
      return;
    }
    onToggleTag(tagId);
  };

  const handleCreate = async () => {
    const name = search.trim();
    if (
      !name ||
      !canCreate ||
      hasExactMatch ||
      createTag.isPending ||
      isAtLimit
    ) {
      if (name && canCreate && isAtLimit) {
        toast.error(`Selecione no máximo ${selectionLimit} tags.`);
      }
      return;
    }

    try {
      const createdTag = await createTag.mutateAsync({
        name,
        color: TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)],
      });
      if (createdTag?.id) {
        onToggleTag(createdTag.id);
        setSearch("");
      }
    } catch {
      // useCreateTag owns the user-facing error feedback.
    }
  };

  return (
    <div className="w-full space-y-1.5">
      {showSelectedBadges && selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedTags.map((tag) => {
            const color = tagColor(tag);
            return (
              <Badge
                key={tag.id}
                className="flex items-center gap-1 rounded-[4px] border-0 py-0.5 pr-1 text-xs"
                style={{
                  backgroundColor: `${color}15`,
                  borderColor: `${color}30`,
                  color,
                }}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                <span className="max-w-[220px] truncate">{tag.name}</span>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remover tag ${tag.name}`}
                  onClick={() => toggleTag(tag.id)}
                  className="ml-0.5 rounded-[3px] p-0.5 hover:bg-black/10 disabled:pointer-events-none disabled:opacity-50"
                >
                  <X className="h-2.5 w-2.5" aria-hidden="true" />
                </button>
              </Badge>
            );
          })}
          {unavailableTagIds.map((tagId) => (
            <Badge
              key={tagId}
              variant="outline"
              className="flex items-center gap-1 rounded-[4px] border-dashed py-0.5 pr-1 text-xs text-muted-foreground"
            >
              Tag indisponível
              <button
                type="button"
                disabled={disabled}
                aria-label="Remover tag indisponível"
                onClick={() => toggleTag(tagId)}
                className="ml-0.5 rounded-[3px] p-0.5 hover:bg-black/10 disabled:pointer-events-none disabled:opacity-50"
              >
                <X className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setSearch("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-expanded={open}
            aria-haspopup="listbox"
            className={cn(
              "h-10 w-full justify-between gap-2 rounded-md px-3 text-sm font-normal",
              selectedCount === 0 && "text-muted-foreground",
              triggerClassName,
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <TagIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{resolvedTriggerLabel}</span>
            </span>
            <ChevronsUpDown
              className="h-3.5 w-3.5 shrink-0 opacity-60"
              aria-hidden="true"
            />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] min-w-64 max-w-[calc(100vw-24px)] p-0"
        >
          <div className="p-2">
            <div className="relative">
              <Search
                className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                ref={inputRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    search.trim() &&
                    canCreate &&
                    !hasExactMatch
                  ) {
                    event.preventDefault();
                    void handleCreate();
                  }
                }}
                aria-label={canCreate ? "Buscar ou criar tag" : "Buscar tag"}
                placeholder={
                  canCreate ? "Buscar ou criar tag..." : "Buscar tag..."
                }
                className="h-8 py-1 pl-8 text-sm"
              />
            </div>
          </div>

          <div
            ref={scrollListRef}
            role="listbox"
            aria-label="Tags disponíveis"
            aria-multiselectable="true"
            className="max-h-48 overflow-y-auto overscroll-contain"
            onWheel={(event) => event.stopPropagation()}
          >
            <div className="space-y-1 p-2 pt-0">
              {loading && normalizedTags.length === 0 && (
                <div
                  className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground"
                  role="status"
                >
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Carregando tags...
                </div>
              )}

              {hasError && (
                <div
                  className="flex items-start gap-2 rounded-[6px] bg-destructive/10 px-2 py-2 text-xs text-destructive"
                  role="alert"
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Não foi possível carregar as tags. As seleções foram preservadas.
                  </span>
                </div>
              )}

              {!loading && !hasError && normalizedTags.length === 0 && (
                <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                  Nenhuma tag cadastrada
                </p>
              )}

              {normalizedTags.length > 0 && visibleTags.length === 0 && (
                <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                  Nenhuma tag encontrada
                </p>
              )}

              {visibleTags.map((tag) => {
                const selected = isSelected(tag.id);
                const blockedByLimit = !selected && isAtLimit;
                return (
                  <button
                    key={tag.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-disabled={blockedByLimit || disabled}
                    disabled={disabled}
                    onClick={() => toggleTag(tag.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                      blockedByLimit && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: tagColor(tag) }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                    <Check
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-primary",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}

              {unavailableTagIds.map((tagId) => (
                <div
                  key={tagId}
                  className="flex items-center gap-2 rounded-[6px] border border-dashed border-[var(--app-border)] px-2 py-1.5 text-sm text-muted-foreground"
                >
                  <span className="min-w-0 flex-1 truncate">Tag indisponível</span>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label="Remover tag indisponível"
                    onClick={() => toggleTag(tagId)}
                    className="rounded-[4px] p-1 hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {canCreate && (
            <div className="shrink-0 rounded-b-md border-t border-[var(--app-border)] bg-popover p-1">
              <button
                type="button"
                onClick={() => {
                  if (search.trim() && !hasExactMatch) {
                    void handleCreate();
                  } else {
                    inputRef.current?.focus();
                  }
                }}
                disabled={
                  createTag.isPending ||
                  isAtLimit ||
                  Boolean(search.trim() && hasExactMatch)
                }
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-primary transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
              >
                {createTag.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {search.trim() && !hasExactMatch
                  ? `Criar \"${search.trim()}\"`
                  : "Criar nova tag"}
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
