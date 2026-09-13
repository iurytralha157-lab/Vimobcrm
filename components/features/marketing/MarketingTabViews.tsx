import Link from "next/link";
import {
  Activity,
  AtSign,
  BadgeDollarSign,
  Eye,
  Gauge,
  ImageIcon,
  Megaphone,
  MessageCircleMore,
  MessagesSquare,
  MousePointerClick,
  Percent,
  Radio,
  SearchCheck,
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
import { MarketingCampaignDetailTable } from "./MarketingCampaignDetailTable";
import { MarketingFunnel } from "./MarketingFunnel";
import { MarketingMediaGallery } from "./MarketingMediaGallery";
import { MarketingMetricCard } from "./MarketingMetricCard";
import { MarketingOverviewDashboard } from "./MarketingOverviewDashboard";
import { MarketingSectionCard } from "./MarketingSectionCard";
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
        <p className="text-[12px] font-medium text-[var(--app-text-primary)]">
          {title}
        </p>
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
  return <MarketingOverviewDashboard model={model} tabHrefs={tabHrefs} />;
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
    (model.optionalMetrics.qualified !== null && summary.crmAttributedLeads > 0
      ? (model.optionalMetrics.qualified / summary.crmAttributedLeads) * 100
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
          value={formatNumber(summary.reportedResults)}
          supportingText={`${formatNumber(summary.metaReportedLeads)} formulários · ${formatNumber(summary.metaReportedConversations)} conversas`}
        />
        <MarketingMetricCard
          icon={UsersRound}
          label="Leads no CRM"
          value={
            hasCRMAttribution ? formatNumber(summary.crmAttributedLeads) : null
          }
          supportingText="Recebidos no CRM"
          unavailableText="Aguardando atribuição do CRM"
        />
        <MarketingMetricCard
          icon={MessageCircleMore}
          label="Contatados"
          value={
            hasCRMAttribution ? formatNumber(summary.totalContacted) : null
          }
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
          label="Custo por lead no CRM"
          value={formatCurrency(summary.avgCpl, summary.currency)}
          unavailableText="Aguardando investimento e atribuição de leads no CRM"
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
              {
                key: "impressions",
                label: "Impressões",
                value: summary.totalImpressions,
              },
              { key: "clicks", label: "Cliques", value: clicks },
              {
                key: "reported-leads",
                label: "Resultados na Meta",
                value: summary.reportedResults,
              },
              {
                key: "leads",
                label: "Leads no CRM",
                value: hasCRMAttribution ? summary.crmAttributedLeads : null,
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
                  ? `${formatNumber(summary.crmAttributedLeads) ?? "0"} lead(s) atribuído(s) no período.`
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
  return (
    <section className="min-w-0 rounded-[10px] bg-[var(--app-surface-solid)] p-3">
      <h2 className="sr-only">Campanhas</h2>
      {model.campaigns.length > 0 ? (
        <MarketingCampaignDetailTable campaigns={model.campaigns} />
      ) : (
        <MarketingDataState
          kind="empty"
          title="Nenhuma campanha encontrada"
          description="Sincronize o período ou ajuste os filtros para carregar as campanhas da conta selecionada."
        />
      )}
    </section>
  );
}

function MediaView({ model }: { model: MarketingModel }) {
  const paidCreatives = model.creatives.filter(
    (creative) => creative.source_kind === "paid",
  ).length;
  const organicCreatives = model.creatives.length - paidCreatives;
  const creativeSummary = [
    `${model.creatives.length} ${model.creatives.length === 1 ? "criativo" : "criativos"}`,
    `${paidCreatives} ${paidCreatives === 1 ? "pago" : "pagos"}`,
    `${organicCreatives} ${organicCreatives === 1 ? "orgânico" : "orgânicos"}`,
  ].join(" · ");

  return (
    <MarketingSectionCard
      title="Criativos"
      description="Anúncios usam o período filtrado; conteúdos orgânicos publicados no período exibem o acumulado até a última sincronização."
      icon={ImageIcon}
      action={
        <p className="hidden shrink-0 text-[10px] font-light text-[var(--app-text-secondary)] sm:block">
          {creativeSummary}
        </p>
      }
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
              title={
                model.integrationState.hasInstagramInsights
                  ? "Insights orgânicos autorizados"
                  : "Permissões orgânicas pendentes"
              }
              description={
                hasSocialData
                  ? `${formatNumber(social.posts)} publicação(ões) e ${formatNumber(social.videoViews)} visualização(ões) de vídeo no período.`
                  : model.integrationState.hasInstagramInsights
                    ? "Publicações, Reels e carrosséis aparecerão após a sincronização orgânica."
                    : "Reconecte a Meta com as permissões de insights do Instagram; os dados pagos continuam disponíveis."
              }
              available={model.integrationState.hasInstagramInsights}
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
          title={`${pageLabel} · conexão`}
          description="Ativo usado para autenticação, formulários e anúncios da Meta."
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
                  ? `${model.integrationState.pageCount} página(s) ativa(s) na organização; os insights orgânicos de Página ainda não são coletados nesta versão.`
                  : "Conecte uma página para autorizar formulários, anúncios e o Instagram profissional."
              }
              available={model.integrationState.pageCount > 0}
            />
            <CapabilityRow
              icon={TrendingUp}
              title="Insights de Página não habilitados"
              description="A aba Social usa somente os dados orgânicos do Instagram profissional nesta versão."
            />
            <CapabilityRow
              icon={UsersRound}
              title="Sem números simulados"
              description="Nenhuma métrica de Facebook é inferida a partir do Instagram ou de campanhas pagas."
            />
          </div>
        </MarketingSectionCard>
      </div>

      {!model.integrationState.hasInstagram ||
      !model.integrationState.hasInstagramInsights ||
      model.integrationState.pageCount === 0 ? (
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
    case "overview":
    default:
      return <OverviewView model={model} tabHrefs={tabHrefs} />;
  }
}
