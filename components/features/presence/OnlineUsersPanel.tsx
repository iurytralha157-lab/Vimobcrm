"use client";

import { RefreshCw, Search, UserRoundX, X } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  formatPresenceMemberBadge,
  formatPresenceMemberRole,
  OnlineUserRow,
} from "@/components/features/presence/OnlineUserRow";
import { OnlineUsersTrigger } from "@/components/features/presence/OnlineUsersTrigger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useFloatingChat } from "@/contexts/FloatingChatContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useOrganizationPresenceList } from "@/hooks/presence";
import { searchTextIncludes } from "@/lib/search-text";
import { cn } from "@/lib/utils";
import type {
  OrganizationPresenceCounts,
  OrganizationPresenceData,
  OrganizationPresenceStatus,
  OrganizationPresenceUser,
} from "@/lib/validation";

const PRESENCE_ORDER: Record<OrganizationPresenceStatus, number> = {
  online: 0,
  idle: 1,
  offline: 2,
};
const NAME_COLLATOR = new Intl.Collator("pt-BR", { sensitivity: "base" });

const PRESENCE_SUMMARY_CONFIG: Array<{
  status: OrganizationPresenceStatus;
  label: string;
  dotClassName: string;
}> = [
  {
    status: "online",
    label: "Online",
    dotClassName: "bg-success",
  },
  {
    status: "idle",
    label: "Ausentes",
    dotClassName: "bg-warning",
  },
  {
    status: "offline",
    label: "Offline",
    dotClassName: "bg-destructive",
  },
];

type PresencePanelContentProps = {
  data: OrganizationPresenceData | undefined;
  headingId: string;
  isDialog: boolean;
  search: string;
  isPending: boolean;
  isError: boolean;
  isRefetchError: boolean;
  isFetching: boolean;
  onSearchChange: (value: string) => void;
  onClose: () => void;
  onRetry: () => void;
};

