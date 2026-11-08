"use client";

import Image from "next/image";
import Link from "next/link";
import { Building2, MapPin } from "lucide-react";

import { KpiCard, KpiRow, NEUTRAL_SOFT } from "@/components/features/marketing/marketing-ui";
import { formatCount } from "@/components/features/marketing/marketing-format";
import { cn } from "@/lib/utils";
import { formatWholePtBRCurrency } from "@/lib/utils/formatting";

import { PropertyChip } from "../property-ui";
import {
  COMMERCIAL_STATUS_LABELS,
  DEVELOPMENT_STATUS_LABELS,
  formatDevelopmentDate,
  isSafeDevelopmentImageUrl,
} from "./development-ui";

type DevelopmentListItem = {
  id: string;
  code: string;
  name: string;
  status: string;
  commercial_status: string;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  main_image_url?: string | null;
  expected_delivery_date?: string | null;
  construction_progress: number;
  published_on_site?: boolean | null;
  inventory: { total: number; available: number; reserved: number; sold: number };
  price_range: { minimum: number | null; currency?: string | null };
};

export function DevelopmentKpis({
  total,
  commercialActive,
  inventoryTotal,
  inventoryAvailable,
  underConstruction,
}: {
  total: number | undefined;
  commercialActive: number | undefined;
  inventoryTotal: number | undefined;
  inventoryAvailable: number | undefined;
  underConstruction: number | undefined;
}) {
  return (
    <KpiRow>
      <KpiCard label="Empreendimentos" value={formatCount(total)} note={commercialActive === undefined ? undefined : `${formatCount(commercialActive)} com comercial ativo`} />
      <KpiCard label="Unidades" value={formatCount(inventoryTotal)} note="Em todos os projetos" />
      <KpiCard
        label="Unidades disponíveis"
        value={formatCount(inventoryAvailable)}
        note={inventoryTotal ? `${Math.round(((inventoryAvailable ?? 0) / inventoryTotal) * 100)}% do estoque` : "Sem estoque cadastrado"}
      />
      <KpiCard label="Em obra" value={formatCount(underConstruction)} note="Acompanhamento de entrega" />
    </KpiRow>
  );
}

export function DevelopmentCatalogCard({
  development,
  canOpen,
}: {
  development: DevelopmentListItem;
  canOpen: boolean;
}) {
  const location = [development.neighborhood, development.city, development.state].filter(Boolean).join(", ");
  const { inventory } = development;
  const share = (value: number) => (inventory.total > 0 ? `${(value / inventory.total) * 100}%` : "0%");
  const minimum = development.price_range.minimum;
  const card = (
    <article className="h-full overflow-hidden rounded-[12px] bg-[var(--app-surface-solid)] transition-colors group-hover:bg-[var(--app-surface-hover)]">
      <div className="relative aspect-[2/1] overflow-hidden bg-[var(--app-surface-soft)]">
        {isSafeDevelopmentImageUrl(development.main_image_url) ? (
          <Image src={development.main_image_url} alt="" fill sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 25vw" loading="lazy" className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Building2 className="h-10 w-10 text-[var(--app-text-tertiary)] opacity-40" aria-hidden="true" />
          </div>
        )}
        <div className="absolute inset-x-2 top-2 flex items-start justify-between gap-2">
          <PropertyChip tone="surface">{DEVELOPMENT_STATUS_LABELS[development.status] ?? development.status}</PropertyChip>
          <PropertyChip tone="surface">{COMMERCIAL_STATUS_LABELS[development.commercial_status] ?? development.commercial_status}</PropertyChip>
        </div>
      </div>
      <div className="space-y-2.5 p-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-normal text-[var(--app-text-primary)]">{development.name}</h2>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] font-light text-[var(--app-text-secondary)]">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{location || "Localização não informada"}</span>
          </p>
        </div>
        {minimum ? (
          <p className="text-[13px] font-light text-[var(--app-text-primary)]">
            A partir de {formatWholePtBRCurrency(minimum, development.price_range.currency || "BRL")}
          </p>
        ) : null}
        <div>
          <div className={cn("flex h-2 overflow-hidden rounded-[3px]", NEUTRAL_SOFT)} aria-hidden="true">
            <span className="bg-primary" style={{ width: share(inventory.sold) }} />
            <span className="bg-primary/40" style={{ width: share(inventory.reserved) }} />
          </div>
          <dl className="mt-1.5 grid grid-cols-3 gap-1 text-[12px] font-light text-[var(--app-text-secondary)]">
            <div><dt className="sr-only">Vendidas</dt><dd>{inventory.sold} vendidas</dd></div>
            <div><dt className="sr-only">Reservadas</dt><dd>{inventory.reserved} reservadas</dd></div>
            <div><dt className="sr-only">Disponíveis</dt><dd>{inventory.available} livres</dd></div>
          </dl>
        </div>
        <dl className="grid grid-cols-2 gap-2 border-t border-[var(--app-border)] pt-2.5 text-[12px] font-light">
          <div>
            <dt className="text-[11px] text-[var(--app-text-tertiary)]">Entrega</dt>
            <dd className="text-[var(--app-text-primary)]">{formatDevelopmentDate(development.expected_delivery_date)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-[var(--app-text-tertiary)]">Obra</dt>
            <dd className="text-[var(--app-text-primary)]">{development.construction_progress}%</dd>
          </div>
        </dl>
      </div>
    </article>
  );
  if (!canOpen) return <div className="rounded-[12px]">{card}</div>;
  return (
    <Link
      href={`/properties/developments/${development.id}`}
      className="group rounded-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {card}
    </Link>
  );
}
