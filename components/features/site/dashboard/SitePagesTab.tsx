import { formatCount, formatPercent, percentOf } from "@/components/features/marketing/marketing-format";
import { EmptyNote, KpiRow, Panel } from "@/components/features/marketing/marketing-ui";
import { cn } from "@/lib/utils";

import {
  formatDecimal,
  formatDuration,
  pageLabel,
  percentDelta,
  pointsDelta,
  publicPath,
  secondsDelta,
  type SiteDashboardData,
} from "./site-dashboard-format";
import {
  BarRow,
  InfoNote,
  PageCell,
  SiteKpi,
  SiteTable,
  TABLE_CELL,
  TABLE_FOOT,
  TABLE_HEAD,
  WIDE_ONLY,
} from "./site-dashboard-ui";

export function SitePagesTab({ data }: { data: SiteDashboardData }) {
  const { summary, detailed, insights } = data;
  const pages = insights?.pages ?? [];
  const leadPages = insights?.leadPages ?? [];
  const searches = insights?.searchQueries.slice(0, 6) ?? [];
  const durationCoverage = percentOf(summary.measuredSessions, summary.uniqueSessions);

  return (
    <div className="space-y-3">
      <KpiRow>
        <SiteKpi
          id="paginas-vistas"
          label="Páginas vistas"
          value={formatCount(summary.totalPages)}
          note={`${formatDecimal(detailed.pagesPerSession)} por sessão`}
          delta={percentDelta(summary.totalPages, summary.prevPages)}
        />
        <SiteKpi
          id="tempo-medio"
          label="Tempo médio"
          value={summary.measuredSessions > 0 ? formatDuration(summary.avgDuration) : "—"}
          note={durationCoverage === null ? "Sem medição" : `${formatPercent(durationCoverage, 0)} com duração medida`}
          delta={summary.measuredSessions > 0 ? secondsDelta(summary.avgDuration, summary.prevAvgDuration) : null}
        />
        <SiteKpi
          id="rejeicao"
          label="Rejeição"
          value={formatPercent(detailed.bounceRate)}
          note="Saíram na 1ª página"
          delta={insights?.previous.sessions ? pointsDelta(detailed.bounceRate, insights.previous.bounce_rate, true) : null}
        />
        <SiteKpi
          id="buscas"
          label="Buscas no site"
          value={formatCount(insights?.current.searches)}
          note={insights ? `Em ${formatPercent(percentOf(insights.current.search_sessions, insights.current.sessions), 0)} das sessões` : undefined}
          delta={percentDelta(insights?.current.searches, insights?.previous.searches)}
        />
      </KpiRow>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Panel title="Páginas que mais trazem lead" aside="Pela página de entrada">
          {leadPages.length > 0 ? (
            <div className="space-y-2.5">
              {leadPages.map((page, index) => (
                <BarRow
                  key={page.page_path}
                  label={pageLabel(page.page_path, page.title)}
                  title={publicPath(page.page_path)}
                  value={formatCount(page.leads)}
                  percent={percentOf(page.leads, leadPages[0]?.leads) ?? 0}
                  highlight={index === 0}
                />
              ))}
            </div>
          ) : (
            <EmptyNote>Nenhum lead do site no período.</EmptyNote>
          )}
        </Panel>
        <Panel title="O que buscam no site" aside="Termos e filtros usados">
          {searches.length > 0 ? (
            <div className="space-y-2.5">
              {searches.map((item, index) => (
                <BarRow
                  key={item.term}
                  label={item.term}
                  value={formatCount(item.searches)}
                  percent={percentOf(item.searches, searches[0]?.searches) ?? 0}
                  highlight={index === 0}
                />
              ))}
            </div>
          ) : (
            <EmptyNote>Nenhuma busca com filtros no período.</EmptyNote>
          )}
        </Panel>
      </div>

      <Panel title="Páginas do site" aside={pages.length >= 20 ? "As 20 mais vistas. O total inclui as demais." : undefined}>
        {pages.length > 0 ? (
          <>
            <SiteTable>
              <thead>
                <tr>
                  <th className={TABLE_HEAD}>Página</th>
                  <th className={TABLE_HEAD}>Visualizações</th>
                  <th className={cn(TABLE_HEAD, WIDE_ONLY)}>Sessões</th>
                  <th className={cn(TABLE_HEAD, WIDE_ONLY)}>Tempo médio</th>
                  <th className={cn(TABLE_HEAD, WIDE_ONLY)}>Rejeição</th>
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
                    <td className={cn(TABLE_CELL, WIDE_ONLY)}>{formatPercent(page.bounce_rate)}</td>
                    <td className={TABLE_CELL}>{formatCount(page.leads)}</td>
                    <td className={cn(TABLE_CELL, WIDE_ONLY)}>{formatPercent(page.conversion_rate)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className={TABLE_FOOT}>Total</td>
                  <td className={TABLE_FOOT}>{formatCount(summary.totalPages)}</td>
                  <td className={cn(TABLE_FOOT, WIDE_ONLY)}>{formatCount(summary.uniqueSessions)}</td>
                  <td className={cn(TABLE_FOOT, WIDE_ONLY)}>{summary.measuredSessions > 0 ? formatDuration(summary.avgDuration) : "—"}</td>
                  <td className={cn(TABLE_FOOT, WIDE_ONLY)}>{formatPercent(detailed.bounceRate)}</td>
                  <td className={TABLE_FOOT}>{formatCount(insights?.current.leads)}</td>
                  <td className={cn(TABLE_FOOT, WIDE_ONLY)}>{formatPercent(detailed.conversionRate, 2)}</td>
                </tr>
              </tfoot>
            </SiteTable>
            <InfoNote>
              Rejeição e conversão usam as sessões que entraram pela página. Cada lead conta na página de entrada
              registrada no formulário. Um traço indica que não houve medição.
            </InfoNote>
          </>
        ) : (
          <EmptyNote>Nenhuma página vista no período.</EmptyNote>
        )}
      </Panel>
    </div>
  );
}
