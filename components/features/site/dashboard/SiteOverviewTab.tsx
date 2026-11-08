import Link from "next/link";

import { formatCount, formatPercent, percentOf } from "@/components/features/marketing/marketing-format";
import {
  EmptyNote,
  KpiRow,
  Panel,
  ProgressRow,
  SegmentedBar,
  StatTile,
} from "@/components/features/marketing/marketing-ui";
import { cn } from "@/lib/utils";

import { SiteDailyChart } from "./SiteDailyChart";
import { SitePropertySpotlight } from "./SitePropertySpotlight";
import {
  SITE_CHANNELS,
  SITE_DEVICES,
  formatDecimal,
  formatDuration,
  pageLabel,
  percentDelta,
  pointsDelta,
  propertyTitleLine,
  publicPath,
  summaryChannelPercent,
  summaryDevicePercent,
  type SiteDashboardData,
} from "./site-dashboard-format";
import type { SiteTabHrefs } from "./site-dashboard-tabs";
import {
  PageCell,
  PropertyPhoto,
  SiteKpi,
  SiteTable,
  TABLE_CELL,
  TABLE_HEAD,
  WIDE_ONLY,
} from "./site-dashboard-ui";

function FunnelPanel({ data }: { data: SiteDashboardData }) {
  const { insights, summary } = data;
  const sessions = insights?.current.sessions ?? summary.uniqueSessions;
  const steps = [
    { label: "Sessões", value: sessions },
    { label: "Viram imóvel", value: insights?.current.property_sessions },
    { label: "Interagiram", value: insights?.current.interaction_sessions },
    { label: "Enviaram contato", value: insights?.current.contact_sessions },
    { label: "Viraram lead", value: insights?.current.lead_sessions },
  ];
  return (
    <Panel title="Do acesso ao lead" aside={`${formatCount(sessions)} sessões`}>
      {insights ? (
        <div className="space-y-2.5 [&>div>span:last-child]:min-w-[88px]">
          {steps.map((step) => {
            const percent = percentOf(step.value ?? 0, sessions) ?? 0;
            return (
              <ProgressRow
                key={step.label}
                label={step.label}
                value={`${formatCount(step.value)} · ${formatPercent(percent)}`}
                percent={percent}
                highlight
              />
            );
          })}
        </div>
      ) : (
        <EmptyNote>Etapas indisponíveis no momento.</EmptyNote>
      )}
    </Panel>
  );
}

