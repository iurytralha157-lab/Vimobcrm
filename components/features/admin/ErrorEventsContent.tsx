"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCcw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useErrorEvents, useResolveErrorEvent } from "@/hooks/use-error-events";
import {
  getErrorEventsPageCount,
  getErrorEventsPageRange,
  getSafeErrorEventUrl,
  groupErrorEvents,
  type ErrorEventGroup,
} from "@/lib/admin/error-events-view";
import type {
  ErrorEvent,
  ErrorEventSeverity,
  ErrorEventSource,
} from "@/lib/api/telemetry";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

const SEVERITY_OPTIONS: Array<{
  value: ErrorEventSeverity | "all";
  label: string;
}> = [
  { value: "all", label: "Todas" },
  { value: "critical", label: "Crítico" },
  { value: "error", label: "Erro" },
  { value: "warning", label: "Aviso" },
  { value: "info", label: "Informação" },
  { value: "debug", label: "Depuração" },
];

const SOURCE_OPTIONS: Array<{
  value: ErrorEventSource | "all";
  label: string;
}> = [
  { value: "all", label: "Todas" },
  { value: "frontend", label: "Frontend" },
  { value: "api", label: "API" },
  { value: "backend", label: "Backend" },
];

function formatDate(value?: string) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatUpdatedAt(value: number) {
  if (!value) return "Ainda não atualizado";

  return `Atualizado às ${new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))}`;
}

function getSeverityLabel(value: string) {
  return SEVERITY_OPTIONS.find((item) => item.value === value)?.label || value;
}

function getSourceLabel(value: string) {
  return SOURCE_OPTIONS.find((item) => item.value === value)?.label || value;
}

function getSeverityClass(severity: string) {
  if (severity === "critical" || severity === "error") {
    return "bg-destructive/10 text-destructive";
  }
  if (severity === "warning") return "bg-warning/10 text-warning";
  if (severity === "info") return "bg-chart-2/10 text-chart-2";
  return "bg-[var(--app-surface-soft)] text-muted-foreground";
}

