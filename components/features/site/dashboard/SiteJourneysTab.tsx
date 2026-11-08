import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CheckCircle, Eye, RefreshCw } from "lucide-react";

import { formatCount, formatPercent, percentOf } from "@/components/features/marketing/marketing-format";
import { EmptyNote, KpiRow, Panel, StatTile } from "@/components/features/marketing/marketing-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { LeadJourney, useLeadAnalytics } from "@/hooks/use-lead-analytics";
import { DomainValidationError } from "@/lib/validation";

import { SITE_EVENT_LABELS, SiteJourneyDialog } from "./SiteJourneyDialog";
import {
  formatDecimal,
  formatDuration,
  journeyDevice,
  journeyOrigin,
  pageLabel,
  percentDelta,
  secondsDelta,
  type SiteDashboardData,
} from "./site-dashboard-format";
import { BarRow, InfoNote, Segmented, SiteKpi } from "./site-dashboard-ui";

const LIST_FILTERS = [
  { key: "contact", label: "Com contato" },
  { key: "all", label: "Todas" },
] as const;
type ListFilter = (typeof LIST_FILTERS)[number]["key"];

const JOURNEY_LIMIT = 20;
const JOURNEY_PATH_STEPS = 5;

function journeyErrorDescription(error: unknown) {
  if (error instanceof DomainValidationError && error.direction === "input") {
    return "O período selecionado não é válido. Escolha um intervalo de até 366 dias.";
  }
  if (error instanceof DomainValidationError && error.direction === "response") {
    return "A API respondeu em um formato incompatível. Nenhuma jornada foi estimada.";
  }
  return error instanceof Error ? error.message : "Não foi possível carregar as jornadas do site agora.";
}

function journeyContactLabel(journey: LeadJourney) {
  if (journey.event_sequence.includes("form_submit")) return "Formulário";
  if (journey.event_sequence.includes("whatsapp_click")) return "WhatsApp";
  return null;
}

/** Origin, the pages in order, without repeated reloads, and how contact happened. */
function journeySteps(journey: LeadJourney, titles: Map<string, string | null>) {
  const pages = journey.path_sequence
    .filter((path, index, list) => path !== list[index - 1])
    .map((path) => pageLabel(path, titles.get(path)));
  const hidden = Math.max(0, pages.length - JOURNEY_PATH_STEPS);
  const visible = hidden > 0 ? [...pages.slice(0, JOURNEY_PATH_STEPS - 1), `+${hidden}`, pages[pages.length - 1]] : pages;
  return [journeyOrigin(journey), ...visible, journeyContactLabel(journey)].filter(Boolean).join(" › ");
}

