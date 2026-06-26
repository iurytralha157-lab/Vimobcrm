import { useState } from "react";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  useCampaignInsights,
  useSyncCampaignInsights,
  type CampaignAggregated,
  type AdsetAggregated,
  type AdAggregated,
  type TopCreative,
} from "@/hooks/use-campaign-insights";
import type { DashboardFilters } from "@/hooks/use-dashboard-filters";
import {
  DollarSign,
  Target,
  Users,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Play,
  Image as ImageIcon,
  TrendingUp,
  BarChart3,
  Layers,
  MonitorPlay,
  Trophy,
  Eye,
  Radio,
  Banknote,
  type LucideIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  filters: DashboardFilters;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("pt-BR");
}

function KpiCard({ icon: Icon, label, value, iconColor }: { icon: LucideIcon; label: string; value: string; iconColor: string }) {
  return (
    <div className="app-card-soft flex items-center gap-3 p-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconColor}`}>
        <Icon className="h-4 w-4 text-primary-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className="text-sm font-semibold text-foreground truncate">{value}</p>
      </div>
    </div>
  );
}

function CreativePreview({ url, videoUrl, size = "sm" }: { url: string | null; videoUrl: string | null; size?: "sm" | "lg" }) {
  const dim = size === "lg" ? "h-16 w-16" : "h-10 w-10";
  const iconDim = size === "lg" ? "h-5 w-5" : "h-3 w-3";
  const playIcon = size === "lg" ? "h-4 w-4" : "h-3 w-3";

  if (videoUrl) {
    return (
      <div className={`relative ${dim} rounded-lg overflow-hidden bg-white/[0.045] shrink-0`}>
        <video src={videoUrl} className="h-full w-full object-cover" muted />
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <Play className={`${playIcon} text-white`} />
        </div>
      </div>
    );
  }
  if (url) {
    return (
      <div className={`relative ${dim} rounded-lg overflow-hidden bg-white/[0.045] shrink-0`}>
        <Image
          src={url}
          alt="Criativo"
          fill
          sizes={size === "lg" ? "64px" : "40px"}
          className="object-cover"
          unoptimized
        />
      </div>
    );
  }
  return (
    <div className={`${dim} rounded-lg bg-white/[0.045] flex items-center justify-center shrink-0`}>
      <ImageIcon className={`${iconDim} text-muted-foreground`} />
    </div>
  );
}

function AdRow({ ad, hasSpend }: { ad: AdAggregated; hasSpend: boolean }) {
  return (
    <div className="flex items-center gap-3 py-2 pl-12 pr-3 text-xs border-t border-white/[0.045]">
      <CreativePreview url={ad.creative_url} videoUrl={ad.creative_video_url} />
      <span className="flex-1 truncate text-muted-foreground">{ad.ad_name}</span>
      <span className="w-14 text-right font-medium">{ad.leads_count}</span>
      <span className="w-14 text-right font-medium text-emerald-600">{ad.won_count}</span>
      <span className="w-20 text-right">{ad.revenue > 0 ? formatCurrency(ad.revenue) : "—"}</span>
      {hasSpend && (
        <>
          <span className="w-20 text-right">{ad.spend != null ? formatCurrency(ad.spend) : "—"}</span>
          <span className="w-20 text-right">{ad.cpl != null && ad.cpl > 0 ? formatCurrency(ad.cpl) : "—"}</span>
        </>
      )}
    </div>
  );
}

