import Link from "next/link";
import {
  Activity,
  AtSign,
  BadgeDollarSign,
  Banknote,
  BarChart3,
  BrainCircuit,
  CircleDollarSign,
  Eye,
  Gauge,
  ImageIcon,
  Layers3,
  Megaphone,
  MessageCircleMore,
  MessagesSquare,
  MousePointerClick,
  Percent,
  Radio,
  SearchCheck,
  Send,
  Share2,
  Sparkles,
  Target,
  ThumbsUp,
  TrendingUp,
  Trophy,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { useMarketingDashboard } from "@/hooks/marketing";

import { MarketingDataState } from "./MarketingDataState";
import { MarketingFunnel } from "./MarketingFunnel";
import { MarketingMediaGallery } from "./MarketingMediaGallery";
import { MarketingMetricCard } from "./MarketingMetricCard";
import { MarketingPaidTable } from "./MarketingPaidTable";
import { MarketingSectionCard } from "./MarketingSectionCard";
import { MarketingTrendChart } from "./MarketingTrendChart";
import type { MarketingTab, MarketingTabHrefs } from "./marketing-tabs";

type MarketingModel = ReturnType<typeof useMarketingDashboard>;

interface MarketingTabViewsProps {
  activeTab: MarketingTab;
  model: MarketingModel;
  tabHrefs: MarketingTabHrefs;
}

const INTEGRATION_HREF = "/settings/integrations/meta";

function formatCurrency(
  value: number | null | undefined,
  currency: string | null | undefined,
) {
  if (value === null || value === undefined || !currency) return null;
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("pt-BR", {
      maximumFractionDigits: 2,
    })}`;
  }
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  return new Intl.NumberFormat("pt-BR", {
    notation: value >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function formatRatio(value: number | null) {
  if (value === null) return null;
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x`;
}

function SettingsLink({ label = "Configurar integração" }: { label?: string }) {
  return (
    <Button
      asChild
      className="h-9 rounded-[6px] border-0 bg-primary/50 px-4 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
    >
      <Link href={INTEGRATION_HREF}>{label}</Link>
    </Button>
  );
}

function CapabilityRow({
  icon: Icon,
  title,
  description,
  available = false,
}: {
  icon: typeof Activity;
  title: string;
  description: string;
  available?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-3">
      <span
        aria-hidden="true"
        className={
          available
            ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-emerald-500/12 text-emerald-500"
            : "flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-hover)] text-[var(--app-text-tertiary)]"
        }
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-[var(--app-text-primary)]">{title}</p>
        <p className="mt-1 text-[11px] leading-4 text-[var(--app-text-tertiary)]">
          {description}
        </p>
      </div>
    </div>
  );
}

