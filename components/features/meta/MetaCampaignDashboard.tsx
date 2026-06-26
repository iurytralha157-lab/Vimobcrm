"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  Banknote,
  ChevronRight,
  ExternalLink,
  MousePointerClick,
  Percent,
  Target,
  Trophy,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  flattenMetaCreatives,
  getMetaCreativeDestination,
  getEmptyMetaCampaignSnapshot,
  type MetaCampaignKind,
  type MetaCampaignPerformance,
  type MetaCampaignSnapshot,
  type MetaCreativeAsset,
  type MetaDeliveryStatus,
} from "@/lib/api/meta";
import {
  useCampaignInsights,
  type CampaignAggregated,
} from "@/hooks/use-campaign-insights";
import type { SharedFilters } from "@/hooks/use-shared-filters";
import { MetaCreativePreview } from "./MetaCreativePreview";

interface MetaCampaignDashboardProps {
  filters: SharedFilters;
}

type RealCampaign = CampaignAggregated & {
  ctr?: number | null;
  hook_rate?: number | null;
};

const statusLabel: Record<MetaDeliveryStatus, string> = {
  ACTIVE: "Ativa",
  PAUSED: "Pausada",
  ARCHIVED: "Arquivada",
  LEARNING: "Aprendizado",
};

const kindLabel: Record<MetaCampaignKind, string> = {
  lead_form: "Lead Ads",
  whatsapp: "WhatsApp",
  site: "Site",
};

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(value || 0);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function normalizeStatus(status?: string | null): MetaDeliveryStatus {
  const upper = String(status || "ACTIVE").toUpperCase();
  if (upper === "PAUSED" || upper === "ARCHIVED" || upper === "LEARNING") return upper;
  return "ACTIVE";
}

function inferKind(objective?: string | null): MetaCampaignKind {
  const normalized = String(objective || "").toLowerCase();
  if (normalized.includes("whatsapp") || normalized.includes("message")) return "whatsapp";
  if (normalized.includes("traffic") || normalized.includes("site")) return "site";
  return "lead_form";
}

function buildSnapshotFromDatabase(data: NonNullable<ReturnType<typeof useCampaignInsights>["data"]>): MetaCampaignSnapshot {
  const campaigns: MetaCampaignPerformance[] = data.campaigns.map((campaign) => {
    const realCampaign = campaign as RealCampaign;
    return {
      id: campaign.campaign_id,
      name: campaign.campaign_name,
      kind: inferKind(campaign.objective),
      status: normalizeStatus(campaign.status),
      objective: campaign.objective || "Lead Ads",
      startedAt: "",
      endedAt: null,
      spend: campaign.spend || 0,
      previousMonthSpend: 0,
      impressions: campaign.impressions || 0,
      reach: campaign.reach || 0,
      clicks: 0,
      leads: campaign.leads_count,
      sales: campaign.won_count,
      revenue: campaign.revenue,
      ctr: realCampaign.ctr || 0,
      cpl: campaign.cpl || 0,
      hookRate: realCampaign.hook_rate || 0,
      adSets: campaign.adsets.map((adSet) => ({
        id: adSet.adset_id,
        name: adSet.adset_name,
        status: "ACTIVE",
        spend: adSet.spend || 0,
        impressions: adSet.impressions || 0,
        reach: adSet.reach || 0,
        clicks: 0,
        leads: adSet.leads_count,
        sales: adSet.won_count,
        revenue: adSet.revenue,
        ctr: (adSet as typeof adSet & { ctr?: number | null }).ctr || 0,
        cpl: adSet.cpl || 0,
        hookRate: (adSet as typeof adSet & { hook_rate?: number | null }).hook_rate || 0,
        creatives: adSet.ads.map((ad) => ({
          id: ad.ad_id,
          name: ad.ad_name,
          type: ad.creative_video_url ? "video" : "image",
          thumbnailUrl: ad.creative_url,
          creativeUrl: ad.creative_url,
          videoUrl: ad.creative_video_url,
          permalinkUrl: (ad as typeof ad & { creative_permalink_url?: string | null }).creative_permalink_url || null,
          hookRate: (ad as typeof ad & { hook_rate?: number | null }).hook_rate || 0,
          ctr: (ad as typeof ad & { ctr?: number | null }).ctr || 0,
          spend: ad.spend || 0,
          leads: ad.leads_count,
          sales: ad.won_count,
          cpl: ad.cpl || 0,
        })),
      })),
    };
  });

  return {
    source: "database",
    generatedAt: data.lastSync || null,
    previousMonthSpend: 0,
    campaigns,
    daily: data.dailyData.map((item) => ({
      date: item.date,
      leads: item.leads,
      spend: 0,
      cpl: 0,
    })),
  };
}

