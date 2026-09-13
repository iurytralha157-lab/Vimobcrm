import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CircleDot,
  ExternalLink,
  Loader2,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Phone,
  RefreshCw,
  Trash2,
  Trophy,
  XCircle,
} from "lucide-react";

import { ContactCard } from "@/components/features/contacts/ContactCard";
import { EmptyState } from "@/components/features/contacts/EmptyState";
import { TableSkeleton } from "@/components/features/contacts/TableSkeleton";
import { ReentryBadge } from "@/components/features/leads/ReentryBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Contact, ContactListFilters } from "@/hooks/use-contacts-list";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/user-display";

import { CONTACT_SOURCE_LABELS, getContactDealStatus } from "./model";

type ContactsListProps = {
  isMobile: boolean;
  contacts: Contact[];
  isLoading: boolean;
  isTransitioning: boolean;
  showRefreshError: boolean;
  showErrorState: boolean;
  errorMessage: string;
  isFetching: boolean;
  hasActiveFilters: boolean;
  canCreateLeads: boolean;
  canImportLeads: boolean;
  canDeleteLeads: boolean;
  canUseWhatsApp: boolean;
  lostLeadsView: boolean;
  selectedIds: ReadonlySet<string>;
  sortBy: ContactListFilters["sortBy"];
  sortDir: ContactListFilters["sortDir"];
  onRetry: () => void;
  onClearFilters: () => void;
  onCreate: () => void;
  onImport: () => void;
  onToggleLostLeadsView: () => void;
  onViewDetails: (contactId: string) => void;
  onWhatsApp: (contact: Contact) => void;
  onRequestDelete: (contactId: string) => void;
  onToggleSelectAll: () => void;
  onToggleSelectOne: (contactId: string) => void;
  onSort: (column: ContactListFilters["sortBy"]) => void;
  footer?: ReactNode;
};

const dealStatusConfig = {
  open: {
    label: "Aberto",
    icon: CircleDot,
    className: "bg-[var(--app-surface-soft)] text-muted-foreground",
  },
  won: {
    label: "Ganho",
    icon: Trophy,
    className:
      "bg-[var(--lead-status-won-bg)] text-[var(--lead-status-won-fg)]",
  },
  lost: {
    label: "Perdido",
    icon: XCircle,
    className:
      "bg-[var(--lead-status-lost-bg)] text-[var(--lead-status-lost-fg)]",
  },
};

function SortIcon({
  column,
  sortBy,
  sortDir,
}: {
  column: ContactListFilters["sortBy"];
  sortBy: ContactListFilters["sortBy"];
  sortDir: ContactListFilters["sortDir"];
}) {
  if (sortBy !== column) {
    return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;
  }

  return sortDir === "asc" ? (
    <ArrowUp className="h-3 w-3 ml-1" />
  ) : (
    <ArrowDown className="h-3 w-3 ml-1" />
  );
}

function ContactsErrorState({
  message,
  onRetry,
  isRetrying,
}: {
  message: string;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-destructive/15 text-destructive">
        <AlertTriangle className="h-4 w-4" />
      </div>
      <div className="mt-3 space-y-1">
        <h3 className="text-[14px] font-medium text-[var(--app-text-primary)]">
          Não foi possível carregar os contatos
        </h3>
        <p className="max-w-[420px] text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
          {message}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        disabled={isRetrying}
        className="mt-3 h-8 gap-2 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[11px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
      >
        <RefreshCw
          className={cn("h-3.5 w-3.5", isRetrying && "animate-spin")}
        />
        Tentar novamente
      </Button>
    </div>
  );
}

function AssigneeAvatarCell({
  name,
  avatarUrl,
}: {
  name: string | null;
  avatarUrl: string | null;
}) {
  const label = name || "Sem responsável";

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex min-w-0 items-center gap-2">
            {name ? (
              <Avatar className="h-7 w-7 rounded-[6px] [&_img]:rounded-[6px]">
                <AvatarImage src={avatarUrl || undefined} alt={name} />
                <AvatarFallback className="rounded-[6px] bg-primary/50 text-[10px] font-light text-primary-foreground">
                  {getInitials(name)}
                </AvatarFallback>
              </Avatar>
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[10px] font-light text-[var(--app-text-tertiary)]">
                --
              </div>
            )}
            <span className="min-w-0 truncate text-[11px] font-light text-[var(--app-text-secondary)]">
              {label}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function MobileContactsLoading() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="grid animate-pulse grid-cols-[36px_minmax(0,1fr)_32px] items-center gap-2.5 rounded-[6px] px-2 py-2.5"
        >
          <div className="h-9 w-9 rounded-[6px] bg-[var(--app-surface-soft)]" />
          <div className="min-w-0 space-y-2">
            <div className="h-3 w-32 rounded-[4px] bg-[var(--app-surface-soft)]" />
            <div className="h-3 w-44 max-w-full rounded-[4px] bg-[var(--app-surface-soft)]" />
            <div className="h-3 w-28 rounded-[4px] bg-[var(--app-surface-soft)]" />
          </div>
          <div className="h-8 w-8 rounded-[6px] bg-[var(--app-surface-soft)]" />
        </div>
      ))}
    </div>
  );
}

