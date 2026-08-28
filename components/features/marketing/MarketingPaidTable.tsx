import { CirclePause, CirclePlay, Layers3 } from "lucide-react";

import type { CampaignAggregated } from "@/hooks/use-campaign-insights";
import { cn } from "@/lib/utils";

interface MarketingPaidTableProps {
  campaigns: CampaignAggregated[];
  hasCRMAttribution: boolean;
}

function formatCurrency(value: number | null, currency: string | null) {
  if (value === null || !currency) return null;
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

function formatNumber(value: number | null) {
  if (value === null) return null;
  return new Intl.NumberFormat("pt-BR", {
    notation: value >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null) return null;
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function DataCell({ value }: { value: string | null }) {
  return value === null ? (
    <span
      className="text-[10px] text-[var(--app-text-tertiary)]"
      title="Aguardando sincronização ou permissão da Meta"
    >
      Aguardando
    </span>
  ) : (
    <span className="tabular-nums">{value}</span>
  );
}

function campaignStatus(status: string | null) {
  const normalized = String(status ?? "").toUpperCase();
  const active = normalized === "ACTIVE" || normalized === "LEARNING";
  return {
    active,
    label:
      normalized === "ACTIVE"
        ? "Ativa"
        : normalized === "LEARNING"
          ? "Aprendizado"
          : normalized === "PAUSED"
            ? "Pausada"
            : normalized === "ARCHIVED"
              ? "Arquivada"
              : status || "Não informado",
  };
}

export function MarketingPaidTable({
  campaigns,
  hasCRMAttribution,
}: MarketingPaidTableProps) {
  return (
    <div className="overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)]">
      <table className="w-full min-w-[1440px] border-collapse text-left text-[11px]">
        <caption className="sr-only">
          Desempenho real das campanhas sincronizadas da Meta
        </caption>
        <thead>
          <tr className="text-[11px] font-light text-[var(--app-text-tertiary)]">
            <th scope="col" className="px-3 py-3 font-medium">Campanha</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Investimento</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Impressões</th>
            <th
              scope="col"
              className="px-3 py-3 text-right font-medium"
              title="Soma do alcance diário; não representa pessoas únicas no período"
            >
              Alcance diário
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Cliques</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">CTR</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Leads Meta</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Leads CRM</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Qualificados</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">CPL Meta</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">CPL CRM</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Ganhos</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Perdidos</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Valor ganho</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => {
            const status = campaignStatus(campaign.status);
            return (
              <tr
                key={campaign.campaign_id}
                className="transition-colors even:bg-[var(--app-surface-muted)] hover:bg-[var(--app-surface-hover)]"
              >
                <th scope="row" className="max-w-[300px] px-3 py-3 font-normal">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px]",
                        status.active
                          ? "bg-emerald-500/12 text-emerald-500"
                          : "bg-[var(--app-surface-hover)] text-[var(--app-text-tertiary)]",
                      )}
                    >
                      {status.active ? (
                        <CirclePlay className="h-3.5 w-3.5" />
                      ) : (
                        <CirclePause className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[var(--app-text-primary)]">
                        {campaign.campaign_name}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-[var(--app-text-tertiary)]">
                        <span>{status.label}</span>
                        <span aria-hidden="true">•</span>
                        <Layers3 className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>
                          {campaign.adsets.length}{" "}
                          {campaign.adsets.length === 1 ? "conjunto" : "conjuntos"}
                        </span>
                      </span>
                    </span>
                  </div>
                </th>
                <td className="px-3 py-3 text-right">
                  <DataCell value={formatCurrency(campaign.spend, campaign.currency)} />
                </td>
                <td className="px-3 py-3 text-right">
                  <DataCell value={formatNumber(campaign.impressions)} />
                </td>
                <td className="px-3 py-3 text-right">
                  <DataCell value={formatNumber(campaign.reach)} />
                </td>
                <td className="px-3 py-3 text-right">
                  <DataCell value={formatNumber(campaign.clicks)} />
                </td>
                <td className="px-3 py-3 text-right">
                  <DataCell value={formatPercent(campaign.ctr)} />
                </td>
                <td className="px-3 py-3 text-right font-medium text-[var(--app-text-primary)]">
                  {formatNumber(campaign.leads_reported)}
                </td>
                <td className="px-3 py-3 text-right font-medium text-[var(--app-text-primary)]">
                  <DataCell
                    value={
                      hasCRMAttribution
                        ? formatNumber(campaign.leads_count)
                        : null
                    }
                  />
                </td>
                <td className="px-3 py-3 text-right font-medium text-blue-500">
                  <DataCell
                    value={
                      hasCRMAttribution
                        ? formatNumber(campaign.qualified_count)
                        : null
                    }
                  />
                </td>
                <td className="px-3 py-3 text-right">
                  <DataCell
                    value={formatCurrency(
                      campaign.spend !== null && campaign.leads_reported > 0
                        ? campaign.spend / campaign.leads_reported
                        : null,
                      campaign.currency,
                    )}
                  />
                </td>
                <td className="px-3 py-3 text-right">
                  <DataCell value={formatCurrency(campaign.cpl, campaign.currency)} />
                </td>
                <td className="px-3 py-3 text-right font-medium text-emerald-500">
                  <DataCell
                    value={
                      hasCRMAttribution ? formatNumber(campaign.won_count) : null
                    }
                  />
                </td>
                <td className="px-3 py-3 text-right font-medium text-red-400">
                  <DataCell
                    value={
                      hasCRMAttribution ? formatNumber(campaign.lost_count) : null
                    }
                  />
                </td>
                <td className="px-3 py-3 text-right">
                  <DataCell
                    value={
                      hasCRMAttribution
                        ? formatCurrency(campaign.revenue, campaign.currency)
                        : null
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