function getPresenceTimestamp(value: string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function getPresenceSortTimestamp(user: OrganizationPresenceUser) {
  if (user.presence_status === "idle") {
    return getPresenceTimestamp(user.idle_since_at ?? user.last_seen_at);
  }
  if (user.presence_status === "offline") {
    return getPresenceTimestamp(user.last_seen_at);
  }
  return Number.NEGATIVE_INFINITY;
}

function PresenceSummary({ counts }: { counts: OrganizationPresenceCounts }) {
  return (
    <div
      aria-label={`Resumo da presença: ${counts.online} online, ${counts.idle} ausentes e ${counts.offline} offline`}
      className="mt-2 grid min-w-0 grid-cols-3 gap-1.5"
    >
      {PRESENCE_SUMMARY_CONFIG.map(({ status, label, dotClassName }) => (
        <div
          key={status}
          data-presence-summary={status}
          className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 rounded-[8px] bg-[var(--app-surface-soft)] px-2 py-1.5"
        >
          <span
            aria-hidden="true"
            data-presence-summary-dot={status}
            className={cn("h-1.5 w-1.5 rounded-full", dotClassName)}
          />
          <span className="truncate text-[10px] font-normal text-[var(--app-text-secondary)]">
            {label}
          </span>
          <span className="text-[10px] font-semibold tabular-nums text-[var(--app-text-primary)]">
            {counts[status]}
          </span>
        </div>
      ))}
    </div>
  );
}

function PresenceListSkeleton() {
  return (
    <ul aria-label="Carregando usuários" aria-busy="true" className="py-1">
      {Array.from({ length: 6 }, (_, index) => (
        <li
          key={index}
          className="mx-2 my-0.5 flex items-center gap-3 rounded-[6px] px-2.5 py-2"
        >
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </li>
      ))}
    </ul>
  );
}

type PresenceRetryButtonProps = {
  compact?: boolean;
  isFetching: boolean;
  onRetry: () => void;
};

function PresenceRetryButton({
  compact = false,
  isFetching,
  onRetry,
}: PresenceRetryButtonProps) {
  return (
    <Button
      type="button"
      variant={compact ? "ghost" : "outline"}
      size="sm"
      onClick={onRetry}
      disabled={isFetching}
      className={cn(
        "rounded-[6px] text-[11px] shadow-none hover:bg-[var(--app-surface-hover)]",
        compact
          ? "h-7 shrink-0 border-0 px-2"
          : "mt-4 h-8 border-[var(--app-border)] bg-[var(--app-surface-soft)]",
      )}
    >
      <RefreshCw
        aria-hidden="true"
        className={cn(
          compact && "h-3.5 w-3.5",
          isFetching && "animate-spin motion-reduce:animate-none",
        )}
      />
      {compact ? "Atualizar" : "Tentar novamente"}
    </Button>
  );
}

function PresencePanelContent({
  data,
  headingId,
  isDialog,
  search,
  isPending,
  isError,
  isRefetchError,
  isFetching,
  onSearchChange,
  onClose,
  onRetry,
}: PresencePanelContentProps) {
  const filteredUsers = useMemo(() => {
    const users = data?.users ?? [];
    const matchingUsers = search
      ? users.filter(
          (user) =>
            searchTextIncludes(user.name, search) ||
            searchTextIncludes(user.member_role, search) ||
            searchTextIncludes(
              formatPresenceMemberBadge(
                user.member_role,
                user.is_team_leader,
              ),
              search,
            ) ||
            searchTextIncludes(
              formatPresenceMemberRole(
                user.member_role,
                user.is_team_leader,
              ),
              search,
            ),
        )
      : users;

    return [...matchingUsers].sort((firstUser, secondUser) => {
      const statusDifference =
        PRESENCE_ORDER[firstUser.presence_status] -
        PRESENCE_ORDER[secondUser.presence_status];
      if (statusDifference !== 0) return statusDifference;

      if (firstUser.presence_status === "online") {
        return NAME_COLLATOR.compare(firstUser.name, secondUser.name);
      }

      const firstTimestamp = getPresenceSortTimestamp(firstUser);
      const secondTimestamp = getPresenceSortTimestamp(secondUser);
      if (firstTimestamp !== secondTimestamp) {
        return secondTimestamp > firstTimestamp ? 1 : -1;
      }

      return NAME_COLLATOR.compare(firstUser.name, secondUser.name);
    });
  }, [data?.users, search]);
  const hasSearch = search.trim().length > 0;
  const visiblePeopleLabel = data
    ? hasSearch
      ? `${filteredUsers.length} de ${data.counts.total} pessoas`
      : `${data.counts.total} ${data.counts.total === 1 ? "pessoa visível" : "pessoas visíveis"}`
    : null;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]">
      <header className="shrink-0 px-4 pb-3 pt-3">
        <div className="flex items-start justify-between gap-3 pr-1">
          <div className="min-w-0">
            {isDialog ? (
              <SheetTitle className="min-w-0 truncate text-sm font-medium">
                Presença da equipe
              </SheetTitle>
            ) : (
              <h2 id={headingId} className="min-w-0 truncate text-sm font-medium">
                Presença da equipe
              </h2>
            )}
            {visiblePeopleLabel ? (
              <p className="mt-0.5 truncate text-[10px] font-light text-[var(--app-text-tertiary)]">
                {visiblePeopleLabel}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Fechar painel de usuários"
            onClick={onClose}
            className="h-7 w-7 shrink-0 rounded-[6px] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>

        <div className="relative mt-2 w-full min-w-0">
          <label htmlFor={`${headingId}-search`} className="sr-only">
            Buscar usuário por nome ou função
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--app-text-tertiary)]"
          />
          <Input
            id={`${headingId}-search`}
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar usuário"
            autoComplete="off"
            className="h-8 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] py-0 pl-8 pr-3 text-base font-light shadow-none placeholder:text-[var(--app-text-secondary)] focus-visible:ring-1 focus-visible:ring-primary/25 focus-visible:ring-offset-0 md:text-xs"
          />
        </div>

        {data ? <PresenceSummary counts={data.counts} /> : null}
      </header>

      {!isPending && isRefetchError && data ? (
        <div
          role="status"
          className="mx-4 mb-1 flex shrink-0 items-center gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 py-1.5"
        >
          <p className="min-w-0 flex-1 truncate text-[11px] font-light text-[var(--app-text-secondary)]">
            Não foi possível atualizar. Exibindo os últimos dados.
          </p>
          <PresenceRetryButton
            compact
            isFetching={isFetching}
            onRetry={onRetry}
          />
        </div>
      ) : null}

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full w-full min-w-0 overflow-hidden [&_[data-radix-scroll-area-viewport]]:overflow-x-hidden [&_[data-radix-scroll-area-viewport]>div]:!block [&_[data-radix-scroll-area-viewport]>div]:!min-w-0 [&_[data-radix-scroll-area-viewport]>div]:!w-full">
          {isPending ? <PresenceListSkeleton /> : null}

          {!isPending && isError && !data ? (
            <div
              role="alert"
              className="flex min-h-56 flex-col items-center justify-center px-6 py-8 text-center"
            >
              <UserRoundX
                aria-hidden="true"
                className="h-8 w-8 text-[var(--app-text-tertiary)]"
              />
              <p className="mt-3 text-xs font-medium">
                Não foi possível carregar a equipe
              </p>
              <p className="mt-1 text-[11px] font-light text-[var(--app-text-secondary)]">
                A presença está indisponível no momento. Tente novamente.
              </p>
              <PresenceRetryButton
                isFetching={isFetching}
                onRetry={onRetry}
              />
            </div>
          ) : null}

          {!isPending && data && filteredUsers.length > 0 ? (
            <ul
              aria-label="Presença dos usuários visíveis"
              className="w-full min-w-0 max-w-full overflow-x-hidden py-1 pl-2 pr-2.5"
            >
              {filteredUsers.map((user) => (
                <OnlineUserRow
                  key={user.user_id}
                  referenceTime={data.generated_at}
                  user={user}
                />
              ))}
            </ul>
          ) : null}

          {!isPending && data && filteredUsers.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center px-6 py-8 text-center">
              <UserRoundX
                aria-hidden="true"
                className="h-8 w-8 text-[var(--app-text-tertiary)]"
              />
              <p className="mt-3 text-xs font-medium">
                {hasSearch
                  ? "Nenhum usuário encontrado"
                  : "Nenhum usuário ativo"}
              </p>
              <p className="mt-1 text-[11px] font-light text-[var(--app-text-secondary)]">
                {hasSearch
                  ? "Tente buscar por outro nome ou função."
                  : "A lista será atualizada quando houver usuários ativos."}
              </p>
            </div>
          ) : null}
        </ScrollArea>
      </div>
    </div>
  );
}