function OverviewView({
  model,
  tabHrefs,
}: {
  model: MarketingModel;
  tabHrefs: MarketingTabHrefs;
}) {
  const data = model.insightsQuery.data!;
  const { summary } = data;
  const hasSpend = data.hasSpendData && summary.totalSpend !== null;
  const hasCRMAttribution = data.dataQuality.hasCRMAttribution;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MarketingMetricCard
          icon={Banknote}
          label="Investimento"
          value={hasSpend ? formatCurrency(summary.totalSpend, summary.currency) : null}
          supportingText="Meta Ads no período selecionado"
        />
        <MarketingMetricCard
          icon={UsersRound}
          label="Leads"
          value={hasCRMAttribution ? formatNumber(summary.totalLeads) : null}
          supportingText="Atribuídos às campanhas"
          unavailableText="Aguardando atribuição do CRM"
        />
        <MarketingMetricCard
          icon={Target}
          label="CPL Meta"
          value={
            hasSpend
              ? formatCurrency(summary.reportedCpl, summary.currency)
              : null
          }
          supportingText="Investimento por resultado reportado"
          unavailableText="Aguardando resultados da Meta"
        />
        <MarketingMetricCard
          icon={Trophy}
          label="Ganhos no CRM"
          value={hasCRMAttribution ? formatNumber(summary.totalWon) : null}
          supportingText="Leads marcados como ganhos"
          unavailableText="Aguardando atribuição do CRM"
          tone="success"
        />
        <MarketingMetricCard
          icon={Eye}
          label="Impressões pagas"
          value={formatNumber(summary.totalImpressions)}
          supportingText="Entregas registradas pela Meta"
        />
        <MarketingMetricCard
          icon={Radio}
          label="Alcance diário somado"
          value={formatNumber(summary.totalReach)}
          supportingText="Soma diária; não representa pessoas únicas no período"
        />
        <MarketingMetricCard
          icon={Share2}
          label="Alcance orgânico"
          value={formatNumber(model.optionalMetrics.organicReach)}
          unavailableText="Exige permissão de insights orgânicos"
        />
        <MarketingMetricCard
          icon={CircleDollarSign}
          label="Valor ganho atribuído"
          value={
            hasCRMAttribution
              ? formatCurrency(summary.totalRevenue, summary.currency)
              : null
          }
          supportingText="Negócios ganhos ligados às campanhas"
          unavailableText="Aguardando atribuição financeira do CRM"
          tone="success"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <MarketingSectionCard
          title="Evolução de aquisição"
          description="Leads e conversas recebidos diariamente no período."
          icon={TrendingUp}
        >
          {data.dailyData.length > 0 ? (
            <MarketingTrendChart data={data.dailyData} />
          ) : (
            <MarketingDataState
              compact
              kind="empty"
              title="Sem série diária no período"
              description="Sincronize a conta de anúncios ou amplie o intervalo selecionado."
            />
          )}
        </MarketingSectionCard>

        <MarketingSectionCard
          title="Funil de mídia ao fechamento"
          description="Dados da Meta combinados com os resultados registrados no CRM."
          icon={Activity}
        >
          <MarketingFunnel
            steps={[
              {
                key: "impressions",
                label: "Impressões",
                value: summary.totalImpressions,
              },
              {
                key: "leads",
                label: "Leads",
                value: hasCRMAttribution ? summary.totalLeads : null,
              },
              {
                key: "responded",
                label: "Respondidos",
                value: model.optionalMetrics.responded,
                description: "Aguardando classificação de primeira resposta.",
              },
              {
                key: "qualified",
                label: "Qualificados",
                value: model.optionalMetrics.qualified,
                description: "Aguardando regra de qualificação do CRM.",
              },
              {
                key: "won",
                label: "Ganhos",
                value: hasCRMAttribution ? summary.totalWon : null,
              },
            ]}
          />
        </MarketingSectionCard>
      </div>

      <MarketingSectionCard
        title="Áreas de Marketing"
        description="Cada área preserva os filtros de período e escopo do CRM."
        icon={Layers3}
        contentClassName="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
      >
        {[
          {
            href: tabHrefs.acquisition,
            icon: MousePointerClick,
            title: "Aquisição",
            description: "Origem, custo e conversão de leads.",
          },
          {
            href: tabHrefs.paid,
            icon: BarChart3,
            title: "Tráfego pago",
            description: "Campanhas e eficiência da Meta.",
          },
          {
            href: tabHrefs.media,
            icon: ImageIcon,
            title: "Mídia",
            description: "Criativos e resultados atribuídos.",
          },
          {
            href: tabHrefs.intelligence,
            icon: BrainCircuit,
            title: "Inteligência",
            description: "Retorno e qualidade comercial.",
          },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group rounded-[8px] bg-[var(--app-surface-soft)] p-3 transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
          >
            <item.icon className="h-4 w-4 text-primary" aria-hidden="true" />
            <p className="mt-3 text-[12px] font-medium text-[var(--app-text-primary)]">
              {item.title}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-[var(--app-text-tertiary)]">
              {item.description}
            </p>
          </Link>
        ))}
      </MarketingSectionCard>
    </div>
  );
}

