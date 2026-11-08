"use client";

import { BedDouble, Car, Bath, MapPin, Ruler } from "lucide-react";

import type { PropertyWorkspaceOffer } from "@/lib/validation";

import {
  PROPERTY_PORTFOLIO_LABELS,
  PROPERTY_STATUS_LABELS,
  plural,
  pricePerSquareMeter,
  formatPropertyMoney,
  propertyDealLabel,
  propertyStatusKind,
} from "../property-display";
import {
  PersonAvatar,
  PropertyChip,
  PropertyFieldGrid,
  PropertyTile,
  ResponsibleAvatar,
  filledFields,
  type PropertyChipTone,
} from "../property-ui";
import { hasField, type WorkspaceProperty, type WorkspaceSummary } from "./property-workspace-model";

const OFFER_LABELS: Record<PropertyWorkspaceOffer["offer_type"], string> = {
  sale: "Venda",
  rent: "Locação",
  seasonal: "Temporada",
};

const PERIOD_SUFFIX: Record<string, string> = {
  daily: "/dia",
  weekly: "/semana",
  monthly: "/mês",
  yearly: "/ano",
};

const SITE_TONES: Record<string, PropertyChipTone> = {
  success: "success",
  error: "danger",
  pending: "warning",
  neutral: "neutral",
};

export function PropertyWorkspaceSummary({
  property,
  summary,
  primaryOffer,
  title,
  address,
  siteLabel,
  siteTone,
  responsible,
  ownerName,
}: {
  property: WorkspaceProperty;
  summary: WorkspaceSummary;
  primaryOffer?: PropertyWorkspaceOffer;
  title: string;
  address: string;
  siteLabel: string;
  siteTone: string;
  responsible: { name: string; avatarUrl: string | null } | null;
  ownerName: string | null;
}) {
  const statusKind = propertyStatusKind(property.status);
  const price = primaryOffer?.price ?? property.preco ?? property.valor_locacao;
  const area = property.area_util || property.area_total;
  const perSquareMeter = pricePerSquareMeter(price, area);
  const missing = summary.checklist.filter((check) => !check.resolved).length;
  const dealLabel = primaryOffer ? OFFER_LABELS[primaryOffer.offer_type] : propertyDealLabel(property.tipo_de_negocio);
  const costs = filledFields([
    { label: "Por m²", value: perSquareMeter !== null ? formatPropertyMoney(perSquareMeter) : null },
    { label: "Condomínio", value: hasField(property, "condominio") && property.condominio ? formatPropertyMoney(property.condominio) : null },
    { label: "IPTU", value: property.iptu ? formatPropertyMoney(property.iptu) : null },
  ]);
  const tiles = [
    property.quartos ? { icon: BedDouble, label: plural(property.quartos, "quarto", "quartos") } : null,
    property.suites ? { icon: Bath, label: plural(property.suites, "suíte", "suítes") } : null,
    property.vagas ? { icon: Car, label: plural(property.vagas, "vaga", "vagas") } : null,
    area ? { icon: Ruler, label: `${area} m²` } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <section aria-label="Resumo do imóvel" className="flex min-w-0 flex-col rounded-[12px] bg-[var(--app-surface-solid)] p-4">
      <div className="flex flex-wrap gap-1">
        {property.code && <PropertyChip tone="primary">{property.code}</PropertyChip>}
        <PropertyChip tone={statusKind === "available" ? "success" : "neutral"}>{PROPERTY_STATUS_LABELS[statusKind]}</PropertyChip>
        {property.portfolio_type && <PropertyChip>{PROPERTY_PORTFOLIO_LABELS[property.portfolio_type]}</PropertyChip>}
        <PropertyChip tone={SITE_TONES[siteTone] ?? "neutral"}>{siteLabel}</PropertyChip>
      </div>

      <h1 className="mt-3 text-[18px] font-normal leading-6 text-[var(--app-text-primary)]">{title}</h1>
      {address && (
        <p className="mt-1 flex items-start gap-1.5 text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{address}</span>
        </p>
      )}

      <div className="mt-3 flex items-baseline justify-between gap-3 border-b border-[var(--app-border)] pb-3">
        <p className="min-w-0 break-words text-[26px] font-normal leading-tight tabular-nums text-[var(--app-text-primary)]">
          {price == null
            ? "Valor não informado"
            : `${formatPropertyMoney(price, primaryOffer?.currency)}${primaryOffer?.price_period ? PERIOD_SUFFIX[primaryOffer.price_period] ?? "" : ""}`}
        </p>
        {dealLabel && <span className="shrink-0 text-[12px] font-light text-[var(--app-text-secondary)]">{dealLabel}</span>}
      </div>

      {costs.length > 0 && <div className="mt-3"><PropertyFieldGrid fields={costs} columns={3} /></div>}

      {tiles.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {tiles.map(({ icon: Icon, label }) => (
            <PropertyTile key={label} icon={<Icon className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-secondary)]" aria-hidden="true" />}>{label}</PropertyTile>
          ))}
        </div>
      )}

      {(responsible || ownerName) && (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--app-border)] pt-3">
          {responsible && (
            <div className="flex min-w-0 items-center gap-2">
              <ResponsibleAvatar name={responsible.name} avatarUrl={responsible.avatarUrl} />
              <div className="min-w-0">
                <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">Responsável</p>
                <p className="truncate text-[13px] font-light text-[var(--app-text-primary)]">{responsible.name}</p>
              </div>
            </div>
          )}
          {ownerName && (
            <div className="flex min-w-0 items-center gap-2">
              <PersonAvatar name={ownerName} />
              <div className="min-w-0">
                <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                  {property.third_party_kind === "partner" ? "Parceiro" : "Proprietário"}
                </p>
                <p className="truncate text-[13px] font-light text-[var(--app-text-primary)]">{ownerName}</p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center gap-3 pt-4">
        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-[color-mix(in_srgb,var(--app-text-primary)_11%,transparent)]">
          <span className="block h-full rounded-[3px] bg-primary" style={{ width: `${summary.completeness_score}%` }} />
        </span>
        <span className="shrink-0 text-[11px] font-light text-[var(--app-text-tertiary)]">
          Cadastro {summary.completeness_score}%{missing > 0 ? ` · ${plural(missing, "item faltando", "itens faltando")}` : ""}
        </span>
      </div>
    </section>
  );
}