function TrafficPanel({ data }: { data: SiteDashboardData }) {
  const channels = SITE_CHANNELS.map((channel) => ({
    ...channel,
    percent: summaryChannelPercent(data.summary, channel.key),
  }));
  return (
    <Panel title="Origem do tráfego">
      <SegmentedBar items={channels.map((channel) => ({ key: channel.key, value: channel.percent, className: channel.color }))} />
      <div className="mt-3 space-y-2">
        {channels.map((channel) => (
          <div key={channel.key} className="flex items-center justify-between gap-2 text-[12px] font-light">
            <span className="flex min-w-0 items-center gap-2 text-[var(--app-text-secondary)]">
              <span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 rounded-[2px]", channel.color)} />
              <span className="truncate">{channel.label}</span>
            </span>
            <span className="tabular-nums text-[var(--app-text-primary)]">{formatPercent(channel.percent, 0)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function DevicesPanel({ data }: { data: SiteDashboardData }) {
  const devices = SITE_DEVICES.map((device) => ({
    ...device,
    percent: summaryDevicePercent(data.summary, device.key),
  })).filter((device) => device.key !== "other" || device.percent > 0);
  const top = Math.max(...devices.map((device) => device.percent));
  return (
    <Panel title="Dispositivos">
      <div className="space-y-2.5 [&>div>span:last-child]:min-w-[32px]">
        {devices.map((device) => (
          <ProgressRow
            key={device.key}
            label={device.label}
            value={formatPercent(device.percent, 0)}
            percent={device.percent}
            highlight={device.percent > 0 && device.percent === top}
          />
        ))}
      </div>
    </Panel>
  );
}

function TopPagesPanel({ data, href }: { data: SiteDashboardData; href: string }) {
  const pages = data.insights?.pages.slice(0, 5) ?? [];
  return (
    <Panel
      title="Páginas mais vistas"
      aside={<Link href={href} scroll={false} className="hover:text-[var(--app-text-primary)]">Ver todas</Link>}
    >
      {pages.length > 0 ? (
        <SiteTable>
          <thead>
            <tr>
              <th className={TABLE_HEAD}>Página</th>
              <th className={TABLE_HEAD}>Visualizações</th>
              <th className={cn(TABLE_HEAD, WIDE_ONLY)}>Sessões</th>
              <th className={cn(TABLE_HEAD, WIDE_ONLY)}>Tempo médio</th>
              <th className={TABLE_HEAD}>Leads</th>
              <th className={cn(TABLE_HEAD, WIDE_ONLY)}>Conversão</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((page) => (
              <tr key={page.page_path}>
                <td className={TABLE_CELL}>
                  <PageCell label={pageLabel(page.page_path, page.title)} path={publicPath(page.page_path)} />
                </td>
                <td className={TABLE_CELL}>{formatCount(page.views)}</td>
                <td className={cn(TABLE_CELL, WIDE_ONLY)}>{formatCount(page.sessions)}</td>
                <td className={cn(TABLE_CELL, WIDE_ONLY)}>{formatDuration(page.avg_duration)}</td>
                <td className={TABLE_CELL}>{formatCount(page.leads)}</td>
                <td className={cn(TABLE_CELL, WIDE_ONLY)}>{formatPercent(page.conversion_rate)}</td>
              </tr>
            ))}
          </tbody>
        </SiteTable>
      ) : data.detailed.topPages.length > 0 ? (
        <div className="space-y-2.5">
          {data.detailed.topPages.slice(0, 5).map((page) => (
            <ProgressRow
              key={page.page_path}
              label={pageLabel(page.page_path)}
              value={formatCount(page.views)}
              percent={percentOf(page.views, data.detailed.topPages[0]?.views) ?? 0}
            />
          ))}
        </div>
      ) : (
        <EmptyNote>Nenhuma página vista no período.</EmptyNote>
      )}
    </Panel>
  );
}

function TopPropertiesPanel({ data }: { data: SiteDashboardData }) {
  const properties = data.insights?.properties.slice(0, 5) ?? [];
  const topViews = properties[0]?.views ?? 0;
  return (
    <Panel title="Imóveis mais vistos" aside="Por visualizações">
      {properties.length > 0 ? (
        <div className="space-y-1">
          {properties.map((property, index) => {
            const title = propertyTitleLine(property);
            return (
              <div key={property.property_id} className={cn("flex min-w-0 items-center gap-2.5 rounded-[8px] p-1.5", index === 0 && "bg-primary/10")}>
                <PropertyPhoto url={property.photo_url} alt={title} className="h-11 w-11 shrink-0 rounded-[6px]" iconClassName="h-4 w-4" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-normal text-[var(--app-text-primary)]" title={title}>{title}</p>
                  <p className="flex justify-between gap-2 text-[10px] font-light text-[var(--app-text-secondary)]">
                    <span className="truncate">{formatCount(property.leads)} leads · {formatCount(property.whatsapp_clicks)} WhatsApp</span>
                    <span className="tabular-nums text-[var(--app-text-primary)]">{formatCount(property.views)}</span>
                  </p>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--app-text-primary)_11%,transparent)]">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${percentOf(property.views, topViews) ?? 0}%` }} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyNote>{data.insights ? "Nenhum imóvel visto no período." : "Imóveis indisponíveis no momento."}</EmptyNote>
      )}
    </Panel>
  );
}

export function SiteOverviewTab({ data, tabHrefs }: { data: SiteDashboardData; tabHrefs: SiteTabHrefs }) {
  const { summary, detailed, insights } = data;
  const durationCoverage = percentOf(summary.measuredSessions, summary.uniqueSessions);
  const topProperty = insights?.properties[0];
  const chartRows = insights?.daily ?? detailed.dailyViews;

  return (
    <div className="space-y-3">
      <KpiRow>
        <SiteKpi
          id="sessoes"
          label="Sessões"
          value={formatCount(summary.uniqueSessions)}
          note={`${formatCount(detailed.liveVisitors)} ativos agora`}
          delta={percentDelta(summary.uniqueSessions, summary.prevSessions)}
          href={tabHrefs.origins}
        />
        <SiteKpi
          id="paginas-vistas"
          label="Páginas vistas"
          value={formatCount(summary.totalPages)}
          note={`${formatDecimal(detailed.pagesPerSession)} por sessão`}
          delta={percentDelta(summary.totalPages, summary.prevPages)}
          href={tabHrefs.pages}
        />
        <SiteKpi
          id="conversao"
          label="Conversão por sessão"
          value={formatPercent(detailed.conversionRate, 2)}
          note={insights ? `${formatCount(insights.current.converted_sessions)} de ${formatCount(insights.current.sessions)} sessões` : undefined}
          delta={pointsDelta(detailed.conversionRate, summary.prevConversionRate)}
          href={tabHrefs.journeys}
        />
        <SiteKpi
          id="leads"
          label="Leads pelo site"
          value={formatCount(detailed.siteLeads)}
          note={insights ? `${formatCount(insights.current.form_submits)} formulários enviados` : "Cadastros únicos no período"}
          delta={percentDelta(detailed.siteLeads, insights?.previous.site_leads)}
          href={tabHrefs.journeys}
        />
      </KpiRow>

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_288px]">
        <div className="min-w-0 space-y-3">
          <SiteDailyChart
            rows={chartRows}
            metric={insights ? "sessions" : "views"}
            from={data.dateFrom}
            to={data.dateTo}
            stats={
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                <StatTile label="Ativos agora" value={formatCount(detailed.liveVisitors)} note="Sessões nos últimos 5 min" />
                <StatTile
                  label="Tempo médio"
                  value={summary.measuredSessions > 0 ? formatDuration(summary.avgDuration) : "—"}
                  note={durationCoverage === null ? "Sem medição" : `${formatPercent(durationCoverage, 0)} com duração medida`}
                />
                <StatTile label="Páginas por sessão" value={formatDecimal(detailed.pagesPerSession)} note={`${formatCount(summary.totalPages)} visualizações`} />
                <StatTile label="Rejeição" value={formatPercent(detailed.bounceRate)} note="Saíram na 1ª página" />
                <div className="col-span-2 lg:col-span-1">
                  <StatTile highlight label="Leads pelo site" value={formatCount(detailed.siteLeads)} note={`${formatPercent(percentOf(detailed.siteLeads, summary.uniqueSessions), 2)} das sessões`} />
                </div>
              </div>
            }
          />
          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_minmax(0,0.85fr)]">
            <FunnelPanel data={data} />
            <TrafficPanel data={data} />
            <DevicesPanel data={data} />
          </div>
          <TopPagesPanel data={data} href={tabHrefs.pages} />
        </div>
        <div className="min-w-0 space-y-3">
          <Panel title="Imóvel do momento">
            {topProperty ? (
              <SitePropertySpotlight property={topProperty} badge="1º lugar" headline="views" siteBaseUrl={data.siteBaseUrl} />
            ) : (
              <EmptyNote>{insights ? "Nenhum imóvel visto no período." : "Imóveis indisponíveis no momento."}</EmptyNote>
            )}
          </Panel>
          <TopPropertiesPanel data={data} />
        </div>
      </div>
    </div>
  );
}
