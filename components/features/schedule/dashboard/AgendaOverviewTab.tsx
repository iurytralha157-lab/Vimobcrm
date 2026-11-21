"use client";

import { EmptyNote, Panel } from "@/components/features/marketing/marketing-ui";
import { formatCount } from "@/components/features/marketing/marketing-format";
import type {
  ScheduleDashboardData,
  ScheduleDashboardEventType,
  ScheduleDashboardQuery,
  ScheduleDashboardStatus,
} from "@/lib/validation/schedule-dashboard";

import { AgendaDailyChart } from "./AgendaDailyChart";
import { AgendaDashboardKpis } from "./AgendaDashboardKpis";
import { AgendaEventsPanel } from "./AgendaEventsPanel";
import { AgendaDataQualityNotice } from "./AgendaDataQualityNotice";
import { PersonAvatar } from "./agenda-dashboard-ui";
import { getAgendaDashboardPresetRange } from "./agenda-dashboard-date-range";

export function AgendaOverviewTab({
  data,
  filters,
  eventsEnabled,
  onOpenCompromissos,
  onTypeSelect,
  onStatusSelect,
}: {
  data: ScheduleDashboardData;
  filters: ScheduleDashboardQuery;
  eventsEnabled: boolean;
  onOpenCompromissos: () => void;
  onTypeSelect: (type: ScheduleDashboardEventType) => void;
  onStatusSelect: (status: ScheduleDashboardStatus) => void;
}) {
  const { dateFrom: today } = getAgendaDashboardPresetRange("today", new Date(), data.report_timezone);

  return (
    <div className="space-y-3">
      <AgendaDashboardKpis
        kpis={data.kpis}
        dateBasis={data.period.date_basis}
        activeType={filters.eventType}
        activeStatus={filters.status}
        onOpenCompromissos={onOpenCompromissos}
        onTypeSelect={onTypeSelect}
        onStatusSelect={onStatusSelect}
      />

      <div className="grid min-w-0 grid-cols-1 items-start gap-3 @[920px]/agenda-dashboard:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <AgendaEventsPanel
          variant="today"
          className="@[920px]/agenda-dashboard:col-start-2 @[920px]/agenda-dashboard:row-start-1"
          filters={filters}
          period={{ date_from: today, date_to: today, date_basis: "start_time" }}
          reportTimezone={data.report_timezone}
          enabled={eventsEnabled}
        />
        <div className="min-w-0 space-y-3 @[920px]/agenda-dashboard:col-start-1 @[920px]/agenda-dashboard:row-start-1">
          <AgendaDailyChart
            data={data.daily}
            dateFrom={data.period.date_from}
            dateTo={data.period.date_to}
            dateBasis={data.period.date_basis}
          />
          <AgendaCreatorRanking creators={data.creator_ranking} />
        </div>
      </div>
      {data.data_quality ? <AgendaDataQualityNotice quality={data.data_quality} /> : null}
    </div>
  );
}

function AgendaCreatorRanking({ creators }: { creators: ScheduleDashboardData["creator_ranking"] }) {
  if (!creators) return null;

  return (
    <Panel title="Quem mais agendou" aside="No período selecionado">
      {creators.length > 0 ? (
        <ol className="max-h-72 overflow-y-auto overscroll-contain">
          {creators.map((creator) => (
            <li
              key={creator.user_id}
              className="flex items-center gap-2.5 border-b border-[var(--app-border)] py-2 text-[13px] last:border-b-0"
            >
              <PersonAvatar name={creator.name} avatarUrl={creator.avatar_url} />
              <span className="min-w-0 flex-1 break-words text-[var(--app-text-primary)]">{creator.name}</span>
              <span className="shrink-0 font-medium tabular-nums text-[var(--app-text-primary)]">{formatCount(creator.total)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyNote>Nenhum agendamento com autor identificado no seu recorte.</EmptyNote>
      )}
    </Panel>
  );
}
