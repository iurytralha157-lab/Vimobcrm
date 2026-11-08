import { formatCount, formatPercent, percentOf } from "@/components/features/marketing/marketing-format";
import { EmptyNote, KpiRow, Panel, ProgressRow, SegmentedBar } from "@/components/features/marketing/marketing-ui";
import { SiteVisitorOriginsCard } from "@/components/features/site/analytics/SiteVisitorOriginsCard";
import { getLocationLabel } from "@/components/features/site/analytics/location-format";
import type { useLeadAnalytics } from "@/hooks/use-lead-analytics";
import { cn } from "@/lib/utils";

import {
  SITE_CHANNELS,
  SITE_DEVICES,
  pointsDelta,
  summaryChannelPercent,
  summaryDevicePercent,
  type SiteDashboardData,
} from "./site-dashboard-format";
import { BarRow, InfoNote, PageCell, SiteKpi, SiteTable, TABLE_CELL, TABLE_HEAD, WIDE_ONLY } from "./site-dashboard-ui";

function CitiesPanel({ query }: { query: ReturnType<typeof useLeadAnalytics> }) {
  const locations = [...(query.data?.locations ?? [])].sort((a, b) => b.sessions - a.sessions);
  const total = locations.reduce((sum, location) => sum + location.sessions, 0);
  const top = locations.slice(0, 5);
  const others = total - top.reduce((sum, location) => sum + location.sessions, 0);
  return (
    <Panel title="Cidades dos visitantes" aside="Por sessões">
      {top.length > 0 ? (
        <div className="space-y-2.5">
          {top.map((location, index) => {
            const percent = percentOf(location.sessions, total) ?? 0;
            return (
              <BarRow
                key={`${location.city}:${location.region}`}
                label={getLocationLabel(location, location.city)}
                value={formatPercent(percent, 0)}
                percent={percent}
                highlight={index === 0}
              />
            );
          })}
          {others > 0 ? (
            <BarRow label="Outras" value={formatPercent(percentOf(others, total), 0)} percent={percentOf(others, total) ?? 0} />
          ) : null}
        </div>
      ) : (
        <EmptyNote>{query.isPending ? "Carregando cidades." : "Nenhuma cidade identificada no período."}</EmptyNote>
      )}
    </Panel>
  );
}

function DevicesPanel({ data }: { data: SiteDashboardData }) {
  const { insights, summary } = data;
  const shares = SITE_DEVICES.map((device) => ({ ...device, percent: summaryDevicePercent(summary, device.key) })).filter(
    (device) => device.key !== "other" || device.percent > 0,
  );
  const topShare = Math.max(...shares.map((device) => device.percent));
  const conversions = SITE_DEVICES.flatMap((device) => {
    const row = insights?.devices.find((item) => item.device_type === device.key);
    return row && row.sessions > 0
      ? [{ key: device.key, label: device.label, rate: percentOf(row.converted_sessions, row.sessions) ?? 0 }]
      : [];
  });
  const topRate = Math.max(0, ...conversions.map((device) => device.rate));
  return (
    <Panel title="Dispositivos" aside="Por sessões">
      <div className="space-y-2.5 [&>div>span:last-child]:min-w-[40px]">
        {shares.map((device) => (
          <ProgressRow
            key={device.key}
            label={device.label}
            value={formatPercent(device.percent, 0)}
            percent={device.percent}
            highlight={device.percent > 0 && device.percent === topShare}
          />
        ))}
      </div>
      <div className="mt-4 border-t border-[var(--app-border)] pt-3">
        <h3 className="mb-3 text-[14px] font-normal text-[var(--app-text-primary)]">Conversão por dispositivo</h3>
        {conversions.length > 0 ? (
          <div className="space-y-2.5 [&>div>span:last-child]:min-w-[40px]">
            {conversions.map((device) => (
              <ProgressRow
                key={device.key}
                label={device.label}
                value={formatPercent(device.rate)}
                percent={percentOf(device.rate, topRate) ?? 0}
                highlight={device.rate > 0 && device.rate === topRate}
              />
            ))}
          </div>
        ) : (
          <EmptyNote>Sem sessões para comparar.</EmptyNote>
        )}
      </div>
    </Panel>
  );
}