function AcquisitionView({ model }: { model: MarketingModel }) {
  const data = model.insightsQuery.data!;
  const { summary } = data;
  const hasCRMAttribution = data.dataQuality.hasCRMAttribution;
  const spend = data.hasSpendData ? summary.totalSpend : null;
  const clicks = model.optionalMetrics.clicks;
  const cpc =
    summary.cpc ??
    (spend !== null && clicks !== null && clicks > 0 ? spend / clicks : null);
  const qualificationRate =
    summary.qualificationRate ??
    (model.optionalMetrics.qualified !== null && summary.totalLeads > 0
      ? (model.optionalMetrics.qualified / summary.totalLeads) * 100
      : null);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MarketingMetricCard
          icon={Eye}
          label="Impressões"
          value={formatNumber(summary.totalImpressions)}
          supportingText="Meta Ads"
        />
        <MarketingMetricCard
          icon={MousePointerClick}
          label="Cliques"
          value={formatNumber(clicks)}
          unavailableText="Exige permissão de métricas de anúncios"
        />
        <MarketingMetricCard
          icon={Megaphone}
          label="Resultados na Meta"
          value={formatNumber(summary.reportedLeads)}
          supportingText="Leads reportados pela plataforma"
        />
        <MarketingMetricCard
          icon={UsersRound}
          label="Leads no CRM"
          value={hasCRMAttribution ? formatNumber(summary.totalLeads) : null}
          supportingText="Recebidos no CRM"
          unavailableText="Aguardando atribuição do CRM"
        />
        <MarketingMetricCard
          icon={MessageCircleMore}
          label="Contatados"
          value={hasCRMAttribution ? formatNumber(summary.totalContacted) : null}
          unavailableText="Aguardando atribuição do CRM"
        />
        <MarketingMetricCard
          icon={MessagesSquare}
          label="Respondidos"
          value={formatNumber(model.optionalMetrics.responded)}
          unavailableText="Aguardando primeira resposta"
        />
        <MarketingMetricCard
          icon={UserRoundCheck}
          label="Qualificados"
          value={formatNumber(model.optionalMetrics.qualified)}
          unavailableText="Aguardando regra de qualificação"
        />
        <MarketingMetricCard
          icon={Trophy}
          label="Ganhos"
          value={hasCRMAttribution ? formatNumber(summary.totalWon) : null}
          unavailableText="Aguardando atribuição do CRM"
          tone="success"
        />
        <MarketingMetricCard
          icon={Radio}
          label="Perdidos"
          value={formatNumber(model.optionalMetrics.lost)}
          unavailableText="Aguardando atribuição do CRM"
          tone="warning"
        />
        <MarketingMetricCard
          icon={Percent}
          label="CTR médio"
          value={formatPercent(summary.ctr ?? model.campaignMetrics.averageCtr)}
          unavailableText="Aguardando cliques e impressões"
        />
        <MarketingMetricCard
          icon={BadgeDollarSign}
          label="CPC médio"
          value={formatCurrency(cpc, summary.currency)}
          unavailableText="Aguardando sincronização de cliques"
        />
        <MarketingMetricCard
          icon={Target}
          label="CPL médio"
          value={formatCurrency(summary.avgCpl, summary.currency)}
          unavailableText="Aguardando investimento da Meta"
        />
        <MarketingMetricCard
          icon={Gauge}
          label="Taxa de qualificação"
          value={formatPercent(qualificationRate)}
          unavailableText="Aguardando qualificação no CRM"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.28fr)]">
        <MarketingSectionCard
          title="Funil de aquisição"
          description="A disponibilidade de cada etapa depende da permissão e do vínculo com o CRM."
          icon={Activity}
        >
          <MarketingFunnel
            steps={[
              { key: "impressions", label: "Impressões", value: summary.totalImpressions },
              { key: "clicks", label: "Cliques", value: clicks },
              {
                key: "reported-leads",
                label: "Resultados na Meta",
                value: summary.reportedLeads,
              },
              {
                key: "leads",
                label: "Leads no CRM",
                value: hasCRMAttribution ? summary.totalLeads : null,
              },
              {
                key: "qualified",
                label: "Qualificados",
                value: model.optionalMetrics.qualified,
              },
              {
                key: "won",
                label: "Ganhos",
                value: hasCRMAttribution ? summary.totalWon : null,
              },
            ]}
          />
        </MarketingSectionCard>

        <MarketingSectionCard
          title="Meta Ads + CRM"
          description="A fonte paga conectada é confrontada com o avanço comercial dos leads."
          icon={SearchCheck}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <CapabilityRow
              icon={Megaphone}
              title="Meta Ads"
              description={
                model.integrationState.hasAdAccount
                  ? `${model.integrationState.adAccountCount} conta(s) de anúncio configurada(s).`
                  : "Selecione uma conta de anúncio para liberar investimento e entrega."
              }
              available={model.integrationState.hasAdAccount}
            />
            <CapabilityRow
              icon={UsersRound}
              title="Leads no CRM"
              description={
                data.dataQuality.hasCRMAttribution
                  ? `${formatNumber(summary.totalLeads) ?? "0"} lead(s) atribuído(s) no período.`
                  : "Aguardando a cobertura de atribuição entre mídia e CRM."
              }
              available={data.dataQuality.hasCRMAttribution}
            />
            <CapabilityRow
              icon={MessageCircleMore}
              title="Primeira resposta"
              description="O marcador de resposta aparecerá quando a telemetria comercial estiver sincronizada."
              available={model.optionalMetrics.responded !== null}
            />
            <CapabilityRow
              icon={UserRoundCheck}
              title="Qualificação"
              description="A regra de lead qualificado precisa ser definida e sincronizada pelo CRM."
              available={model.optionalMetrics.qualified !== null}
            />
          </div>
        </MarketingSectionCard>
      </div>
    </div>
  );
}