function ContactsEmptyState({
  hasActiveFilters,
  canImportLeads,
  canCreateLeads,
  onImport,
  onCreate,
  onClearFilters,
}: Pick<
  ContactsListProps,
  | "hasActiveFilters"
  | "canImportLeads"
  | "canCreateLeads"
  | "onImport"
  | "onCreate"
  | "onClearFilters"
>) {
  return (
    <EmptyState
      hasActiveFilters={!!hasActiveFilters}
      onImport={canImportLeads ? onImport : undefined}
      onCreate={canCreateLeads ? onCreate : undefined}
      onClearFilters={onClearFilters}
    />
  );
}

function ContactsMobileList({
  contacts,
  isLoading,
  showErrorState,
  errorMessage,
  isFetching,
  hasActiveFilters,
  canCreateLeads,
  canImportLeads,
  canDeleteLeads,
  onRetry,
  onClearFilters,
  onCreate,
  onImport,
  onViewDetails,
  onWhatsApp,
  onRequestDelete,
  canUseWhatsApp,
}: Pick<
  ContactsListProps,
  | "contacts"
  | "isLoading"
  | "showErrorState"
  | "errorMessage"
  | "isFetching"
  | "hasActiveFilters"
  | "canCreateLeads"
  | "canImportLeads"
  | "canDeleteLeads"
  | "onRetry"
  | "onClearFilters"
  | "onCreate"
  | "onImport"
  | "onViewDetails"
  | "onWhatsApp"
  | "onRequestDelete"
  | "canUseWhatsApp"
>) {
  if (showErrorState) {
    return (
      <ContactsErrorState
        message={errorMessage}
        onRetry={onRetry}
        isRetrying={isFetching}
      />
    );
  }

  if (isLoading) return <MobileContactsLoading />;

  if (contacts.length === 0) {
    return (
      <ContactsEmptyState
        hasActiveFilters={hasActiveFilters}
        canImportLeads={canImportLeads}
        canCreateLeads={canCreateLeads}
        onImport={onImport}
        onCreate={onCreate}
        onClearFilters={onClearFilters}
      />
    );
  }

  return (
    <div className="space-y-1">
      {contacts.map((contact) => (
        <ContactCard
          key={contact.id}
          contact={contact}
          sourceLabels={CONTACT_SOURCE_LABELS}
          onViewDetails={() => onViewDetails(contact.id)}
          onWhatsApp={
            canUseWhatsApp ? () => onWhatsApp(contact) : undefined
          }
          onDelete={
            canDeleteLeads ? () => onRequestDelete(contact.id) : undefined
          }
        />
      ))}
    </div>
  );
}