function ErrorKpi({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof AlertTriangle;
}) {
  return (
    <div className="app-card min-h-[96px] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="app-caption">{label}</p>
          <p className="mt-2 truncate text-2xl font-normal">{value}</p>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
          <Icon className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

function EventDetails({ event }: { event: ErrorEvent }) {
  const safeUrl = getSafeErrorEventUrl(event.url);
  const detailItems = [
    { label: "Rota", value: event.path || event.route },
    { label: "Método", value: event.method },
    { label: "Status HTTP", value: event.httpStatus ? String(event.httpStatus) : "" },
    { label: "Request ID", value: event.requestId },
    { label: "Componente", value: event.component },
    { label: "Usuário", value: event.userId },
    { label: "Organização", value: event.organizationId },
  ].filter((item) => item.value);

  if (detailItems.length === 0 && !safeUrl) return null;

  return (
    <div className="mt-3 space-y-2">
      {detailItems.length > 0 ? (
        <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {detailItems.map((item) => (
            <div
              key={item.label}
              className="min-w-0 rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2"
            >
              <dt className="app-caption">{item.label}</dt>
              <dd className="mt-1 truncate font-mono text-xs font-light" title={item.value}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {safeUrl ? (
        <a
          href={safeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-8 items-center gap-2 rounded-[6px] px-2 text-xs font-light text-primary outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
          Abrir URL registrada
        </a>
      ) : null}
    </div>
  );
}

function ErrorGroupRow({
  group,
  confirming,
  mutationPending,
  resolving,
  onRequestResolve,
  onCancelResolve,
  onConfirmResolve,
}: {
  group: ErrorEventGroup<ErrorEvent>;
  confirming: boolean;
  mutationPending: boolean;
  resolving: boolean;
  onRequestResolve: (event: ErrorEvent) => void;
  onCancelResolve: () => void;
  onConfirmResolve: (event: ErrorEvent) => void;
}) {
  const event = group.latestUnresolved || group.latest;
  const unresolvedEvent = group.latestUnresolved;
  const isResolved = group.unresolvedCount === 0;
  const headingId = `error-event-${event.id}`;

  return (
    <article
      className="border-b border-[var(--app-border)] p-4 last:border-b-0"
      aria-labelledby={headingId}
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={cn(
                "rounded-[4px] border-0 px-2 py-1 text-[11px] font-light shadow-none",
                getSeverityClass(event.severity),
              )}
            >
              {getSeverityLabel(event.severity)}
            </Badge>
            <Badge
              variant="outline"
              className="rounded-[4px] border-0 bg-[var(--app-surface-soft)] px-2 py-1 text-[11px] font-light text-muted-foreground shadow-none"
            >
              {getSourceLabel(event.source)}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "rounded-[4px] border-0 px-2 py-1 text-[11px] font-light shadow-none",
                isResolved
                  ? "bg-success/10 text-success"
                  : "bg-warning/10 text-warning",
              )}
            >
              {isResolved ? "Resolvido" : "Aberto"}
            </Badge>
            <span className="text-xs font-light text-muted-foreground">
              {formatDate(event.createdAt)}
            </span>
          </div>

          <h3 id={headingId} className="mt-3 line-clamp-2 text-sm font-normal leading-6">
            {event.message}
          </h3>
          <p className="mt-1 truncate font-mono text-xs font-light text-muted-foreground">
            {event.fingerprint}
          </p>

          <EventDetails event={event} />

          {(event.stack || Object.keys(event.metadata || {}).length > 0) && (
            <details className="group mt-3 rounded-[6px] bg-[var(--app-surface-soft)]">
              <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 rounded-[6px] px-3 py-2 text-xs font-light text-muted-foreground outline-none hover:bg-[var(--app-surface-hover)] focus-visible:ring-2 focus-visible:ring-ring">
                Detalhes técnicos
                <ChevronDown
                  className="h-3.5 w-3.5 group-open:rotate-180"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
              </summary>
              <div className="space-y-2 px-3 pb-3">
                {event.stack ? (
                  <pre className="app-scrollbar max-h-44 overflow-auto whitespace-pre-wrap rounded-[6px] bg-[var(--app-background)] p-3 text-xs font-light text-muted-foreground">
                    {event.stack}
                  </pre>
                ) : null}
                {Object.keys(event.metadata || {}).length > 0 ? (
                  <pre className="app-scrollbar max-h-44 overflow-auto whitespace-pre-wrap rounded-[6px] bg-[var(--app-background)] p-3 text-xs font-light text-muted-foreground">
                    {JSON.stringify(event.metadata, null, 2)}
                  </pre>
                ) : null}
              </div>
            </details>
          )}

          {isResolved && event.resolutionNote ? (
            <p className="mt-3 rounded-[6px] bg-success/10 px-3 py-2 text-xs font-light text-success">
              Resolução: {event.resolutionNote}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between xl:w-52 xl:flex-col xl:items-end">
          <div className="text-left xl:text-right">
            <p className="text-xl font-normal">{group.count}</p>
            <p className="text-xs font-light text-muted-foreground">
              {group.count === 1 ? "ocorrência nesta página" : "ocorrências nesta página"}
            </p>
            {!isResolved ? (
              <p className="text-xs font-light text-warning">
                {group.unresolvedCount} {group.unresolvedCount === 1 ? "aberta" : "abertas"}
              </p>
            ) : null}
          </div>

          {unresolvedEvent ? (
            confirming ? (
              <div className="w-full rounded-[6px] bg-warning/10 p-2 xl:w-52" role="group" aria-label="Confirmar resolução">
                <p className="mb-2 text-xs font-light text-warning">
                  A resolução não pode ser desfeita nesta tela.
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-[6px] px-2.5 text-xs font-light shadow-none hover:bg-[var(--app-surface-hover)]"
                    disabled={mutationPending}
                    onClick={onCancelResolve}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-[6px] px-2.5 text-xs font-light shadow-none"
                    disabled={mutationPending}
                    onClick={() => onConfirmResolve(unresolvedEvent)}
                  >
                    {resolving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {resolving ? "Resolvendo" : "Confirmar"}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-xs font-light shadow-none hover:bg-[var(--app-surface-hover)]"
                disabled={mutationPending}
                onClick={() => onRequestResolve(unresolvedEvent)}
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                Resolver ocorrência
              </Button>
            )
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function ErrorEventsContent() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<ErrorEventSeverity | "all">("all");
  const [source, setSource] = useState<ErrorEventSource | "all">("all");
  const [unresolved, setUnresolved] = useState(true);
  const [page, setPage] = useState(1);
  const [confirmingEventId, setConfirmingEventId] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      search: search || undefined,
      severity,
      source,
      unresolved,
    }),
    [page, search, severity, source, unresolved],
  );

  const query = useErrorEvents(filters);
  const resolveMutation = useResolveErrorEvent();
  const events = useMemo(() => query.data?.data || [], [query.data?.data]);
  const groups = useMemo(() => groupErrorEvents(events), [events]);
  const total = query.data?.total || 0;
  const totalPages = getErrorEventsPageCount(total, PAGE_SIZE);
  const pageRange = getErrorEventsPageRange({
    page,
    pageSize: PAGE_SIZE,
    total,
    visibleCount: events.length,
  });
  const unresolvedCount = events.filter((event) => !event.resolvedAt).length;
  const errorCount = events.filter(
    (event) => event.severity === "error" || event.severity === "critical",
  ).length;
  const hasData = Boolean(query.data);
  const isInitialLoading = query.isPending && !hasData;
  const isInitialError = query.isError && !hasData;
  const showRefreshError = query.isError && hasData;
  const hasActiveFilters = Boolean(search || severity !== "all" || source !== "all" || !unresolved);

  const resetPageAndConfirmation = () => {
    setPage(1);
    setConfirmingEventId(null);
  };

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetPageAndConfirmation();
    setSearch(searchInput.trim());
  };

  const handleClearSearch = () => {
    resetPageAndConfirmation();
    setSearchInput("");
    setSearch("");
  };

  const handleClearFilters = () => {
    resetPageAndConfirmation();
    setSearchInput("");
    setSearch("");
    setSeverity("all");
    setSource("all");
    setUnresolved(true);
  };

  const handleResolve = (event: ErrorEvent) => {
    resolveMutation.mutate(
      { id: event.id, note: "Revisado pelo superadmin." },
      {
        onSuccess: () => {
          setConfirmingEventId(null);
          if (unresolved && events.length === 1 && page > 1) {
            setPage((currentPage) => Math.max(1, currentPage - 1));
          }
          toast.success("Ocorrência marcada como resolvida.");
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Não foi possível resolver a ocorrência.",
          );
        },
      },
    );
  };

  const errorMessage =
    query.error instanceof Error
      ? query.error.message
      : "Não foi possível carregar os eventos de erro.";

  return (
    <section className="space-y-4" aria-label="Eventos de erro da plataforma">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ErrorKpi
          label="Eventos filtrados"
          value={hasData ? total : "--"}
          icon={ShieldAlert}
        />
        <ErrorKpi
          label="Abertos nesta página"
          value={hasData ? unresolvedCount : "--"}
          icon={AlertTriangle}
        />
        <ErrorKpi
          label="Erros críticos nesta página"
          value={hasData ? errorCount : "--"}
          icon={ShieldAlert}
        />
        <ErrorKpi
          label="Fingerprints nesta página"
          value={hasData ? groups.length : "--"}
          icon={CheckCircle2}
        />
      </div>

      <div className="app-card p-3">
        <div className="grid gap-3 xl:grid-cols-[minmax(300px,1fr)_160px_150px_auto_auto] xl:items-end">
          <form className="space-y-2" role="search" onSubmit={handleSearch}>
            <Label htmlFor="error-search">Busca</Label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
                <Input
                  id="error-search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Mensagem, rota ou request ID"
                  className="h-10 rounded-[6px] border-0 bg-[var(--app-surface-soft)] pl-9 pr-10 font-light shadow-none"
                  maxLength={120}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-[6px] text-muted-foreground shadow-none",
                    !searchInput && "pointer-events-none opacity-35",
                  )}
                  onClick={handleClearSearch}
                  aria-label="Limpar busca"
                  title="Limpar busca"
                >
                  <X className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                </Button>
              </div>
              <Button
                type="submit"
                variant="outline"
                className="h-10 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 font-light shadow-none hover:bg-[var(--app-surface-hover)]"
              >
                <Search className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                <span className="hidden sm:inline">Buscar</span>
              </Button>
            </div>
          </form>

          <div className="space-y-2">
            <Label htmlFor="error-severity">Severidade</Label>
            <select
              id="error-severity"
              value={severity}
              onChange={(event) => {
                resetPageAndConfirmation();
                setSeverity(event.target.value as ErrorEventSeverity | "all");
              }}
              className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-sm font-light outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {SEVERITY_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="error-source">Origem</Label>
            <select
              id="error-source"
              value={source}
              onChange={(event) => {
                resetPageAndConfirmation();
                setSource(event.target.value as ErrorEventSource | "all");
              }}
              className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-sm font-light outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {SOURCE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex h-10 items-center justify-between gap-3 rounded-[6px] bg-[var(--app-surface-soft)] px-3">
            <span className="text-sm font-light">Somente abertos</span>
            <Switch
              checked={unresolved}
              onCheckedChange={(checked) => {
                resetPageAndConfirmation();
                setUnresolved(checked);
              }}
              aria-label="Mostrar somente eventos abertos"
            />
          </label>

          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 font-light shadow-none hover:bg-[var(--app-surface-hover)]"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCcw className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
            )}
            {query.isFetching ? "Atualizando" : "Atualizar"}
          </Button>
        </div>

        <div
          className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--app-border)] pt-3 text-xs font-light text-muted-foreground"
          aria-live="polite"
        >
          <span>
            {query.isFetching && hasData
              ? "Atualizando os resultados atuais..."
              : formatUpdatedAt(query.dataUpdatedAt)}
          </span>
          {query.isStale && hasData && !query.isFetching ? (
            <span>Os dados podem estar desatualizados.</span>
          ) : null}
        </div>
      </div>

      {showRefreshError ? (
        <div
          className="app-card flex flex-col gap-3 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="font-light">
              {errorMessage} O último resultado válido continua visível.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0 rounded-[6px] border-0 bg-destructive/10 px-3 font-light text-destructive shadow-none hover:bg-destructive/15 hover:text-destructive"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCcw className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
            Tentar novamente
          </Button>
        </div>
      ) : null}

      {isInitialError ? (
        <div
          className="app-card flex min-h-[280px] flex-col items-center justify-center p-6 text-center"
          role="alert"
        >
          <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-[6px] bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
          </span>
          <h2 className="app-section-title">Não foi possível carregar os eventos</h2>
          <p className="mt-2 max-w-lg text-sm font-light text-muted-foreground">
            {errorMessage}
          </p>
          <Button
            type="button"
            className="mt-4 rounded-[6px] px-3 font-light shadow-none"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCcw className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
            )}
            Tentar novamente
          </Button>
        </div>
      ) : (
        <div className="app-card overflow-hidden" aria-busy={isInitialLoading || query.isFetching}>
          {isInitialLoading ? (
            <div
              className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-sm font-light text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
              Carregando eventos de erro...
            </div>
          ) : groups.length === 0 ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center p-8 text-center">
              <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-[6px] bg-success/10 text-success">
                <CheckCircle2 className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
              </span>
              <h2 className="app-section-title">
                {unresolved && !hasActiveFilters
                  ? "Nenhuma ocorrência aberta"
                  : "Nenhum evento encontrado"}
              </h2>
              <p className="mt-2 max-w-md text-sm font-light text-muted-foreground">
                {hasActiveFilters
                  ? "Os filtros atuais não retornaram eventos."
                  : "Não há eventos de erro para exibir neste momento."}
              </p>
              {hasActiveFilters ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4 h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 font-light shadow-none hover:bg-[var(--app-surface-hover)]"
                  onClick={handleClearFilters}
                >
                  Limpar filtros
                </Button>
              ) : null}
            </div>
          ) : (
            groups.map((group) => {
              const unresolvedEvent = group.latestUnresolved;
              return (
                <ErrorGroupRow
                  key={group.fingerprint}
                  group={group}
                  confirming={Boolean(
                    unresolvedEvent && confirmingEventId === unresolvedEvent.id,
                  )}
                  mutationPending={resolveMutation.isPending}
                  resolving={Boolean(
                    unresolvedEvent &&
                      resolveMutation.isPending &&
                      resolveMutation.variables?.id === unresolvedEvent.id,
                  )}
                  onRequestResolve={(event) => setConfirmingEventId(event.id)}
                  onCancelResolve={() => setConfirmingEventId(null)}
                  onConfirmResolve={handleResolve}
                />
              );
            })
          )}
        </div>
      )}

      {hasData && total > 0 ? (
        <nav
          className="app-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
          aria-label="Paginação dos eventos de erro"
        >
          <p className="text-xs font-light text-muted-foreground">
            Exibindo {pageRange.from}–{pageRange.to} de {total} eventos
          </p>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-xs font-light shadow-none hover:bg-[var(--app-surface-hover)]"
              onClick={() => {
                setConfirmingEventId(null);
                setPage((currentPage) => Math.max(1, currentPage - 1));
              }}
              disabled={page <= 1 || query.isFetching}
              aria-label="Ir para a página anterior"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              <span className="hidden sm:inline">Anterior</span>
            </Button>
            <span className="min-w-20 text-center text-xs font-light text-muted-foreground">
              Página {page} de {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-xs font-light shadow-none hover:bg-[var(--app-surface-hover)]"
              onClick={() => {
                setConfirmingEventId(null);
                setPage((currentPage) => Math.min(totalPages, currentPage + 1));
              }}
              disabled={page >= totalPages || query.isFetching}
              aria-label="Ir para a próxima página"
            >
              <span className="hidden sm:inline">Próxima</span>
              <ChevronRight className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
            </Button>
          </div>
        </nav>
      ) : null}
    </section>
  );
}