export function OnlineUsersPanel() {
  const headingId = useId();
  const panelId = `${headingId}-panel`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const isTeamEditor = /^\/crm\/management\/teams\/(?:new|[^/]+\/edit)$/.test(
    pathname || "",
  );
  const { state: floatingChatState, setPresenceOpen } = useFloatingChat();
  const [search, setSearch] = useState("");
  const open = floatingChatState.isPresenceOpen;
  const presenceQuery = useOrganizationPresenceList({ enabled: open });
  const chatOwnsSurface =
    floatingChatState.isOpen &&
    !open;

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen && !open) setSearch("");
      setPresenceOpen(nextOpen);
    },
    [open, setPresenceOpen],
  );

  useEffect(() => {
    if (!open || presenceQuery.permissionsLoading) return;
    if (presenceQuery.organizationId && presenceQuery.canViewPresence) return;

    setPresenceOpen(false);
  }, [
    open,
    presenceQuery.canViewPresence,
    presenceQuery.organizationId,
    presenceQuery.permissionsLoading,
    setPresenceOpen,
  ]);

  const handleDesktopClose = useCallback(() => {
    handleOpenChange(false);
    requestAnimationFrame(() => {
      triggerRef.current?.focus({ preventScroll: true });
    });
  }, [handleOpenChange]);

  useEffect(() => {
    if (!open || isMobile) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        handleDesktopClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [handleDesktopClose, isMobile, open]);

  if (
    presenceQuery.permissionsLoading ||
    !presenceQuery.organizationId ||
    !presenceQuery.canViewPresence
  ) {
    return null;
  }

  const panelContent = (
    <PresencePanelContent
      data={presenceQuery.data}
      headingId={headingId}
      isDialog={isMobile}
      search={search}
      isPending={presenceQuery.isPending}
      isError={presenceQuery.isError}
      isRefetchError={presenceQuery.isRefetchError}
      isFetching={presenceQuery.isFetching}
      onSearchChange={setSearch}
      onClose={isMobile ? () => handleOpenChange(false) : handleDesktopClose}
      onRetry={() => {
        void presenceQuery.refetch();
      }}
    />
  );

  if (isMobile) {
    return (
      <>
        {!chatOwnsSurface ? (
          <OnlineUsersTrigger
            ref={triggerRef}
            open={open}
            onOpenChange={handleOpenChange}
            controlsId={panelId}
            className={cn(
              "fixed right-0 z-50 md:hidden",
              isTeamEditor
                ? "bottom-[calc(13rem+env(safe-area-inset-bottom))]"
                : "bottom-[calc(9rem+env(safe-area-inset-bottom))]",
            )}
          />
        ) : null}
        <Sheet open={open} onOpenChange={handleOpenChange}>
          <SheetContent
            id={panelId}
            side="right"
            className="flex h-[100dvh] max-h-[100dvh] w-[90vw] max-w-[360px] flex-col gap-0 overflow-hidden border-0 bg-[var(--app-surface-solid)] p-0 pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] shadow-none sm:max-w-[360px] data-[state=closed]:duration-150 data-[state=open]:duration-200 motion-reduce:!animate-none motion-reduce:!transition-none [&>button]:hidden"
            overlayClassName="data-[state=closed]:duration-150 data-[state=open]:duration-200 motion-reduce:!animate-none"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              triggerRef.current?.focus({ preventScroll: true });
            }}
          >
            <SheetDescription className="sr-only">
              Lista de usuários ativos, seus estados e últimos acessos.
            </SheetDescription>
            {panelContent}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <div
      data-state={open ? "open" : "closed"}
      className={cn(
        "pointer-events-none fixed inset-y-0 right-0 z-50 hidden w-[clamp(340px,25vw,360px)] transform-gpu transition-transform will-change-transform md:block motion-reduce:transition-none",
        open
          ? "translate-x-0 duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
          : "translate-x-full duration-150 ease-in",
      )}
    >
      {!chatOwnsSurface ? (
        <OnlineUsersTrigger
          ref={triggerRef}
          open={open}
          onOpenChange={handleOpenChange}
          controlsId={panelId}
          className="pointer-events-auto absolute right-full top-1/2 -translate-y-1/2"
        />
      ) : null}
      <aside
        id={panelId}
        aria-labelledby={headingId}
        aria-hidden={!open}
        inert={!open}
        className={cn(
          "h-full w-full overflow-hidden rounded-l-[8px] border-0 bg-[var(--app-surface-solid)] transition-shadow duration-200 motion-reduce:transition-none",
          open
            ? "pointer-events-auto shadow-[0_12px_32px_rgba(0,0,0,0.10)]"
            : "pointer-events-none shadow-none",
        )}
      >
        {panelContent}
      </aside>
    </div>
  );
}