function ContactsDesktopTable(props: ContactsListProps) {
  const {
    contacts,
    isLoading,
    showErrorState,
    errorMessage,
    isFetching,
    hasActiveFilters,
    canCreateLeads,
    canImportLeads,
    canDeleteLeads,
    lostLeadsView,
    selectedIds,
    sortBy,
    sortDir,
    onRetry,
    onClearFilters,
    onCreate,
    onImport,
    onViewDetails,
    onWhatsApp,
    onRequestDelete,
    canUseWhatsApp,
    onToggleSelectAll,
    onToggleSelectOne,
    onSort,
  } = props;

  if (showErrorState) {
    return (
      <ContactsErrorState
        message={errorMessage}
        onRetry={onRetry}
        isRetrying={isFetching}
      />
    );
  }

  if (isLoading) {
    return (
      <Table className="contacts-table crm-management-table min-w-[1120px] table-fixed [&_td]:px-2.5 [&_td]:py-2.5 [&_th]:h-8 [&_th]:px-2.5 [&_th]:text-[10px] [&_th]:font-light">
        <TableSkeleton showSelection={canDeleteLeads} />
      </Table>
    );
  }

  if (contacts.length === 0) {
    return (
      <ContactsEmptyState
        hasActiveFilters={hasActiveFilters}
        canImportLeads={canImportLeads}
        canCreateLeads={canCreateLeads}
        onImport={onImport}
        onCreate={onCreate}
        onClearFilters={onClearFilters}
      />
    );
  }

  return (
    <Table className="contacts-table crm-management-table min-w-[1120px] table-fixed border-separate border-spacing-0 [&_td]:px-2.5 [&_td]:py-2.5 [&_th]:h-8 [&_th]:px-2.5 [&_th]:text-[10px] [&_th]:font-light [&_th]:text-[var(--app-text-tertiary)]">
      <TableHeader className="crm-management-sticky-header sticky top-0 z-20">
        <TableRow className="border-b border-[var(--app-border-strong)] bg-[var(--app-surface-soft)] hover:bg-[var(--app-surface-soft)]">
          {canDeleteLeads && (
            <TableHead className="w-12">
              <Checkbox
                data-tour="contacts-select-all"
                aria-label="Selecionar todos os contatos desta página"
                checked={
                  selectedIds.size === contacts.length && contacts.length > 0
                }
                onCheckedChange={onToggleSelectAll}
              />
            </TableHead>
          )}
          <TableHead
            aria-sort={
              sortBy === "name"
                ? sortDir === "asc"
                  ? "ascending"
                  : "descending"
                : "none"
            }
          >
            <button
              type="button"
              onClick={() => onSort("name")}
              className="flex h-8 w-full items-center rounded-[4px] text-left outline-none transition-colors hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-primary/30"
            >
              Nome <SortIcon column="name" sortBy={sortBy} sortDir={sortDir} />
            </button>
          </TableHead>
          <TableHead>Contato</TableHead>
          <TableHead className="w-24 xl:w-28">
            {lostLeadsView ? "Motivo da perda" : "Status"}
          </TableHead>
          <TableHead className="w-36 xl:w-44">Pipeline / Estágio</TableHead>
          <TableHead className="w-36 xl:w-44">Responsável</TableHead>
          <TableHead className="hidden w-40 xl:table-cell 2xl:w-48">
            Tags
          </TableHead>
          <TableHead
            className="w-24 xl:w-40"
            aria-sort={
              sortBy === "created_at"
                ? sortDir === "asc"
                  ? "ascending"
                  : "descending"
                : "none"
            }
          >
            <button
              type="button"
              onClick={() => onSort("created_at")}
              className="flex h-8 w-full items-center rounded-[4px] text-left outline-none transition-colors hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-primary/30"
            >
              Criado em{" "}
              <SortIcon column="created_at" sortBy={sortBy} sortDir={sortDir} />
            </button>
          </TableHead>
          <TableHead className="contacts-actions-cell w-16 text-right">
            <span>Ações</span>
          </TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {contacts.map((contact) => {
          const isLost = contact.deal_status === "lost";
          const isWon = contact.deal_status === "won";
          const status = getContactDealStatus(contact.deal_status);
          const StatusIcon = dealStatusConfig[status]?.icon || CircleDot;

          return (
            <TableRow
              key={contact.id}
              className={cn(
                "group cursor-pointer border-b border-border/30 transition-colors hover:bg-[var(--app-surface-hover)] last:border-b-0",
                isLost &&
                  "bg-[var(--lead-status-lost-card)] hover:bg-[var(--lead-status-lost-card-hover)]",
                isWon &&
                  "bg-[var(--lead-status-won-card)] hover:bg-[var(--lead-status-won-card-hover)]",
              )}
              data-deal-status={status}
              onClick={() => onViewDetails(contact.id)}
            >
              {canDeleteLeads && (
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    aria-label={`Selecionar ${contact.name}`}
                    checked={selectedIds.has(contact.id)}
                    onCheckedChange={() => onToggleSelectOne(contact.id)}
                  />
                </TableCell>
              )}

              <TableCell>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onViewDetails(contact.id);
                  }}
                  className="flex min-w-0 items-center gap-3 rounded-[4px] text-left outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
                >
                  <Avatar className="h-9 w-9 shrink-0 rounded-[6px] [&_img]:rounded-[6px]">
                    <AvatarImage
                      src={contact.whatsapp_avatar_url || undefined}
                      alt={contact.name}
                    />
                    <AvatarFallback className="rounded-[6px] bg-primary/50 text-[11px] font-light text-primary-foreground transition-colors group-hover:bg-primary">
                      {getInitials(contact.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="truncate text-[13px] font-medium text-[var(--app-text-primary)]"
                        title={contact.name}
                      >
                        {contact.name}
                      </span>
                      <ReentryBadge
                        count={contact.reentry_count}
                        lastEntryAt={contact.last_entry_at}
                      />
                    </div>
                    {contact.source && (
                      <p
                        className="truncate text-[11px] font-light text-[var(--app-text-tertiary)]"
                        title={
                          CONTACT_SOURCE_LABELS[contact.source] ||
                          contact.source
                        }
                      >
                        {CONTACT_SOURCE_LABELS[contact.source] ||
                          contact.source}
                      </p>
                    )}
                  </div>
                </button>
              </TableCell>

              <TableCell>
                <div className="min-w-0 space-y-1">
                  {contact.phone && (
                    <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-light text-[var(--app-text-secondary)]">
                      <Phone className="h-3 w-3 shrink-0 text-[var(--app-text-tertiary)]" />
                      <span className="truncate" title={contact.phone}>
                        {contact.phone}
                      </span>
                    </div>
                  )}
                  {contact.email && (
                    <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-light text-[var(--app-text-secondary)]">
                      <Mail className="h-3 w-3 shrink-0 text-[var(--app-text-tertiary)]" />
                      <span className="truncate" title={contact.email}>
                        {contact.email}
                      </span>
                    </div>
                  )}
                </div>
              </TableCell>

              <TableCell onClick={() => onViewDetails(contact.id)}>
                {lostLeadsView ? (
                  <p
                    className="max-w-[260px] text-[12px] font-light leading-5 text-red-700 dark:text-red-300"
                    title={contact.lost_reason || undefined}
                  >
                    {contact.lost_reason || "Motivo não informado"}
                  </p>
                ) : (
                  <div className="space-y-1">
                    <Badge
                      variant="secondary"
                      className={cn(
                        "gap-1 rounded-[4px] border-0 px-1.5 py-0.5 text-[10px] font-light whitespace-nowrap",
                        dealStatusConfig[status]?.className,
                      )}
                    >
                      <StatusIcon className="h-3 w-3" />
                      {dealStatusConfig[status]?.label}
                    </Badge>
                    {isLost && contact.lost_reason && (
                      <p
                        className="max-w-[150px] truncate text-[10px] font-light text-red-600 dark:text-red-400"
                        title={contact.lost_reason}
                      >
                        {contact.lost_reason}
                      </p>
                    )}
                  </div>
                )}
              </TableCell>

              <TableCell onClick={() => onViewDetails(contact.id)}>
                <div className="space-y-1">
                  {contact.stage_name && (
                    <Badge
                      variant="secondary"
                      className="max-w-[150px] justify-center truncate rounded-[4px] border-0 bg-[var(--app-surface-soft)] px-1.5 py-0.5 text-[10px] font-light text-[var(--app-text-secondary)] whitespace-nowrap"
                      title={contact.stage_name}
                    >
                      {contact.stage_name}
                    </Badge>
                  )}
                </div>
              </TableCell>

              <TableCell
                className="w-36 xl:w-44"
                onClick={() => onViewDetails(contact.id)}
              >
                <AssigneeAvatarCell
                  name={contact.assignee_name}
                  avatarUrl={contact.assignee_avatar}
                />
              </TableCell>

              <TableCell
                className="hidden xl:table-cell"
                onClick={() => onViewDetails(contact.id)}
              >
                <div className="flex flex-wrap gap-1">
                  {contact.tags?.slice(0, 2).map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="secondary"
                      className="rounded-[4px] px-1.5 text-[9px] font-light"
                      style={{
                        backgroundColor: tag.color,
                        borderColor: tag.color,
                        color: "#ffffff",
                      }}
                    >
                      {tag.name}
                    </Badge>
                  ))}
                  {contact.tags && contact.tags.length > 2 && (
                    <Badge
                      variant="secondary"
                      className="rounded-[4px] px-1.5 text-[9px] font-light"
                    >
                      +{contact.tags.length - 2}
                    </Badge>
                  )}
                </div>
              </TableCell>

              <TableCell onClick={() => onViewDetails(contact.id)}>
                <p className="whitespace-nowrap text-[12px] font-light text-[var(--app-text-secondary)]">
                  <span className="xl:hidden">
                    {format(new Date(contact.created_at), "dd/MM/yy", {
                      locale: ptBR,
                    })}
                  </span>
                  <span className="hidden xl:inline">
                    {format(new Date(contact.created_at), "dd/MM/yyyy HH:mm", {
                      locale: ptBR,
                    })}
                  </span>
                </p>
              </TableCell>

              <TableCell
                className="contacts-actions-cell w-16 px-2 text-right"
                onClick={(event) => event.stopPropagation()}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Ações de ${contact.name}`}
                      className="h-8 w-8 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-[var(--app-border-strong)] data-[state=open]:bg-[var(--app-surface-hover)] data-[state=open]:text-[var(--app-text-primary)]"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    sideOffset={8}
                    collisionPadding={12}
                    className="app-header-popover w-52 p-2"
                  >
                    <DropdownMenuItem
                      onClick={() => onViewDetails(contact.id)}
                      className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light text-[var(--app-text-primary)] transition-colors focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]"
                    >
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
                      Ver detalhes
                    </DropdownMenuItem>
                    {contact.phone && canUseWhatsApp && (
                      <DropdownMenuItem
                        onClick={() => onWhatsApp(contact)}
                        className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light text-[var(--app-text-primary)] transition-colors focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]"
                      >
                        <MessageCircle className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
                        WhatsApp
                      </DropdownMenuItem>
                    )}
                    {canDeleteLeads && (
                      <>
                        <DropdownMenuSeparator className="mx-0 my-1 bg-border/30" />
                        <DropdownMenuItem
                          className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light text-destructive transition-colors focus:bg-destructive/10 focus:text-destructive data-[highlighted]:!bg-destructive/10 data-[highlighted]:!text-destructive"
                          onClick={() => onRequestDelete(contact.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 shrink-0 text-destructive" />
                          Excluir
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function ContactsList(props: ContactsListProps) {
  const {
    isMobile,
    isTransitioning,
    showRefreshError,
    isFetching,
    lostLeadsView,
    onRetry,
    onToggleLostLeadsView,
    footer,
  } = props;

  return (
    <div className="contacts-page-list flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {lostLeadsView && (
        <div className="shrink-0 rounded-[8px] bg-red-500/10 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-red-500/70 text-white">
                <XCircle className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-[13px] font-medium text-red-700 dark:text-red-300">
                  Leads perdidos
                </h2>
                <p className="text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
                  Listando leads marcados como perdidos e o motivo informado na
                  perda.
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleLostLeadsView}
              className="h-8 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 text-[11px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
            >
              Ver todos os leads
            </Button>
          </div>
        </div>
      )}

      <Card
        data-tour="contacts-list"
        className="app-card contacts-table-card relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-0 shadow-none"
      >
        {isTransitioning && (
          <div
            role="status"
            aria-live="polite"
            className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--app-bg)]/70"
          >
            <div className="flex items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2 text-[12px] font-light text-[var(--app-text-primary)] shadow-none">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>Carregando contatos...</span>
            </div>
          </div>
        )}

        {showRefreshError && (
          <div
            role="status"
            className="absolute right-3 top-3 z-30 flex items-center gap-2 rounded-[6px] bg-amber-500/12 px-3 py-1.5 text-[11px] font-light text-amber-800 dark:text-amber-100"
          >
            <AlertTriangle
              className="h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>Os contatos exibidos podem estar desatualizados.</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRetry}
              disabled={isFetching}
              className="h-7 rounded-[4px] bg-[var(--app-surface-solid)] px-2 text-[10px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
            >
              <RefreshCw
                className={cn("h-3 w-3", isFetching && "animate-spin")}
                aria-hidden="true"
              />
              Tentar novamente
            </Button>
          </div>
        )}

        {isMobile ? (
          <div
            data-contacts-scroll-region
            className="app-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5"
          >
            <ContactsMobileList {...props} />
          </div>
        ) : (
          <div
            data-contacts-scroll-region
            className="contacts-table-scroll min-h-0 min-w-0 flex-1 overflow-hidden [&>div]:h-full [&>div]:overflow-auto [&>div]:overscroll-contain"
          >
            <ContactsDesktopTable {...props} />
          </div>
        )}

        {footer && (
          <div data-contacts-pagination className="shrink-0">
            {footer}
          </div>
        )}
      </Card>
    </div>
  );
}
