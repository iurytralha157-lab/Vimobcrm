"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
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
import type { ErrorEvent, ErrorEventSeverity, ErrorEventSource } from "@/lib/api/telemetry";
import { cn } from "@/lib/utils";

type ErrorGroup = {
  fingerprint: string;
  count: number;
  unresolvedCount: number;
  latest: ErrorEvent;
};

const SEVERITY_OPTIONS: Array<{ value: ErrorEventSeverity | "all"; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "critical", label: "Critico" },
  { value: "error", label: "Erro" },
  { value: "warning", label: "Aviso" },
  { value: "info", label: "Info" },
  { value: "debug", label: "Debug" },
];

const SOURCE_OPTIONS: Array<{ value: ErrorEventSource | "all"; label: string }> = [
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
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getSeverityLabel(value: string) {
  return SEVERITY_OPTIONS.find((item) => item.value === value)?.label || value;
}

function getSourceLabel(value: string) {
  return SOURCE_OPTIONS.find((item) => item.value === value)?.label || value;
}

function getSeverityClass(severity: string) {
  if (severity === "critical") return "bg-red-500 text-white hover:bg-red-500";
  if (severity === "error") return "bg-[#FF4529] text-white hover:bg-[#FF4529]";
  if (severity === "warning") return "bg-amber-500 text-white hover:bg-amber-500";
  if (severity === "info") return "bg-sky-500/12 text-sky-300 hover:bg-sky-500/12";
  return "bg-[var(--app-surface-soft)] text-muted-foreground hover:bg-[var(--app-surface-soft)]";
}

function groupEvents(events: ErrorEvent[]) {
  const groups = new Map<string, ErrorGroup>();

  for (const event of events) {
    const group = groups.get(event.fingerprint);
    if (!group) {
      groups.set(event.fingerprint, {
        fingerprint: event.fingerprint,
        count: 1,
        unresolvedCount: event.resolvedAt ? 0 : 1,
        latest: event,
      });
      continue;
    }

    group.count += 1;
    if (!event.resolvedAt) {
      group.unresolvedCount += 1;
    }
    if (new Date(event.createdAt).getTime() > new Date(group.latest.createdAt).getTime()) {
      group.latest = event;
    }
  }

  return Array.from(groups.values()).sort(
    (a, b) => new Date(b.latest.createdAt).getTime() - new Date(a.latest.createdAt).getTime(),
  );
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
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-2 truncate text-2xl font-semibold">{value}</p>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-[#FF4529]/12 text-[#FF4529]">
          <Icon className="h-4 w-4" strokeWidth={1.8} />
        </span>
      </div>
    </div>
  );
}

