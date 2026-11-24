import { useMemo } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { creativeMedia } from "./MarketingCreativeSpotlight";
import { formatCompact, formatCount, formatPercent, niceAxisMax, percentOf } from "./marketing-format";
import { allCreatives, formatLabel, mediaById, metricOf, type MarketingModel } from "./marketing-model";
import type { MarketingTabHrefs } from "./marketing-tabs";
import { CreativeImage, EmptyNote, INK, KpiCard, KpiRow, NEUTRAL_SOFT, NEUTRAL_STRONG, Panel, ProgressRow, SegmentedBar } from "./marketing-ui";

const CHART_HEIGHT = 220;

function dayLabel(value: string) {
  const [, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}`;
}

function AudiencePanel({ title, values, note, limit }: { title: string; values: Array<{ label: string; value: number }>; note?: string; limit?: number }) {
  if (values.length === 0) return null;
  const ranked = [...values].sort((a, b) => b.value - a.value).slice(0, limit);
  return (
    <Panel title={title} aside={note}>
      <div className="space-y-2">
        {ranked.map(({ label, value }) => (
          <ProgressRow key={label} label={label} value={formatCount(value)} percent={percentOf(value, ranked[0].value) ?? 0} highlight />
        ))}
      </div>
    </Panel>
  );
}

export function MarketingSocialTab({ model, tabHrefs }: { model: MarketingModel; tabHrefs: MarketingTabHrefs }) {
  const data = model.insightsQuery.data!;
  const social = data.social;
  const assets = useMemo(() => mediaById(data.media), [data.media]);
  const posts = useMemo(
    () =>
      allCreatives(model)
        .filter((creative) => creative.source_kind === "organic")
        .map((creative) => ({ creative, reach: metricOf(assets.get(creative.id), "reach") }))
        .filter((post): post is typeof post & { reach: number } => post.reach !== null)
        .sort((a, b) => b.reach - a.reach),
    [model, assets],
  );
  const days = data.socialDaily;
  const observedDays = days.filter((day) => day.reach !== null).length;
  const interactionDays = days.filter((day) => day.interactions !== null).length;
  const peak = Math.max(...days.map((day) => day.reach ?? 0), 0);
  const axisMax = niceAxisMax(peak);
  const labelStep = days.length > 16 ? 3 : 1;
  const phoneLabelStep = days.length > 7 ? Math.ceil(days.length / 5) : 1;
  const formats = useMemo(() => {
    const totals = new Map<string, number>();
    posts.forEach(({ creative, reach }) => {
      const key = formatLabel(creative.media_type);
      totals.set(key, (totals.get(key) ?? 0) + reach);
    });
    return Array.from(totals, ([label, reach]) => ({ label, reach })).sort((a, b) => b.reach - a.reach);
  }, [posts]);
  const topFormat = formats[0]?.reach ?? 0;
  const interactionParts = [
    { key: "Curtidas", value: social.likes, className: "bg-primary" },
    { key: "Salvos", value: social.saves, className: INK },
    { key: "Compartilhamentos", value: social.shares, className: "bg-primary/60" },
    { key: "Comentários", value: social.comments, className: NEUTRAL_STRONG },
  ].filter((part): part is typeof part & { value: number } => part.value !== null);
  const profile = social.profileName ?? "Instagram";
  const profileLabel = social.profileName && social.profileCount === 1 ? `@${social.profileName.replace("@", "")}` : profile;
  const audience = social.audience;
  const selectedDays = (Date.parse(model.dateRange.to ?? "") - Date.parse(model.dateRange.from ?? "")) / 86_400_000 + 1;

  return (
    <div className="space-y-3">
      <section className="flex items-center gap-3 rounded-[12px] bg-[var(--app-surface-solid)] p-3.5">
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-normal uppercase text-white">
          {profile.replace("@", "").slice(0, 2)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-normal text-[var(--app-text-primary)]">{profileLabel}</p>
          <p className="truncate text-[12px] font-light text-[var(--app-text-secondary)]">
            Instagram profissional{social.posts !== null ? ` · ${formatCount(social.posts)} publicações no período` : ""}
          </p>
        </div>
      </section>
      <KpiRow>
        <KpiCard label="Seguidores" value={formatCount(social.followers)} note={social.followerGrowth !== null ? `${social.followerGrowth >= 0 ? "+" : ""}${formatCount(social.followerGrowth)} no período` : undefined} />
        <KpiCard label="Alcance acumulado" value={formatCompact(social.reach)} note="Soma do alcance de cada dia" />
        {social.profileViews !== null ? (
          <KpiCard label="Visitas ao perfil" value={formatCount(social.profileViews)} note={social.websiteClicks !== null ? `${formatCount(social.websiteClicks)} cliques no site` : undefined} />
        ) : <KpiCard label="Visualizações" value={formatCount(social.videoViews)} />}
        <KpiCard label="Interações" value={formatCount(social.interactions)} note={interactionDays > 0 && interactionDays < selectedDays ? `Dados em ${interactionDays} de ${selectedDays} dias` : undefined} />
      </KpiRow>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Alcance por dia" aside={observedDays > 0 && observedDays < selectedDays ? `Dados em ${observedDays} de ${selectedDays} dias` : undefined}>
          {observedDays === 0 ? (
            <EmptyNote>O Instagram ainda não retornou dados de alcance para esse período.</EmptyNote>
          ) : (
            <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-1.5">
              <div className="relative text-[11px] font-light tabular-nums text-[var(--app-text-tertiary)]" style={{ height: CHART_HEIGHT }} aria-hidden="true">
                {[4, 3, 2, 1, 0].map((step, index) => (
                  <span key={step} className="absolute right-0 -translate-y-1/2" style={{ top: `${(index / 4) * 100}%` }}>
                    {formatCompact((axisMax / 4) * step)}
                  </span>
                ))}
              </div>
              <div>
                <div className="flex items-end gap-[3px] border-b border-[var(--app-border)]" style={{ height: CHART_HEIGHT }} role="img" aria-label={`Alcance por dia, pico de ${formatCount(peak)} contas`}>
                  {days.map((day, index) => (
                    <div key={day.date} className="group relative flex h-full min-w-0 flex-1 items-end rounded-t-[4px] hover:bg-[var(--app-surface-hover)]" title={`${dayLabel(day.date)} · ${day.reach === null ? "Sem dados" : `${formatCount(day.reach)} contas alcançadas`}`}>
                      {day.reach !== null ? (
                        <span className={cn("min-h-px w-full", day.reach === peak ? "bg-primary" : NEUTRAL_SOFT)} style={{ height: `${(day.reach / axisMax) * 100}%` }} />
                      ) : null}
                      <div className={cn("pointer-events-none absolute top-1.5 z-20 hidden w-36 rounded-[8px] bg-[var(--app-surface-solid)] p-2.5 text-[11px] font-light shadow-lg group-hover:block", index > days.length / 2 ? "right-full mr-1" : "left-full ml-1")}>
                        <p className="mb-1 font-normal text-[var(--app-text-primary)]">{dayLabel(day.date)}</p>
                        <p className="flex justify-between text-[var(--app-text-secondary)]">Alcance <span className="tabular-nums text-[var(--app-text-primary)]">{formatCount(day.reach)}</span></p>
                        <p className="flex justify-between text-[var(--app-text-secondary)]">Interações <span className="tabular-nums text-[var(--app-text-primary)]">{formatCount(day.interactions)}</span></p>
                        <p className="flex justify-between text-[var(--app-text-secondary)]">Publicações <span className="tabular-nums text-[var(--app-text-primary)]">{formatCount(day.posts)}</span></p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex gap-[3px] text-[10px] font-light tabular-nums text-[var(--app-text-tertiary)]" aria-hidden="true">
                  {days.map((day, index) => (
                    <span key={day.date} className="min-w-0 flex-1 whitespace-nowrap">
                      <span className={cn(index % phoneLabelStep === 0 ? "" : "hidden sm:inline", index % labelStep === 0 ? "" : "sm:hidden")}>{dayLabel(day.date)}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Panel>
        <Panel title="Interações por tipo">
          {interactionParts.length === 0 ? <EmptyNote>O Instagram ainda não retornou interações para esse período.</EmptyNote> : null}
          {interactionParts.length > 0 ? <SegmentedBar items={interactionParts} /> : null}
          <div className="grid grid-cols-2 gap-3 empty:hidden not-empty:mt-3">
            {interactionParts.map((part) => (
              <div key={part.key}>
                <p className="flex items-center gap-1.5 text-[12px] font-light text-[var(--app-text-secondary)]">
                  <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-[2px]", part.className)} />
                  {part.key}
                </p>
                <p className="text-[16px] font-normal tabular-nums text-[var(--app-text-primary)]">{formatCount(part.value)}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-[var(--app-border)] pt-3">
            <h3 className="mb-2 text-[14px] font-normal text-[var(--app-text-primary)]">Alcance das publicações por formato</h3>
            {formats.length === 0 ? <EmptyNote>Sem dados de alcance das publicações no período.</EmptyNote> : null}
            <div className="space-y-2">
              {formats.map((format) => (
                <ProgressRow key={format.label} label={format.label} highlight percent={percentOf(format.reach, topFormat) ?? 0} value={formatCompact(format.reach)} />
              ))}
            </div>
          </div>
        </Panel>
      </div>
      <Panel title="Publicações com mais alcance" aside={<Link href={tabHrefs.media} scroll={false} className="hover:text-[var(--app-text-primary)]">Ver em Mídia</Link>}>
        {posts.length === 0 ? (
          <EmptyNote>Sem dados de alcance das publicações orgânicas no período.</EmptyNote>
        ) : (
          <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
            {posts.slice(0, 5).map(({ creative, reach }, index) => {
              const asset = assets.get(creative.id);
              return (
                <li key={creative.id} className={cn("min-w-0 overflow-hidden rounded-[8px]", NEUTRAL_SOFT)}>
                  <span className="relative flex h-36 items-center justify-center overflow-hidden">
                    <span className="absolute inset-x-2 top-2 z-10 flex justify-between text-[10px] font-light text-[#151515]">
                      <span className="rounded-[4px] bg-white px-1.5 py-0.5">{index + 1}º lugar</span>
                      <span className="rounded-[4px] bg-white px-1.5 py-0.5">{formatLabel(creative.media_type)}</span>
                    </span>
                    <CreativeImage media={creativeMedia(creative)} className="h-full w-full justify-center" />
                  </span>
                  <div className="p-3">
                    <p className="truncate text-[12px] font-medium text-[var(--app-text-primary)]">{creative.ad_name}</p>
                    <p className="mt-1 flex justify-between gap-2 text-[12px] font-light tabular-nums text-[var(--app-text-secondary)]">
                      <span>{formatCompact(reach)} de alcance</span>
                      <span>{formatPercent(percentOf(metricOf(asset, "interactions"), reach))}</span>
                    </p>
                    <p className="mt-1 truncate text-[10px] font-light text-[var(--app-text-tertiary)]">
                      {formatCount(metricOf(asset, "likes"))} curt. · {formatCount(metricOf(asset, "comments"))} coment. · {formatCount(metricOf(asset, "saves"))} salv. · {formatCount(metricOf(asset, "shares"))} compart.
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {audience ? (
        <section className="space-y-2" aria-label="Audiência recente do Instagram">
          <p className="text-xs text-[var(--app-text-secondary)]">Audiência recente do Instagram · atualizada em {dayLabel(audience.fetchedAt)}</p>
          <div className="grid gap-3 md:grid-cols-3">
            <AudiencePanel title="Idade dos seguidores" values={audience.age} />
            <AudiencePanel title="Principais cidades dos seguidores" values={audience.city} limit={5} />
            <AudiencePanel title="Horários com mais seguidores online" values={audience.online} note="Média por hora · horário da Meta" limit={5} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