function JourneyRow({
  journey,
  titles,
  onOpen,
}: {
  journey: LeadJourney;
  titles: Map<string, string | null>;
  onOpen: () => void;
}) {
  const details = [journeyDevice(journey.device_type), journey.city].filter(Boolean).join(" · ");
  const status = journey.has_lead ? "Lead no CRM" : journey.seconds_to_contact !== null ? "Contato enviado" : "Sem contato";
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 border-t border-[var(--app-border)] py-2.5 text-[12px] font-light md:grid-cols-[150px_minmax(0,1fr)_auto_auto]">
      <div className="min-w-0">
        <p className="truncate text-[12px] text-[var(--app-text-primary)]">{journey.session_id.substring(0, 8)}</p>
        <p className="truncate text-[10px] text-[var(--app-text-tertiary)]">
          {details || format(new Date(journey.first_event), "dd/MM HH:mm", { locale: ptBR })}
        </p>
      </div>
      <p className="col-span-3 row-start-2 min-w-0 break-words text-[var(--app-text-secondary)] md:col-span-1 md:row-start-auto">
        {journeySteps(journey, titles)}
      </p>
      <div className="whitespace-nowrap text-right">
        <p className="tabular-nums text-[var(--app-text-primary)]">{formatDuration(journey.seconds_to_contact)}</p>
        <p className="flex items-center justify-end gap-1 text-[10px] text-[var(--app-text-tertiary)]">
          {journey.has_lead ? <CheckCircle className="h-3 w-3 text-emerald-500" aria-hidden="true" /> : null}
          {status}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-[6px] shadow-none hover:bg-[var(--app-surface-hover)]"
        aria-label={`Ver jornada da sessão ${journey.session_id}`}
        title="Ver detalhes da jornada"
        onClick={onOpen}
      >
        <Eye className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

function JourneyList({
  data,
  query,
}: {
  data: SiteDashboardData;
  query: ReturnType<typeof useLeadAnalytics>;
}) {
  const [filter, setFilter] = useState<ListFilter | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const journeys = query.data?.journeys ?? [];
  const withContact = journeys.filter((journey) => journey.seconds_to_contact !== null || journey.converted);
  const activeFilter = filter ?? (withContact.length > 0 ? "contact" : "all");
  const listed = (activeFilter === "contact" ? withContact : journeys).slice(0, JOURNEY_LIMIT);
  const titles = new Map((data.insights?.pages ?? []).map((page) => [page.page_path, page.title]));

  if (!query.data && query.isPending) {
    return <Skeleton aria-label="Carregando percursos dos leads" className="h-64 rounded-[12px] bg-[var(--app-surface-solid)]" />;
  }

  return (
    <Panel
      title="Percurso dos leads"
      aside={<Segmented label="Sessões exibidas" value={activeFilter} options={LIST_FILTERS} onChange={setFilter} />}
    >
      {!query.data && query.isError ? (
        <div role="alert" className="py-6 text-center">
          <p className="text-[14px] font-normal text-[var(--app-text-primary)]">Não foi possível carregar os percursos</p>
          <p className="mt-1 text-[12px] font-light text-[var(--app-text-tertiary)]">{journeyErrorDescription(query.error)}</p>
          <Button
            type="button"
            size="sm"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="mt-3 h-8 rounded-[6px] px-3 text-[12px] shadow-none"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
            {query.isFetching ? "Carregando" : "Tentar novamente"}
          </Button>
        </div>
      ) : listed.length > 0 ? (
        <>
          {query.isError ? (
            <p role="status" className="mb-2 rounded-[6px] bg-amber-500/[0.08] px-2.5 py-1.5 text-[11px] font-light text-[var(--app-text-secondary)]">
              Os últimos percursos válidos continuam visíveis, mas a atualização falhou.
            </p>
          ) : null}
          {listed.map((journey) => (
            <JourneyRow key={journey.session_id} journey={journey} titles={titles} onOpen={() => setSelectedSessionId(journey.session_id)} />
          ))}
          <InfoNote>
            Sessões mais recentes do período, sem nomes de leads: esta tela não aplica a regra de quais leads cada pessoa
            pode ver. O tempo vai do início da sessão até o primeiro contato.
          </InfoNote>
        </>
      ) : (
        <EmptyNote>
          {activeFilter === "contact" ? "Nenhuma sessão recente enviou contato." : "Os dados aparecerão quando visitantes navegarem pelo site público."}
        </EmptyNote>
      )}
      <SiteJourneyDialog
        journey={journeys.find((journey) => journey.session_id === selectedSessionId) ?? null}
        onClose={() => setSelectedSessionId(null)}
      />
    </Panel>
  );
}

export function SiteJourneysTab({
  data,
  journeyQuery,
}: {
  data: SiteDashboardData;
  journeyQuery: ReturnType<typeof useLeadAnalytics>;
}) {
  const { detailed, insights } = data;
  const current = insights?.current;
  const previous = insights?.previous;
  const eventRows = current
    ? [
        { key: "views", label: "Visualizações", value: current.views },
        { key: "property", label: SITE_EVENT_LABELS.property_view, value: current.property_views },
        { key: "searches", label: "Buscas", value: current.searches },
        { key: "favorites", label: "Favoritos", value: current.favorites },
        { key: "whatsapp", label: "WhatsApp", value: current.whatsapp_clicks, highlight: true },
        { key: "cta", label: "Chamadas clicadas", value: current.cta_clicks },
        { key: "forms", label: "Formulários", value: current.form_submits, highlight: true },
      ].filter((row) => row.key !== "cta" || row.value > 0)
    : [];
  const topEvent = Math.max(0, ...eventRows.map((row) => row.value));
  const paths = insights?.contactPaths ?? [];
  const median = current?.median_seconds_to_contact;

  return (
    <div className="space-y-3">
      <KpiRow>
        <SiteKpi
          id="interacao"
          label="Sessões com interação"
          value={formatCount(current?.interaction_sessions)}
          note={current ? `${formatPercent(percentOf(current.interaction_sessions, current.sessions))} das sessões` : undefined}
          delta={percentDelta(current?.interaction_sessions, previous?.interaction_sessions)}
        />
        <SiteKpi
          id="contatos"
          label="Contatos enviados"
          value={formatCount(current?.contacts)}
          note="WhatsApp e formulário"
          delta={percentDelta(current?.contacts, previous?.contacts)}
        />
        <SiteKpi
          id="leads"
          label="Leads pelo site"
          value={formatCount(detailed.siteLeads)}
          note="Cadastros novos no período"
          delta={percentDelta(detailed.siteLeads, previous?.site_leads)}
        />
        <SiteKpi
          id="tempo-contato"
          label="Tempo até o contato"
          value={formatDuration(median)}
          note="Mediana"
          delta={secondsDelta(median, previous?.median_seconds_to_contact, true)}
        />
      </KpiRow>

      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        <Panel title="O que fazem no site" aside="Eventos no período">
          {eventRows.length > 0 ? (
            <div className="space-y-2.5">
              {eventRows.map((row) => (
                <BarRow
                  key={row.key}
                  label={row.label}
                  value={formatCount(row.value)}
                  percent={percentOf(row.value, topEvent) ?? 0}
                  highlight={row.highlight}
                />
              ))}
            </div>
          ) : (
            <EmptyNote>Eventos indisponíveis no momento.</EmptyNote>
          )}
        </Panel>
        <Panel title="Até o primeiro contato" aside="Das sessões que enviaram contato">
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StatTile label="Tempo até o contato" value={formatDuration(median)} note="Mediana" />
            <StatTile label="Páginas até o contato" value={formatDecimal(current?.avg_pages_to_contact)} note="Média" />
            <div className="col-span-2 sm:col-span-1">
              <StatTile
                label="Leads que voltaram"
                value={formatPercent(current ? percentOf(current.returning_leads, current.leads) : null, 0)}
                note="Já estavam no CRM"
              />
            </div>
          </div>
          {paths.length > 0 ? (
            <div className="space-y-2.5">
              {paths.map((path, index) => (
                <BarRow
                  key={path.path}
                  label={path.path}
                  value={formatCount(path.sessions)}
                  percent={percentOf(path.sessions, paths[0]?.sessions) ?? 0}
                  highlight={index === 0}
                />
              ))}
            </div>
          ) : (
            <EmptyNote>Nenhum contato enviado no período.</EmptyNote>
          )}
        </Panel>
      </div>

      <JourneyList data={data} query={journeyQuery} />
    </div>
  );
}