function PaidView({ model }: { model: MarketingModel }) {
  const data = model.insightsQuery.data!;
  const { summary } = data;
  const frequency =
    summary.totalImpressions !== null &&
    summary.totalReach !== null &&
    summary.totalReach > 0
      ? summary.totalImpressions / summary.totalReach
      : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MarketingMetricCard
          icon={BarChart3}
          label="Campanhas ativas"
          value={formatNumber(model.campaignMetrics.activeCampaigns)}
          supportingText={`${formatNumber(summary.totalCampaigns)} sincronizadas`}
        />
        <MarketingMetricCard
          icon={Banknote}
          label="Investimento"
          value={
            data.hasSpendData
              ? formatCurrency(summary.totalSpend, summary.currency)
              : null
          }
          supportingText="Período selecionado"
        />
        <MarketingMetricCard
          icon={UsersRound}
          label="Resultados na Meta"
          value={formatNumber(summary.reportedLeads)}
          supportingText="Leads reportados pela plataforma"
        />
        <MarketingMetricCard
          icon={UsersRound}
          label="Leads no CRM"
          value={
            data.dataQuality.hasCRMAttribution
              ? formatNumber(summary.totalLeads)
              : null
          }
          supportingText="Leads atribuídos às campanhas"
          unavailableText="Aguardando atribuição do CRM"
        />
        <MarketingMetricCard
          icon={UserRoundCheck}
          label="Qualificados"
          value={
            data.dataQuality.hasCRMAttribution
              ? formatNumber(summary.totalQualified)
              : null
          }
          supportingText="Leads qualificados no CRM"
          unavailableText="Aguardando atribuição do CRM"
        />
        <MarketingMetricCard
          icon={Target}
          label="Custo por resultado"
          value={formatCurrency(summary.reportedCpl, summary.currency)}
          supportingText="CPL reportado pela Meta"
          unavailableText="Aguardando resultados da Meta"
        />
        <MarketingMetricCard
          icon={MousePointerClick}
          label="Cliques"
          value={formatNumber(summary.totalClicks)}
          unavailableText="Aguardando métricas de anúncios"
        />
        <MarketingMetricCard
          icon={Percent}
          label="CTR médio"
          value={formatPercent(summary.ctr ?? model.campaignMetrics.averageCtr)}
          unavailableText="Aguardando cliques e impressões"
        />
        <MarketingMetricCard
          icon={BadgeDollarSign}
          label="CPC médio"
          value={formatCurrency(summary.cpc, summary.currency)}
          unavailableText="Aguardando cliques e investimento"
        />
        <MarketingMetricCard
          icon={Banknote}
          label="CPM"
          value={formatCurrency(summary.cpm, summary.currency)}
          unavailableText="Aguardando impressões e investimento"
        />
        <MarketingMetricCard
          icon={Eye}
          label="Impressões"
          value={formatNumber(summary.totalImpressions)}
          supportingText="Entrega paga"
        />
        <MarketingMetricCard
          icon={Radio}
          label="Alcance diário somado"
          value={formatNumber(summary.totalReach)}
          supportingText="Soma diária; não é alcance único do período"
        />
        <MarketingMetricCard
          icon={Gauge}
          label="Frequência"
          value={frequency?.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) ?? null}
          unavailableText="Aguardando entrega e alcance"
        />
      </div>

      <MarketingSectionCard
        title="Campanhas da Meta"
        description="Status, entrega, custo e resultado comercial por campanha."
        icon={BarChart3}
      >
        {model.campaigns.length > 0 ? (
          <MarketingPaidTable
            campaigns={model.campaigns}
            hasCRMAttribution={data.dataQuality.hasCRMAttribution}
          />
        ) : (
          <MarketingDataState
            kind="empty"
            title="Nenhuma campanha encontrada"
            description="Sincronize o período ou ajuste os filtros para carregar as campanhas da conta selecionada."
          />
        )}
      </MarketingSectionCard>
    </div>
  );
}