function MetricBlock({
  icon: Icon,
  label,
  value,
  subValue,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  subValue?: string;
  tone?: "default" | "success" | "warning";
}) {
  return (
    <div className="app-card-soft flex min-h-[86px] items-center gap-3 p-3">
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
          tone === "success" && "bg-emerald-500/12 text-emerald-500",
          tone === "warning" && "bg-amber-500/12 text-amber-500",
          tone === "default" && "bg-primary/10 text-primary",
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase text-muted-foreground">{label}</p>
        <p className="truncate text-lg font-semibold">{value}</p>
        {subValue && <p className="truncate text-xs text-muted-foreground">{subValue}</p>}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[180px] items-center justify-center rounded-md border border-dashed border-white/[0.08] bg-white/[0.018] px-4 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function CampaignStatusBadge({ status }: { status: MetaDeliveryStatus }) {
  return (
    <Badge
      variant={status === "ACTIVE" || status === "LEARNING" ? "default" : "secondary"}
      className="whitespace-nowrap"
    >
      {statusLabel[status]}
    </Badge>
  );
}

function CreativeRow({ creative, maxLeads }: { creative: MetaCreativeAsset; maxLeads: number }) {
  const destination = getMetaCreativeDestination(creative);
  const leadShare = maxLeads > 0 ? (creative.leads / maxLeads) * 100 : 0;

  return (
    <div className="grid min-w-[860px] grid-cols-[minmax(260px,1fr)_90px_90px_90px_90px_90px_82px] items-center gap-3 border-t border-white/[0.045] px-3 py-2.5 text-xs">
      <div className="flex min-w-0 items-center gap-3 pl-8">
        <MetaCreativePreview creative={creative} size="sm" />
        <div className="min-w-0">
          <p className="truncate font-medium">{creative.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">ID {creative.id}</p>
        </div>
      </div>
      <span className="text-right">{formatCurrency(creative.spend)}</span>
      <span className="text-right font-medium">{formatNumber(creative.leads)}</span>
      <span className="text-right">{formatCurrency(creative.cpl)}</span>
      <span className="text-right">{formatPercent(creative.ctr)}</span>
      <span className="text-right">{formatPercent(creative.hookRate)}</span>
      {destination ? (
        <Button asChild variant="ghost" size="icon" className="ml-auto h-8 w-8">
          <a href={destination} target="_blank" rel="noreferrer" aria-label={`Abrir ${creative.name}`}>
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      ) : (
        <span className="ml-auto h-8 w-8" />
      )}
      <div className="col-span-7 pl-8 pr-2">
        <Progress value={leadShare} className="h-1.5 bg-white/[0.045]" />
      </div>
    </div>
  );
}

function AdSetRow({ adSet }: { adSet: MetaCampaignPerformance["adSets"][number] }) {
  const maxLeads = Math.max(...adSet.creatives.map((creative) => creative.leads), 1);

  return (
    <div className="border-t border-white/[0.045]">
      <div className="grid min-w-[860px] grid-cols-[minmax(260px,1fr)_90px_90px_90px_90px_90px_82px] items-center gap-3 px-3 py-2.5 text-xs">
        <div className="flex min-w-0 items-center gap-2 pl-4">
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate font-medium text-muted-foreground">{adSet.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">Conjunto {adSet.id}</p>
          </div>
        </div>
        <span className="text-right">{formatCurrency(adSet.spend)}</span>
        <span className="text-right font-medium">{formatNumber(adSet.leads)}</span>
        <span className="text-right">{formatCurrency(adSet.cpl)}</span>
        <span className="text-right">{formatPercent(adSet.ctr)}</span>
        <span className="text-right">{formatPercent(adSet.hookRate)}</span>
        <span className="text-right font-medium text-emerald-500">{formatNumber(adSet.sales)}</span>
      </div>
      {adSet.creatives.map((creative) => (
        <CreativeRow key={creative.id} creative={creative} maxLeads={maxLeads} />
      ))}
    </div>
  );
}

function CampaignAccordion({ campaign }: { campaign: MetaCampaignPerformance }) {
  return (
    <AccordionItem value={campaign.id} className="border-white/[0.055]">
      <AccordionTrigger className="min-w-[860px] px-3 py-3 hover:no-underline">
        <div className="grid w-full grid-cols-[minmax(260px,1fr)_90px_90px_90px_90px_90px_82px] items-center gap-3 text-left text-sm">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-semibold">{campaign.name}</span>
              <CampaignStatusBadge status={campaign.status} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>{kindLabel[campaign.kind]}</span>
              <span>•</span>
              <span>{campaign.objective}</span>
              <span>•</span>
              <span>ID {campaign.id}</span>
            </div>
          </div>
          <span className="text-right font-medium">{formatCurrency(campaign.spend)}</span>
          <span className="text-right font-medium">{formatNumber(campaign.leads)}</span>
          <span className="text-right">{formatCurrency(campaign.cpl)}</span>
          <span className="text-right">{formatPercent(campaign.ctr)}</span>
          <span className="text-right">{formatPercent(campaign.hookRate)}</span>
          <span className="text-right font-semibold text-emerald-500">{formatNumber(campaign.sales)}</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-0">
        {campaign.adSets.map((adSet) => (
          <AdSetRow key={adSet.id} adSet={adSet} />
        ))}
      </AccordionContent>
    </AccordionItem>
  );
}

export function MetaCampaignDashboard({ filters }: MetaCampaignDashboardProps) {
  const { data, isLoading } = useCampaignInsights(filters);

  const snapshot = useMemo(() => {
    if (data?.campaigns?.length) return buildSnapshotFromDatabase(data);
    return getEmptyMetaCampaignSnapshot();
  }, [data]);

  const creatives = useMemo(() => flattenMetaCreatives(snapshot.campaigns), [snapshot.campaigns]);
  const bestCreative = creatives[0];
  const hasCampaigns = snapshot.campaigns.length > 0;
  const totals = useMemo(() => {
    const spend = snapshot.campaigns.reduce((sum, campaign) => sum + campaign.spend, 0);
    const leads = snapshot.campaigns.reduce((sum, campaign) => sum + campaign.leads, 0);
    const sales = snapshot.campaigns.reduce((sum, campaign) => sum + campaign.sales, 0);
    const revenue = snapshot.campaigns.reduce((sum, campaign) => sum + campaign.revenue, 0);
    const impressions = snapshot.campaigns.reduce((sum, campaign) => sum + campaign.impressions, 0);
    const weightedCtr = snapshot.campaigns.reduce((sum, campaign) => sum + campaign.ctr * campaign.impressions, 0);
    const weightedHook = snapshot.campaigns.reduce((sum, campaign) => sum + campaign.hookRate * campaign.impressions, 0);

    return {
      spend,
      leads,
      sales,
      revenue,
      activeCampaigns: snapshot.campaigns.filter((campaign) => campaign.status === "ACTIVE" || campaign.status === "LEARNING").length,
      previousSpend: snapshot.previousMonthSpend || snapshot.campaigns.reduce((sum, campaign) => sum + campaign.previousMonthSpend, 0),
      cpl: leads > 0 ? spend / leads : 0,
      ctr: impressions > 0 ? weightedCtr / impressions : 0,
      hookRate: impressions > 0 ? weightedHook / impressions : 0,
    };
  }, [snapshot]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={hasCampaigns ? "default" : "outline"}>
            {hasCampaigns ? "Dados sincronizados" : "Sem dados sincronizados"}
          </Badge>
          {snapshot.generatedAt && (
            <span className="text-xs text-muted-foreground">
              {new Intl.DateTimeFormat("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(snapshot.generatedAt))}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricBlock icon={BarChart3} label="Campanhas ativas" value={formatNumber(totals.activeCampaigns)} />
        <MetricBlock icon={Banknote} label="Investimento" value={formatCurrency(totals.spend)} subValue={`Mês anterior ${formatCurrency(totals.previousSpend)}`} />
        <MetricBlock icon={Users} label="Leads / CPL" value={formatNumber(totals.leads)} subValue={formatCurrency(totals.cpl)} />
        <MetricBlock icon={Trophy} label="Vendas atribuídas" value={formatNumber(totals.sales)} subValue={formatCurrency(totals.revenue)} tone="success" />
        <MetricBlock icon={MousePointerClick} label="CTR médio" value={formatPercent(totals.ctr)} />
        <MetricBlock icon={Zap} label="Hook rate" value={formatPercent(totals.hookRate)} />
        <MetricBlock icon={Target} label="Melhor criativo" value={bestCreative?.name || "--"} subValue={bestCreative ? `${bestCreative.leads} leads` : undefined} tone="warning" />
        <MetricBlock icon={Percent} label="Criativos rastreados" value={formatNumber(creatives.length)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <div className="app-card-soft p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Evolução do período</h3>
              <p className="text-xs text-muted-foreground">Leads e CPL diário</p>
            </div>
          </div>
          {snapshot.daily.length > 0 ? (
            <ChartContainer
              config={{
                leads: { label: "Leads", color: "hsl(var(--primary))" },
                cpl: { label: "CPL", color: "hsl(var(--chart-5))" },
              }}
              className="h-[260px] w-full aspect-auto"
            >
              <AreaChart data={snapshot.daily} margin={{ left: 0, right: 14, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                <ChartTooltip />
                <Area
                  type="monotone"
                  dataKey="leads"
                  stroke="var(--color-leads)"
                  fill="var(--color-leads)"
                  fillOpacity={0.18}
                />
                <Area
                  type="monotone"
                  dataKey="cpl"
                  stroke="var(--color-cpl)"
                  fill="var(--color-cpl)"
                  fillOpacity={0.12}
                />
              </AreaChart>
            </ChartContainer>
          ) : (
            <EmptyState message="Nenhum dado de campanha sincronizado no periodo." />
          )}
        </div>

        <div className="app-card-soft p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold">Top criativos</h3>
            <p className="text-xs text-muted-foreground">Score por lead, venda e CPL</p>
          </div>
          {creatives.length > 0 ? (
            <div className="space-y-3">
            {creatives.slice(0, 4).map((creative, index) => (
              <div key={creative.id} className="flex items-center gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.055] text-xs font-semibold">
                  {index + 1}
                </div>
                <MetaCreativePreview creative={creative} showAction={false} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{creative.name}</p>
                  <p className="text-xs text-muted-foreground">{creative.leads} leads · {formatCurrency(creative.cpl)}</p>
                </div>
                {getMetaCreativeDestination(creative) && (
                  <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                    <a href={getMetaCreativeDestination(creative) || "#"} target="_blank" rel="noreferrer" aria-label={`Abrir ${creative.name}`}>
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                )}
              </div>
            ))}
            </div>
          ) : (
            <EmptyState message="Nenhum criativo sincronizado ainda." />
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-white/[0.055] bg-white/[0.025]">
        <div className="grid min-w-[860px] grid-cols-[minmax(260px,1fr)_90px_90px_90px_90px_90px_82px] gap-3 bg-white/[0.035] px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>Campanha / conjunto / criativo</span>
          <span className="text-right">Gasto</span>
          <span className="text-right">Leads</span>
          <span className="text-right">CPL</span>
          <span className="text-right">CTR</span>
          <span className="text-right">Hook</span>
          <span className="text-right">Vendas</span>
        </div>
        {hasCampaigns ? (
          <Accordion type="multiple" defaultValue={snapshot.campaigns.slice(0, 1).map((campaign) => campaign.id)}>
            {snapshot.campaigns.map((campaign) => (
              <CampaignAccordion key={campaign.id} campaign={campaign} />
            ))}
          </Accordion>
        ) : (
          <div className="min-w-[860px] px-3 py-10 text-center text-sm text-muted-foreground">
            Nenhuma campanha sincronizada no periodo selecionado.
          </div>
        )}
      </div>
    </div>
  );
}
