"use client";

import { useMemo, useState } from "react";
import { CircleDollarSign, FileText, Globe2, KeyRound, Plus, type LucideIcon } from "lucide-react";

import { EmptyNote, PANEL_SOFT, Panel } from "@/components/features/marketing/marketing-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PropertyHistoryEvent } from "@/lib/api/properties";
import { formatPropertyDate } from "@/lib/property-display-utils";
import type { PropertyWorkspacePayload } from "@/lib/validation";
import { cn } from "@/lib/utils";

import { PROPERTY_SECONDARY_BUTTON_CLASS, PropertyChipTabs, PropertyFieldGrid, filledFields } from "../../property-ui";
import {
  HISTORY_CATEGORY_LABELS,
  KEY_MOVEMENT_LABELS,
  hasField,
  historyCategory,
  type HistoryCategory,
} from "../property-workspace-model";

const CATEGORY_ICONS: Record<HistoryCategory, LucideIcon> = {
  value: CircleDollarSign,
  publication: Globe2,
  keys: KeyRound,
  commercial: FileText,
  registration: Plus,
};

type HistoryFilter = "all" | HistoryCategory;
const FILTERS: Array<{ value: HistoryFilter; label: string }> = [
  { value: "all", label: "Tudo" },
  { value: "value", label: "Valor" },
  { value: "publication", label: "Publicação" },
  { value: "keys", label: "Chaves" },
  { value: "commercial", label: "Comercial" },
  { value: "registration", label: "Cadastro" },
];

type TimelineItem = { id: string; title: string; detail: string | null; at: string; category: HistoryCategory };

function TechnicalIdentifiers({ workspace }: { workspace: PropertyWorkspacePayload }) {
  const { property, offers, ownerships } = workspace;
  const rows: Array<[string, string | null | undefined]> = [
    ["Imóvel", property.id],
    ["Organização", property.organization_id],
    ["Tipo", property.property_type_id],
    ["Condomínio", property.condominium_id],
    ["Cidade", property.city_id],
    ["Bairro", property.neighborhood_id],
    ["Proprietário", property.owner_id],
    ["Responsável", property.responsible_user_id || property.cadastrado_por],
    ["Corretor", property.corretor_id],
    ["Criado por", property.created_by],
    ["Provedor externo", property.external_provider],
    ["ID externo", property.external_id],
    ["Código Imoview", property.imoview_codigo],
    ["Código Vista", property.vista_codigo],
    ...offers.map((offer): [string, string] => [`Oferta (${offer.offer_type})`, offer.id]),
    ...ownerships.map((ownership): [string, string] => [`Vínculo de ${ownership.owner.name}`, ownership.id]),
  ];
  return (
    <details className="mt-3 border-t border-[var(--app-border)] pt-3" data-property-technical-identifiers>
      <summary className="cursor-pointer select-none text-[12px] font-light text-[var(--app-text-secondary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30">
        Identificadores técnicos
      </summary>
      <dl className="mt-2 space-y-1.5">
        {rows.filter(([, value]) => value).map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11px] font-light text-[var(--app-text-tertiary)]">{label}</dt>
            <dd className="break-all font-mono text-[11px] font-light text-[var(--app-text-primary)]">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function HistoryTab({
  workspace,
  canManage,
  normalizedResourcesAvailable,
  events,
  loading,
  error,
  fetching,
  onRetry,
  createdByName,
}: {
  workspace: PropertyWorkspacePayload;
  canManage: boolean;
  normalizedResourcesAvailable: boolean;
  events: PropertyHistoryEvent[] | undefined;
  loading: boolean;
  error: boolean;
  fetching: boolean;
  onRetry: () => void;
  createdByName: string | null;
}) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const { property, recent_key_movements: keyMovements } = workspace;
  const items = useMemo<TimelineItem[]>(() => {
    const fromEvents = (events ?? []).map((event): TimelineItem => ({
      id: event.id,
      title: event.title,
      detail: typeof event.metadata?.message === "string" ? event.metadata.message : null,
      at: event.created_at,
      category: historyCategory(event.type),
    }));
    const fromKeys = normalizedResourcesAvailable
      ? keyMovements.map((movement): TimelineItem => ({
          id: `key-${movement.id}`,
          title: `Chave: ${KEY_MOVEMENT_LABELS[movement.movement_type] ?? "movimentação"}`,
          detail: [movement.holder_name, movement.to_location || movement.from_location].filter(Boolean).join(" · ") || null,
          at: movement.occurred_at,
          category: "keys",
        }))
      : [];
    return [...fromEvents, ...fromKeys].sort((left, right) => right.at.localeCompare(left.at));
  }, [events, keyMovements, normalizedResourcesAvailable]);
  const visible = filter === "all" ? items : items.filter((item) => item.category === filter);
  const systemFields = filledFields([
    { label: "Criado em", value: formatPropertyDate(property.created_at, true) },
    { label: "Atualizado em", value: formatPropertyDate(property.updated_at, true) },
    { label: "Criado por", value: createdByName },
    { label: "Origem", value: hasField(property, "external_provider") ? (property.external_provider ? `Importado de ${property.external_provider}` : "Cadastro manual") : null },
  ]);

  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      <Panel title="O que aconteceu neste imóvel">
        <PropertyChipTabs value={filter} onChange={setFilter} options={FILTERS} ariaLabel="Filtrar histórico" />
        <div className="mt-3">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : error ? (
            <div role="alert" className="rounded-[8px] bg-destructive/10 p-3 text-[12px] font-light text-destructive">
              Não foi possível carregar o histórico.
              <Button type="button" variant="ghost" className={cn(PROPERTY_SECONDARY_BUTTON_CLASS, "ml-2")} disabled={fetching} onClick={onRetry}>
                {fetching ? "Tentando novamente" : "Tentar novamente"}
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <EmptyNote>Nenhuma alteração registrada.</EmptyNote>
          ) : (
            <ul className="divide-y divide-[var(--app-border)]">
              {visible.map((item) => {
                const Icon = CATEGORY_ICONS[item.category];
                return (
                  <li key={item.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--app-text-secondary)]", PANEL_SOFT)}>
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-[13px] font-light text-[var(--app-text-primary)]">{item.title}</p>
                      <p className="whitespace-pre-wrap text-[12px] font-light text-[var(--app-text-secondary)]">
                        {item.detail || HISTORY_CATEGORY_LABELS[item.category]}
                      </p>
                    </div>
                    <time dateTime={item.at} className="shrink-0 text-[11px] font-light text-[var(--app-text-tertiary)]">
                      {formatPropertyDate(item.at, true)}
                    </time>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Panel>
      <Panel title="Dados do sistema" className="self-start">
        <PropertyFieldGrid fields={systemFields} columns={2} />
        {canManage && <TechnicalIdentifiers workspace={workspace} />}
      </Panel>
    </div>
  );
}