function MediaView({ model }: { model: MarketingModel }) {
  const data = model.insightsQuery.data!;
  const hasCRMAttribution = data.dataQuality.hasCRMAttribution;
  const totalCreativeSpend = model.creatives.reduce(
    (total, creative) => total + (creative.spend ?? 0),
    0,
  );
  const hasCreativeSpend = model.creatives.some((creative) => creative.spend !== null);
  const totalCreativeLeads = model.creatives.reduce(
    (total, creative) => total + (creative.leads_count ?? 0),
    0,
  );
  const totalCreativeWon = model.creatives.reduce(
    (total, creative) => total + (creative.won_count ?? 0),
    0,
  );
  const paidCreatives = model.creatives.filter(
    (creative) => creative.source_kind === "paid",
  ).length;
  const organicCreatives = model.creatives.length - paidCreatives;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MarketingMetricCard
          icon={ImageIcon}
          label="Criativos rastreados"
          value={formatNumber(model.creatives.length)}
          supportingText={`${paidCreatives} pago(s) · ${organicCreatives} orgânico(s)`}
        />
        <MarketingMetricCard
          icon={Banknote}
          label="Investimento rastreado"
          value={
            hasCreativeSpend
              ? formatCurrency(totalCreativeSpend, data.summary.currency)
              : null
          }
          unavailableText="Aguardando dados por anúncio"
        />
        <MarketingMetricCard
          icon={UsersRound}
          label="Leads dos criativos"
          value={hasCRMAttribution ? formatNumber(totalCreativeLeads) : null}
          supportingText="Soma dos anúncios exibidos"
          unavailableText="Aguardando atribuição do CRM"
        />
        <MarketingMetricCard
          icon={Trophy}
          label="Ganhos atribuídos"
          value={hasCRMAttribution ? formatNumber(totalCreativeWon) : null}
          supportingText="Fechamentos ligados aos anúncios"
          unavailableText="Aguardando atribuição do CRM"
          tone="success"
        />
      </div>

      <MarketingSectionCard
        title="Galeria de mídia"
        description="Prévia dos criativos sincronizados, ordenados pelo resultado real no CRM."
        icon={ImageIcon}
      >
        {model.creatives.length > 0 ? (
          <MarketingMediaGallery creatives={model.creatives} />
        ) : (
          <MarketingDataState
            kind="empty"
            title="Nenhum criativo sincronizado"
            description="A galeria será preenchida com as imagens e os vídeos dos anúncios assim que a conta disponibilizar os ativos."
          />
        )}
      </MarketingSectionCard>
    </div>
  );
}

