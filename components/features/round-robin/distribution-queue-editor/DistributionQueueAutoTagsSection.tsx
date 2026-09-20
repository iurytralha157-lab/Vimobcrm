import { ChevronDown, Tag as TagIcon } from "lucide-react";

import { SearchableTagPicker } from "@/components/shared/SearchableTagPicker";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Tag } from "@/hooks/use-tags";
import { MAX_DISTRIBUTION_QUEUE_AUTO_TAGS } from "@/lib/round-robin/distribution-queue-form";
import { cn } from "@/lib/utils";

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
  return (
    <Collapsible
      data-tour="distribution-queue-auto-tags"
      open={open}
      onOpenChange={onToggle}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-[6px] border-0 bg-[var(--app-surface-muted)] px-3 py-2 text-left transition-colors hover:bg-[var(--app-surface-hover)] data-[state=open]:bg-primary/10">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-primary/50 text-white">
            <TagIcon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">Tags automáticas</span>
            <span className="block truncate text-[10px] font-light text-[var(--app-text-tertiary)]">
              Marque o lead ao entrar
            </span>
          </span>
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
      <CollapsibleContent className="px-0.5 pt-2.5">
        <SearchableTagPicker
          tags={tags}
          selectedTagIds={selectedTagIds}
          onToggleTag={onToggleTag}
          loading={tagsLoading}
          error={tagsError}
          placeholder="Selecionar tags automáticas..."
          triggerClassName="border-0 bg-[var(--app-surface-soft)] text-[12px] shadow-none hover:bg-[var(--app-surface-hover)]"
          allowCreate
          maxSelected={MAX_DISTRIBUTION_QUEUE_AUTO_TAGS}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