function EventDetails({ event }: { event: ErrorEvent }) {
  const detailItems = [
    { label: "Path", value: event.path || event.route },
    { label: "Metodo", value: event.method },
    { label: "Status", value: event.httpStatus ? String(event.httpStatus) : "" },
    { label: "Request ID", value: event.requestId },
    { label: "Usuario", value: event.userId },
    { label: "Org", value: event.organizationId },
  ].filter((item) => item.value);

  return (
    <div className="mt-3 grid gap-2 md:grid-cols-3">
      {detailItems.map((item) => (
        <div key={item.label} className="rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{item.label}</p>
          <p className="mt-1 truncate font-mono text-xs">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function ErrorGroupRow({
  group,
  resolving,
  onResolve,
}: {
  group: ErrorGroup;
  resolving: boolean;
  onResolve: (event: ErrorEvent) => void;
}) {
  const event = group.latest;
  const isResolved = Boolean(event.resolvedAt);

  return (
    <article className="border-b border-white/[0.045] p-4 last:border-b-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("border-0 px-2.5 py-1", getSeverityClass(event.severity))}>
              {getSeverityLabel(event.severity)}
            </Badge>
            <Badge variant="outline" className="border-0 bg-[var(--app-surface-soft)] px-2.5 py-1 text-muted-foreground">
              {getSourceLabel(event.source)}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "border-0 px-2.5 py-1",
                isResolved ? "bg-emerald-500/12 text-emerald-300" : "bg-amber-500/12 text-amber-300",
              )}
            >
              {isResolved ? "Resolvido" : "Aberto"}
            </Badge>
            <span className="text-xs text-muted-foreground">{formatDate(event.createdAt)}</span>
          </div>

          <h3 className="mt-3 line-clamp-2 text-sm font-semibold leading-6">{event.message}</h3>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{event.fingerprint}</p>

          <EventDetails event={event} />

          {(event.stack || Object.keys(event.metadata || {}).length > 0) && (
            <details className="mt-3 rounded-[6px] bg-[var(--app-surface-soft)]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-muted-foreground">
                Detalhes tecnicos
                <ChevronDown className="h-3.5 w-3.5" />
              </summary>
              <div className="space-y-2 px-3 pb-3">
                {event.stack ? (
                  <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-[6px] bg-background/70 p-3 text-xs text-muted-foreground">
                    {event.stack}
                  </pre>
                ) : null}
                {Object.keys(event.metadata || {}).length > 0 ? (
                  <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-[6px] bg-background/70 p-3 text-xs text-muted-foreground">
                    {JSON.stringify(event.metadata, null, 2)}
                  </pre>
                ) : null}
              </div>
            </details>
          )}
        </div>

        <div className="flex shrink-0 flex-row items-center justify-between gap-3 lg:w-40 lg:flex-col lg:items-end">
          <div className="text-left lg:text-right">
            <p className="text-xl font-semibold">{group.count}</p>
            <p className="text-xs text-muted-foreground">
              {group.unresolvedCount > 0 ? `${group.unresolvedCount} abertos` : "sem pendencia"}
            </p>
          </div>
          {!isResolved ? (
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-0 bg-[var(--app-surface-soft)]"
              disabled={resolving}
              onClick={() => onResolve(event)}
            >
              {resolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Resolver
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function ErrorEventsContent() {
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<ErrorEventSeverity | "all">("all");
  const [source, setSource] = useState<ErrorEventSource | "all">("all");
  const [unresolved, setUnresolved] = useState(true);

  const filters = useMemo(
    () => ({
      limit: 100,
      search: search.trim() || undefined,
      severity,
      source,
      unresolved,
    }),
    [search, severity, source, unresolved],
  );

  const query = useErrorEvents(filters);
  const resolveMutation = useResolveErrorEvent();
  const events = useMemo(() => query.data?.data || [], [query.data?.data]);
  const groups = useMemo(() => groupEvents(events), [events]);
  const unresolvedCount = events.filter((event) => !event.resolvedAt).length;
  const errorCount = events.filter((event) => event.severity === "error" || event.severity === "critical").length;

  const handleResolve = (event: ErrorEvent) => {
    resolveMutation.mutate(
      { id: event.id, note: "Revisado pelo superadmin." },
      {
        onSuccess: () => toast.success("Erro marcado como resolvido."),
        onError: (error) => toast.error(error instanceof Error ? error.message : "Nao foi possivel resolver o erro."),
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <ErrorKpi label="Eventos filtrados" value={query.data?.total || 0} icon={ShieldAlert} />
        <ErrorKpi label="Abertos na pagina" value={unresolvedCount} icon={AlertTriangle} />
        <ErrorKpi label="Erro/critico" value={errorCount} icon={ShieldAlert} />
        <ErrorKpi label="Fingerprints" value={groups.length} icon={CheckCircle2} />
      </div>

      <div className="app-card p-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_150px_auto_auto] lg:items-end">
          <div className="space-y-2">
            <Label htmlFor="error-search">Busca</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="error-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Mensagem, path, requestId..."
                className="h-10 border-0 bg-[var(--app-surface-soft)] pl-9 pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-[6px] text-muted-foreground",
                  !search && "pointer-events-none opacity-35",
                )}
                onClick={() => setSearch("")}
                aria-label="Limpar busca"
                title="Limpar busca"
              >
                <X className="h-4 w-4" strokeWidth={1.7} />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="error-severity">Severidade</Label>
            <select
              id="error-severity"
              value={severity}
              onChange={(event) => setSeverity(event.target.value as ErrorEventSeverity | "all")}
              className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-sm outline-none"
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
              onChange={(event) => setSource(event.target.value as ErrorEventSource | "all")}
              className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-sm outline-none"
            >
              {SOURCE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex h-10 items-center justify-between gap-3 rounded-[6px] bg-[var(--app-surface-soft)] px-3">
            <span className="text-sm">Abertos</span>
            <Switch checked={unresolved} onCheckedChange={setUnresolved} />
          </label>

          <Button
            variant="outline"
            className="h-10 border-0 bg-[var(--app-surface-soft)]"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Atualizar
          </Button>
        </div>
      </div>

      {query.isError ? (
        <div className="app-card flex items-start gap-3 p-4 text-sm text-[#FFB3A6]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{query.error instanceof Error ? query.error.message : "Nao foi possivel carregar os erros."}</p>
        </div>
      ) : null}

      <div className="app-card overflow-hidden">
        {query.isLoading ? (
          <div className="flex min-h-[280px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#FF4529]" />
          </div>
        ) : groups.length === 0 ? (
          <div className="flex min-h-[280px] flex-col items-center justify-center p-8 text-center">
            <CheckCircle2 className="mb-4 h-10 w-10 text-emerald-400/70" />
            <h3 className="text-base font-semibold">Nenhum erro encontrado</h3>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">Os filtros atuais nao retornaram eventos.</p>
          </div>
        ) : (
          groups.map((group) => (
            <ErrorGroupRow
              key={group.fingerprint}
              group={group}
              resolving={resolveMutation.isPending && resolveMutation.variables?.id === group.latest.id}
              onResolve={handleResolve}
            />
          ))
        )}
      </div>
    </div>
  );
}