function SocialView({ model }: { model: MarketingModel }) {
  const data = model.insightsQuery.data!;
  const social = data.social;
  const hasSocialData = Boolean(
    social.lastSync ||
      data.media.some((asset) => asset.source_kind === "organic"),
  );
  const instagramLabel = model.integrationState.instagramUsername
    ? `@${model.integrationState.instagramUsername.replace(/^@/, "")}`
    : "Instagram profissional";
  const pageLabel = model.integrationState.pageName ?? "Página do Facebook";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MarketingMetricCard
          icon={UsersRound}
          label="Seguidores"
          value={hasSocialData ? formatNumber(social.followers) : null}
          unavailableText="Exige permissão de insights do perfil"
        />
        <MarketingMetricCard
          icon={Radio}
          label="Alcance orgânico"
          value={hasSocialData ? formatNumber(social.reach) : null}
          unavailableText="Exige permissão de insights orgânicos"
        />
        <MarketingMetricCard
          icon={Eye}
          label="Visitas ao perfil"
          value={hasSocialData ? formatNumber(social.profileViews) : null}
          unavailableText="Exige permissão de atividade do perfil"
        />
        <MarketingMetricCard
          icon={ThumbsUp}
          label="Interações"
          value={hasSocialData ? formatNumber(social.interactions) : null}
          unavailableText="Aguardando sincronização de conteúdo"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MarketingSectionCard
          title={instagramLabel}
          description="Conteúdo, audiência e interações do perfil comercial."
          icon={AtSign}
        >
          <div className="space-y-2">
            <CapabilityRow
              icon={AtSign}
              title={
                model.integrationState.hasInstagram
                  ? "Perfil identificado"
                  : "Perfil ainda não autorizado"
              }
              description={
                model.integrationState.hasInstagram
                  ? "A conexão da Meta reconheceu o perfil profissional."
                  : "Autorize o Instagram profissional na integração da Meta."
              }
              available={model.integrationState.hasInstagram}
            />
            <CapabilityRow
              icon={ImageIcon}
              title="Conteúdo e formatos"
              description={
                hasSocialData
                  ? `${formatNumber(social.posts)} publicação(ões) e ${formatNumber(social.videoViews)} visualização(ões) de vídeo no período.`
                  : "Publicações, Reels e carrosséis aparecerão após a sincronização orgânica."
              }
              available={hasSocialData}
            />
            <CapabilityRow
              icon={MessagesSquare}
              title="Comentários e intenção"
              description={
                hasSocialData
                  ? `${formatNumber(social.comments)} comentário(s), ${formatNumber(social.saves)} salvamento(s) e ${formatNumber(social.shares)} compartilhamento(s).`
                  : "Respostas, sentimento e intenção comercial dependem das permissões do perfil."
              }
              available={hasSocialData}
            />
          </div>
        </MarketingSectionCard>

        <MarketingSectionCard
          title={pageLabel}
          description="Conteúdo e audiência orgânica da página conectada."
          icon={Megaphone}
        >
          <div className="space-y-2">
            <CapabilityRow
              icon={Megaphone}
              title={
                model.integrationState.pageCount > 0
                  ? "Página conectada"
                  : "Página ainda não conectada"
              }
              description={
                model.integrationState.pageCount > 0
                  ? `${model.integrationState.pageCount} página(s) ativa(s) na organização.`
                  : "Conecte uma página para liberar os insights orgânicos."
              }
              available={model.integrationState.pageCount > 0}
            />
            <CapabilityRow
              icon={TrendingUp}
              title="Crescimento e engajamento"
              description="A série histórica ficará disponível quando a Meta entregar os dados de página."
            />
            <CapabilityRow
              icon={UsersRound}
              title="Audiência"
              description="Faixa etária, gênero e localização exigem volume e permissão suficientes."
            />
          </div>
        </MarketingSectionCard>
      </div>

      {!model.integrationState.hasInstagram || model.integrationState.pageCount === 0 ? (
        <MarketingDataState
          compact
          title="Complete as permissões sociais"
          description="A conexão de leads não libera automaticamente conteúdo e audiência. Revise os ativos e as permissões da Meta para habilitar esta área."
          action={<SettingsLink label="Revisar conexão Meta" />}
        />
      ) : null}
    </div>
  );
}

function RelationshipView({ model }: { model: MarketingModel }) {
  const data = model.insightsQuery.data!;
  const { summary } = data;
  const conversations = summary.conversations_count;
  const spend = data.hasSpendData ? summary.totalSpend : null;
  const costPerConversation =
    spend !== null && conversations > 0 ? spend / conversations : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MarketingMetricCard
          icon={MessagesSquare}
          label="Conversas atribuídas"
          value={formatNumber(conversations)}
          supportingText="Conversas ligadas às campanhas"
        />
        <MarketingMetricCard
          icon={BadgeDollarSign}
          label="Custo por conversa"
          value={
            conversations === 0 && spend !== null
              ? "—"
              : formatCurrency(costPerConversation, summary.currency)
          }
          supportingText={
            conversations === 0 ? "Sem conversas no período" : "Investimento por conversa"
          }
          unavailableText="Aguardando investimento da Meta"
        />
        <MarketingMetricCard
          icon={Send}
          label="Mensagens enviadas"
          value={null}
          unavailableText="Aguardando integração de disparos"
        />
        <MarketingMetricCard
          icon={MessageCircleMore}
          label="Taxa de resposta"
          value={formatPercent(summary.responseRate)}
          unavailableText="Aguardando telemetria de atendimento"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <MarketingSectionCard
          title="Leads e conversas"
          description="Evolução diária dos resultados atribuídos à mídia."
          icon={TrendingUp}
        >
          {data.dailyData.length > 0 ? (
            <MarketingTrendChart data={data.dailyData} />
          ) : (
            <MarketingDataState
              compact
              kind="empty"
              title="Sem histórico de conversas"
              description="Não há uma série diária de conversas no período selecionado."
            />
          )}
        </MarketingSectionCard>

        <MarketingSectionCard
          title="Camadas de relacionamento"
          description="Status das fontes necessárias para a visão completa."
          icon={MessagesSquare}
        >
          <div className="space-y-2">
            <CapabilityRow
              icon={MessageCircleMore}
              title="Conversas atribuídas"
              description="Disponíveis a partir dos resultados das campanhas sincronizadas."
              available
            />
            <CapabilityRow
              icon={Send}
              title="Disparos e modelos"
              description="Aguardando integração com campanhas e templates do WhatsApp."
            />
            <CapabilityRow
              icon={Activity}
              title="Entrega e leitura"
              description="Aguardando eventos de entrega, leitura e resposta."
            />
          </div>
        </MarketingSectionCard>
      </div>
    </div>
  );
}