export function SiteOriginsTab({
  data,
  journeyQuery,
}: {
  data: SiteDashboardData;
  journeyQuery: ReturnType<typeof useLeadAnalytics>;
}) {
  const { insights, summary } = data;
  const currentTotal = insights?.current.sessions ?? summary.uniqueSessions;
  const previousTotal = insights?.previous.sessions ?? 0;
  const channels = SITE_CHANNELS.map((channel) => {
    const row = insights?.sources.find((item) => item.source_type === channel.key);
    const percent = insights ? (percentOf(row?.sessions ?? 0, currentTotal) ?? 0) : summaryChannelPercent(summary, channel.key);
    return {
      ...channel,
      row,
      percent,
      delta: previousTotal > 0 && insights ? pointsDelta(percent, percentOf(row?.prev_sessions ?? 0, previousTotal)) : null,
    };
  });
  const campaigns = insights?.campaigns ?? [];

  return (
    <div className="space-y-3">
      <KpiRow>
        {channels.slice(0, 4).map((channel) => (
          <SiteKpi
            key={channel.key}
            id={`canal-${channel.key}`}
            label={channel.label}
            value={formatPercent(channel.percent)}
            note={insights ? `${formatCount(channel.row?.sessions ?? 0)} sessões · ${formatCount(channel.row?.leads ?? 0)} leads` : undefined}
            delta={channel.delta}
          />
        ))}
      </KpiRow>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Panel title="De onde vêm as sessões" aside={`${formatCount(currentTotal)} sessões`}>
          <SegmentedBar items={channels.map((channel) => ({ key: channel.key, value: channel.percent, className: channel.color }))} />
          <div className="mt-3">
            <SiteTable>
              <thead>
                <tr>
                  <th className={TABLE_HEAD}>Origem</th>
                  <th className={TABLE_HEAD}>Sessões</th>
                  <th className={cn(TABLE_HEAD, WIDE_ONLY)}>Parte</th>
                  <th className={TABLE_HEAD}>Leads</th>
                  <th className={TABLE_HEAD}>Conversão</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((channel) => (
                  <tr key={channel.key}>
                    <td className={TABLE_CELL}>
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 rounded-[2px]", channel.color)} />
                        {channel.label}
                      </span>
                    </td>
                    <td className={TABLE_CELL}>{formatCount(channel.row?.sessions ?? (insights ? 0 : null))}</td>
                    <td className={cn(TABLE_CELL, WIDE_ONLY)}>{formatPercent(channel.percent)}</td>
                    <td className={TABLE_CELL}>{formatCount(channel.row?.leads ?? (insights ? 0 : null))}</td>
                    <td className={TABLE_CELL}>
                      {formatPercent(channel.row ? percentOf(channel.row.converted_sessions, channel.row.sessions) : null)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </SiteTable>
          </div>
          <InfoNote>
            Leads e conversão consideram contatos ligados a uma sessão rastreada. Um lead enviado sem sessão não tem
            origem atribuída aqui.
          </InfoNote>
        </Panel>
        <CitiesPanel query={journeyQuery} />
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Panel title="Campanhas que trouxeram visita" aside="Pelo UTM da URL">
          {campaigns.length > 0 ? (
            <SiteTable>
              <thead>
                <tr>
                  <th className={TABLE_HEAD}>Campanha</th>
                  <th className={TABLE_HEAD}>Sessões</th>
                  <th className={TABLE_HEAD}>Leads</th>
                  <th className={cn(TABLE_HEAD, WIDE_ONLY)}>Conversão</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={`${campaign.campaign}:${campaign.source}:${campaign.medium}`}>
                    <td className={TABLE_CELL}>
                      <PageCell label={campaign.campaign} path={[campaign.source, campaign.medium].filter(Boolean).join(" / ")} />
                    </td>
                    <td className={TABLE_CELL}>{formatCount(campaign.sessions)}</td>
                    <td className={TABLE_CELL}>{formatCount(campaign.leads)}</td>
                    <td className={cn(TABLE_CELL, WIDE_ONLY)}>{formatPercent(percentOf(campaign.converted_sessions, campaign.sessions))}</td>
                  </tr>
                ))}
              </tbody>
            </SiteTable>
          ) : (
            <EmptyNote>Nenhuma visita com campanha no período.</EmptyNote>
          )}
        </Panel>
        <DevicesPanel data={data} />
      </div>

      <SiteVisitorOriginsCard
        locations={journeyQuery.data?.locations ?? []}
        isPending={!journeyQuery.data && journeyQuery.isPending}
        isError={!journeyQuery.data && journeyQuery.isError}
        hasStaleError={Boolean(journeyQuery.data && journeyQuery.isError)}
        isFetching={journeyQuery.isFetching}
        onRetry={() => void journeyQuery.refetch()}
      />
    </div>
  );
}
