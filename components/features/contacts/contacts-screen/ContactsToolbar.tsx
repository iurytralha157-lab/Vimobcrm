import { Component, createRef, type ComponentProps, type ReactElement } from "react";
import { ChevronDown, Download, Plus, Upload, Users } from "lucide-react";

import { SharedFilters } from "@/components/shared/SharedFilters";
import { MAX_LEAD_SOURCE_FILTER_LENGTH } from "@/lib/validation/filter-text";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatPtBRNumber } from "@/lib/utils/formatting";

export type ContactsToolbarFilters = ComponentProps<typeof SharedFilters>;

type ContactsToolbarProps = {
  isMobile: boolean;
  totalCount: number;
  isCountLoading: boolean;
  canCreateLeads: boolean;
  canImportLeads: boolean;
  canExportLeads: boolean;
  isExporting: boolean;
  filters: ContactsToolbarFilters;
  onCreate: () => void;
  onImport: () => void;
  onExport: () => void;
};

function LeadCountBadge({
  isLoading,
  totalCount,
  className,
}: {
  isLoading: boolean;
  totalCount: number;
  className?: string;
}) {
  return (
    <div
      data-tour="contacts-count"
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 text-[12px] font-light text-[var(--app-text-secondary)]",
        className,
      )}
      aria-label="Total de contatos filtrados"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
        <Users className="h-3 w-3" aria-hidden="true" />
      </span>
      <span className="text-[var(--app-text-primary)]">
        {isLoading ? "..." : formatPtBRNumber(totalCount)}
      </span>
      <span>contatos</span>
    </div>
  );
}

function ImportExportMenu({
  compact,
  canImportLeads,
  canExportLeads,
  isExporting,
  totalCount,
  onImport,
  onExport,
}: {
  compact: boolean;
  canImportLeads: boolean;
  canExportLeads: boolean;
  isExporting: boolean;
  totalCount: number;
  onImport: () => void;
  onExport: () => void;
}) {
  if (!canImportLeads && !canExportLeads) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button
            data-tour="contacts-import"
            variant="outline"
            size="icon"
            aria-label="Importar ou exportar contatos"
            className="h-8 w-8 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
          >
            <Upload className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            data-tour="contacts-import"
            variant="outline"
            size="sm"
            aria-label="Importar ou exportar contatos"
            className="h-8 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[11px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
          >
            <Upload className="h-4 w-4" />
            <span className="hidden xl:inline">Importar / Exportar</span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-tour="contacts-import-menu"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="app-header-popover w-44 p-1"
      >
        {canImportLeads && (
          <DropdownMenuItem
            data-tour="contacts-import-action"
            onClick={onImport}
            className="h-8 cursor-pointer gap-2 rounded-[4px] px-2 py-1.5 text-[12px] font-light text-[var(--app-text-primary)] transition-colors focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]"
          >
            <Upload className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
            Importar CSV/Excel
          </DropdownMenuItem>
        )}
        {canExportLeads && (
          <DropdownMenuItem
            data-tour="contacts-export-action"
            onClick={onExport}
            disabled={isExporting || totalCount === 0}
            className="h-8 cursor-pointer gap-2 rounded-[4px] px-2 py-1.5 text-[12px] font-light text-[var(--app-text-primary)] transition-colors focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]"
          >
            <Download className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
            {isExporting ? "Exportando..." : "Exportar"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ToolbarGroupsProps = { isMobile: boolean; summary: ReactElement; actions: ReactElement };

/** Keyed groups keep filter state; a moved focused group may still need focus restored. */
class ToolbarGroups extends Component<ToolbarGroupsProps, Record<string, never>, HTMLElement | null> {
  private element = createRef<HTMLDivElement>();

  getSnapshotBeforeUpdate(previous: ToolbarGroupsProps) {
    if (previous.isMobile === this.props.isMobile) return null;
    const focused = document.activeElement;
    return focused instanceof HTMLElement && this.element.current?.contains(focused) ? focused : null;
  }

  componentDidUpdate(_previous: ToolbarGroupsProps, _state: Record<string, never>, focused: HTMLElement | null) {
    if (focused?.isConnected && document.activeElement === document.body) focused.focus({ preventScroll: true });
  }

  render() {
    const { isMobile, summary, actions } = this.props;
    return (
      <div ref={this.element} className="flex w-full flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-3">
        {isMobile ? [actions, summary] : [summary, actions]}
      </div>
    );
  }
}

export function ContactsToolbar({
  isMobile,
  totalCount,
  isCountLoading,
  canCreateLeads,
  canImportLeads,
  canExportLeads,
  isExporting,
  filters,
  onCreate,
  onImport,
  onExport,
}: ContactsToolbarProps) {
  const summary = (
        <div key="summary" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 md:flex md:shrink-0">
          <LeadCountBadge isLoading={isCountLoading} totalCount={totalCount} className="justify-start" />

          <ImportExportMenu
            compact={isMobile}
            canImportLeads={canImportLeads}
            canExportLeads={canExportLeads}
            isExporting={isExporting}
            totalCount={totalCount}
            onImport={onImport}
            onExport={onExport}
          />
        </div>
  );
  const actions = (
        <div key="actions" className={cn("grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-2 md:ml-auto md:flex md:flex-wrap md:items-center md:justify-end", !isMobile && "contacts-toolbar-actions")}>
          <div data-tour="contacts-filters" className="min-w-0 max-w-full md:flex-none [&>div]:flex-wrap [&>div]:justify-start md:[&>div]:justify-end">
            <SharedFilters {...filters} sourceFilterMaxLength={MAX_LEAD_SOURCE_FILTER_LENGTH} />
          </div>

          {canCreateLeads && (
            <Button
              data-tour="contacts-new"
              size="sm"
              onClick={onCreate}
              className="h-8 shrink-0 gap-1.5 rounded-[6px] bg-primary/50 px-2.5 text-[11px] font-light text-primary-foreground shadow-none transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:ring-1 focus-visible:ring-primary/30"
              title={isMobile ? "Novo Lead" : undefined}
            >
              <Plus className="h-4 w-4" />
              <span>{isMobile ? "Novo" : "Novo Lead"}</span>
            </Button>
          )}
        </div>
  );
  return (
    <div className="app-toolbar overflow-visible p-2 md:px-2 md:py-1">
      <ToolbarGroups isMobile={isMobile} summary={summary} actions={actions} />
    </div>
  );
}