function ReputationView({ model }: { model: MarketingModel }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MarketingMetricCard
          icon={MessagesSquare}
          label="Menções"
          value={null}
          unavailableText="Aguardando fonte de monitoramento"
        />
        <MarketingMetricCard
          icon={ThumbsUp}
          label="Sentimento"
          value={null}
          unavailableText="Aguardando análise de menções"
        />
        <MarketingMetricCard
          icon={Share2}
          label="Share of voice"
          value={null}
          unavailableText="Aguardando termos e concorrentes"
        />
        <MarketingMetricCard
          icon={SearchCheck}
          label="Veículos"
          value={null}
          unavailableText="Aguardando coleta de fontes"
        />
      </div>

      <MarketingSectionCard
        title="Reputação e escuta da marca"
        description="Esta área não exibe zeros: os indicadores serão calculados apenas depois que uma fonte real de monitoramento estiver ativa."
        icon={Radio}
      >
        <div className="grid gap-2 md:grid-cols-2">
          <CapabilityRow
            icon={SearchCheck}
            title="Termos monitorados"
            description="Defina marca, empreendimentos e palavras-chave para iniciar a coleta."
          />
          <CapabilityRow
            icon={MessagesSquare}
            title="Menções e comentários"
            description="A coleta social depende das permissões de conteúdo da Meta."
            available={model.integrationState.hasInstagram}
          />
          <CapabilityRow
            icon={ThumbsUp}
            title="Sentimento"
            description="A classificação positiva, neutra ou negativa será feita somente sobre menções coletadas."
          />
          <CapabilityRow
            icon={Share2}
            title="Concorrentes"
            description="O share of voice exige a configuração explícita de marcas comparáveis."
          />
        </div>
        <div className="mt-4 flex justify-start">
          <SettingsLink label="Revisar fontes conectadas" />
        </div>
      </MarketingSectionCard>
    </div>
  );
}