function AdsetRow({ adset, hasSpend }: { adset: AdsetAggregated; hasSpend: boolean }) {
  const [open, setOpen] = useState(false);
  const hasAds = adset.ads.length > 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center gap-3 py-2 pl-8 pr-3 text-xs border-t border-white/[0.045] cursor-pointer hover:bg-white/[0.055] transition-colors">
          {hasAds ? (
            open ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <span className="flex-1 truncate text-muted-foreground">{adset.adset_name}</span>
          <span className="w-14 text-right font-medium">{adset.leads_count}</span>
          <span className="w-14 text-right font-medium text-emerald-600">{adset.won_count}</span>
          <span className="w-20 text-right">{adset.revenue > 0 ? formatCurrency(adset.revenue) : "—"}</span>
          {hasSpend && (
            <>
              <span className="w-20 text-right">{adset.spend != null ? formatCurrency(adset.spend) : "—"}</span>
              <span className="w-20 text-right">{adset.cpl != null && adset.cpl > 0 ? formatCurrency(adset.cpl) : "—"}</span>
            </>
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {adset.ads.map((ad) => (
          <AdRow key={ad.ad_id} ad={ad} hasSpend={hasSpend} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function CampaignRow({ campaign, hasSpend }: { campaign: CampaignAggregated; hasSpend: boolean }) {
  const [open, setOpen] = useState(false);
  const hasAdsets = campaign.adsets.length > 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex cursor-pointer items-center gap-3 border-t border-white/[0.045] px-3 py-3 text-sm transition-colors hover:bg-white/[0.055]">
          {hasAdsets ? (
            open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <span className="flex-1 truncate font-medium text-foreground">{campaign.campaign_name}</span>
          <span className="w-14 text-right font-semibold text-foreground">{campaign.leads_count}</span>
          <span className="w-14 text-right font-semibold text-emerald-600">{campaign.won_count}</span>
          <span className="w-20 text-right text-foreground">{campaign.revenue > 0 ? formatCurrency(campaign.revenue) : "—"}</span>
          {hasSpend && (
            <>
              <span className="w-20 text-right text-foreground">{campaign.spend != null ? formatCurrency(campaign.spend) : "—"}</span>
              <span className="w-20 text-right text-foreground">{campaign.cpl != null && campaign.cpl > 0 ? formatCurrency(campaign.cpl) : "—"}</span>
            </>
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {campaign.adsets.map((adset) => (
          <AdsetRow key={adset.adset_id} adset={adset} hasSpend={hasSpend} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

const MEDAL_COLORS = [
  "bg-amber-400 text-amber-950",
  "bg-slate-300 text-slate-800",
  "bg-amber-600 text-amber-50",
];

function CreativeRankingRow({ creative, index, maxScore }: { creative: TopCreative; index: number; maxScore: number }) {
  const position = index + 1;
  const pct = maxScore > 0 ? (creative.score / maxScore) * 100 : 0;

  return (
    <div className="flex items-center gap-3 py-3 px-3 border-t border-white/[0.055]">
      {/* Position */}
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        index < 3 ? MEDAL_COLORS[index] : "bg-white/[0.06] text-muted-foreground"
      }`}>
        {position}
      </div>

      {/* Creative thumbnail */}
      <CreativePreview url={creative.creative_url} videoUrl={creative.creative_video_url} size="lg" />

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-sm font-medium text-foreground truncate">{creative.ad_name}</p>
        <p className="text-xs text-muted-foreground truncate">{creative.campaign_name}</p>
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <span className="text-muted-foreground">
            <Users className="h-3 w-3 inline mr-1" />{creative.leads_count} leads
          </span>
          {creative.won_count > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
              <Trophy className="h-3 w-3 inline mr-1" />{creative.won_count} {creative.won_count === 1 ? "venda" : "vendas"}
            </span>
          )}
          {creative.revenue > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400">
              {formatCurrency(creative.revenue)}
            </span>
          )}
          {creative.spend != null && (
            <span className="text-muted-foreground">{formatCurrency(creative.spend)}</span>
          )}
        </div>
        <Progress value={pct} className="h-1.5" />
      </div>

      {/* Score */}
      <div className="text-right shrink-0">
        <p className="text-lg font-bold text-foreground">{creative.score}</p>
        <p className="text-[10px] text-muted-foreground">pts</p>
      </div>
    </div>
  );
}

export function CampaignPerformanceWidget({ filters }: Props) {
  const { data, isLoading } = useCampaignInsights(filters);
  const syncMutation = useSyncCampaignInsights();

  const handleSync = () => {
    const dateStart = filters.dateRange.from.toISOString().split("T")[0];
    const dateStop = filters.dateRange.to.toISOString().split("T")[0];
    syncMutation.mutate({ dateStart, dateStop });
  };

  if (isLoading) {
    return (
      <Card className="app-card">
        <CardHeader>
          <CardTitle className="text-base">Performance de Campanhas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
          <Skeleton className="h-32" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.campaigns.length === 0) {
    return null;
  }

  const { summary, campaigns, hasSpendData, topCreatives } = data;
  const maxScore = topCreatives.length > 0 ? topCreatives[0].score : 0;

  return (
    <Card className="app-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Performance de Campanhas</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          {data.lastSync && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Sincronizado {formatDistanceToNow(new Date(data.lastSync), { addSuffix: true, locale: ptBR })}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncMutation.isPending}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Sincronizar Meta Ads</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard icon={Users} label="Leads" value={formatNumber(summary.totalLeads)} iconColor="bg-primary" />
          <KpiCard icon={Trophy} label="Vendas" value={String(summary.totalWon)} iconColor="bg-emerald-600" />
          {summary.totalRevenue > 0 && (
            <KpiCard icon={Banknote} label="Receita" value={formatCurrency(summary.totalRevenue)} iconColor="bg-emerald-700" />
          )}
          {hasSpendData && summary.totalSpend != null && (
            <KpiCard icon={DollarSign} label="Investimento" value={formatCurrency(summary.totalSpend)} iconColor="bg-chart-5" />
          )}
          {hasSpendData && summary.avgCpl != null && (
            <KpiCard icon={Target} label="CPL Médio" value={formatCurrency(summary.avgCpl)} iconColor="bg-destructive" />
          )}
          {hasSpendData && summary.totalImpressions != null && summary.totalImpressions > 0 && (
            <KpiCard icon={Eye} label="Impressões" value={formatNumber(summary.totalImpressions)} iconColor="bg-chart-2" />
          )}
          {hasSpendData && summary.totalReach != null && summary.totalReach > 0 && (
            <KpiCard icon={Radio} label="Alcance" value={formatNumber(summary.totalReach)} iconColor="bg-chart-3" />
          )}
          <KpiCard icon={BarChart3} label="Campanhas" value={String(summary.totalCampaigns)} iconColor="bg-chart-4" />
          <KpiCard icon={Layers} label="Conjuntos" value={String(summary.totalAdsets)} iconColor="bg-muted-foreground" />
          <KpiCard icon={MonitorPlay} label="Anúncios" value={String(summary.totalAds)} iconColor="bg-muted-foreground" />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="campaigns">
          <TabsList>
            <TabsTrigger value="campaigns">Campanhas</TabsTrigger>
            <TabsTrigger value="creatives">Criativos</TabsTrigger>
          </TabsList>

          <TabsContent value="campaigns">
            <div className="overflow-hidden overflow-x-auto rounded-lg border border-white/[0.045]">
              <div className="flex min-w-[500px] items-center gap-3 bg-white/[0.035] px-3 py-2 text-xs font-medium text-muted-foreground">
                <span className="w-4 shrink-0" />
                <span className="flex-1">Campanha</span>
                <span className="w-14 text-right">Leads</span>
                <span className="w-14 text-right">Vendas</span>
                <span className="w-20 text-right">Receita</span>
                {hasSpendData && (
                  <>
                    <span className="w-20 text-right">Gasto</span>
                    <span className="w-20 text-right">CPL</span>
                  </>
                )}
              </div>
              {campaigns.map((campaign) => (
                <CampaignRow key={campaign.campaign_id} campaign={campaign} hasSpend={hasSpendData} />
              ))}
            </div>

            {!hasSpendData && (
              <p className="text-xs text-muted-foreground text-center mt-3">
                Clique em &quot;Sincronizar Meta Ads&quot; para adicionar dados de investimento e CPL.
              </p>
            )}
          </TabsContent>

          <TabsContent value="creatives">
            {topCreatives.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                Nenhum criativo encontrado no período selecionado.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-white/[0.045]">
                <div className="flex items-center gap-3 bg-white/[0.035] px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span className="w-7 shrink-0 text-center">#</span>
                  <span className="w-16 shrink-0" />
                  <span className="flex-1">Criativo</span>
                  <span className="w-12 text-right">Score</span>
                </div>
                {topCreatives.map((creative, i) => (
                  <CreativeRankingRow key={creative.ad_id} creative={creative} index={i} maxScore={maxScore} />
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground text-center mt-3">
              Pontuação: 1 pt por lead + 10 pts por venda
            </p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