function IntelligenceView({ model }: { model: MarketingModel }) {
  const data = model.insightsQuery.data!;
  const { summary } = data;
  const hasCRMAttribution = data.dataQuality.hasCRMAttribution;
  const canCombineSpendAndCRM = !data.dataQuality.hasCRMScopedFilters;
  const spend = data.hasSpendData ? summary.totalSpend : null;
  const roas =
    hasCRMAttribution && canCombineSpendAndCRM
      ? (summary.roas ??
        (spend !== null && spend > 0 ? summary.totalRevenue / spend : null))
      : null;
  const winRate =
    hasCRMAttribution && summary.totalLeads > 0
      ? (summary.totalWon / summary.totalLeads) * 100
      : null;
  const costPerWin =
    hasCRMAttribution && canCombineSpendAndCRM && spend !== null && summary.totalWon > 0
      ? spend / summary.totalWon
      : null;
  const qualificationRate =
    hasCRMAttribution
      ? (summary.qualificationRate ??
        (model.optionalMetrics.qualified !== null && summary.totalLeads > 0
          ? (model.optionalMetrics.qualified / summary.totalLeads) * 100
          : null))
      : null;
  const costPerQualified =
    hasCRMAttribution && canCombineSpendAndCRM
      ? (summary.cpql ??
        (spend !== null &&
        model.optionalMetrics.qualified !== null &&
        model.optionalMetrics.qualified > 0
          ? spend / model.optionalMetrics.qualified
          : null))
      : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MarketingMetricCard
          icon={Target}
          label="CPQL"
          value={formatCurrency(costPerQualified, summary.currency)}
          unavailableText={
            canCombineSpendAndCRM
              ? "Aguardando qualificação do CRM"
              : "Indisponível com filtros de equipe, corretor, tag ou status"
          }
        />
        <MarketingMetricCard
          icon={TrendingUp}
          label="ROAS atribuído"
          value={
            hasCRMAttribution && canCombineSpendAndCRM && spend === 0
              ? "—"
              : formatRatio(roas)
          }
          supportingText={spend === 0 ? "Sem investimento no período" : "Valor ganho ÷ investimento"}
          unavailableText={
            canCombineSpendAndCRM
              ? "Aguardando investimento da Meta"
              : "Indisponível com filtros de equipe, corretor, tag ou status"
          }
          tone="success"
        />
        <MarketingMetricCard
          icon={CircleDollarSign}
          label="Valor ganho atribuído"
          value={
            hasCRMAttribution
              ? formatCurrency(summary.totalRevenue, summary.currency)
              : null
          }
          supportingText="Negócios ganhos ligados à mídia"
          unavailableText="Aguardando atribuição financeira do CRM"
          tone="success"
        />
        <MarketingMetricCard
          icon={Percent}
          label="Taxa de ganho"
          value={
            hasCRMAttribution && summary.totalLeads === 0
              ? "—"
              : formatPercent(winRate)
          }
          supportingText={
            summary.totalLeads === 0 ? "Sem leads no período" : "Ganhos ÷ leads atribuídos"
          }
        />
        <MarketingMetricCard
          icon={BadgeDollarSign}
          label="Custo por ganho"
          value={
            hasCRMAttribution &&
            canCombineSpendAndCRM &&
            summary.totalWon === 0 &&
            spend !== null
              ? "—"
              : formatCurrency(costPerWin, summary.currency)
          }
          supportingText={
            summary.totalWon === 0 ? "Sem ganhos no período" : "Investimento ÷ ganhos"
          }
          unavailableText={
            canCombineSpendAndCRM
              ? "Aguardando investimento da Meta"
              : "Indisponível com filtros de equipe, corretor, tag ou status"
          }
        />
        <MarketingMetricCard
          icon={Gauge}
          label="Taxa de qualificação"
          value={formatPercent(qualificationRate)}
          unavailableText="Aguardando regra de qualificação"
        />
        <MarketingMetricCard
          icon={Trophy}
          label="Ganhos"
          value={hasCRMAttribution ? formatNumber(summary.totalWon) : null}
          supportingText="Fechamentos atribuídos"
          unavailableText="Aguardando atribuição do CRM"
          tone="success"
        />
        <MarketingMetricCard
          icon={BarChart3}
          label="Campanhas"
          value={formatNumber(summary.totalCampaigns)}
          supportingText="Campanhas analisadas"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <MarketingSectionCard
          title="Qualidade por campanha"
          description="Investimento, leads e ganhos confrontados campanha a campanha."
          icon={BrainCircuit}
        >
          {model.campaigns.length > 0 ? (
            <MarketingPaidTable
              campaigns={model.campaigns}
              hasCRMAttribution={data.dataQuality.hasCRMAttribution}
            />
          ) : (
            <MarketingDataState
              compact
              kind="empty"
              title="Sem campanhas para comparar"
              description="A comparação será liberada quando houver campanhas sincronizadas no período."
            />
          )}
        </MarketingSectionCard>

        <MarketingSectionCard
          title="Camada preditiva"
          description="Projeções serão exibidas somente quando existir histórico suficiente."
          icon={Sparkles}
        >
          <MarketingDataState
            compact
            title="Construindo base histórica"
            description="Previsões de investimento, leads e custo só serão calculadas sobre dados reais sincronizados, sem estimativas demonstrativas."
          />
        </MarketingSectionCard>
      </div>
    </div>
  );
}

export function MarketingTabViews({
  activeTab,
  model,
  tabHrefs,
}: MarketingTabViewsProps) {
  switch (activeTab) {
    case "acquisition":
      return <AcquisitionView model={model} />;
    case "paid":
      return <PaidView model={model} />;
    case "media":
      return <MediaView model={model} />;
    case "social":
      return <SocialView model={model} />;
    case "relationship":
      return <RelationshipView model={model} />;
    case "reputation":
      return <ReputationView model={model} />;
    case "intelligence":
      return <IntelligenceView model={model} />;
    case "overview":
    default:
      return <OverviewView model={model} tabHrefs={tabHrefs} />;
  }
}
