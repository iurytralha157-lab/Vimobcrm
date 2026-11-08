"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { EmptyNote, Panel } from "@/components/features/marketing/marketing-ui";
import { Button } from "@/components/ui/button";
import { usePropertyKeyMovements } from "@/hooks/properties/use-property-key-movements";
import { formatPropertyDate } from "@/lib/property-display-utils";
import type { PropertyKeyMovementHistoryItem, PropertyKeyMovementListQuery } from "@/lib/validation";
import { cn } from "@/lib/utils";

import { PROPERTY_SECONDARY_BUTTON_CLASS, PropertyChipTabs } from "../../property-ui";
import { KEY_MOVEMENT_LABELS } from "../property-workspace-model";

type MovementFilter = "all" | NonNullable<PropertyKeyMovementListQuery["type"]>;

const FILTERS: Array<{ value: MovementFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "checkout", label: "Retiradas" },
  { value: "return", label: "Devoluções" },
  { value: "transfer", label: "Transferências" },
  { value: "mark_lost", label: "Perdas" },
  { value: "registration", label: "Cadastros" },
];

const DOT_TONES: Record<string, string> = {
  checkout: "bg-primary",
  return: "bg-emerald-500",
  mark_lost: "bg-destructive",
};

function movementLines(movement: PropertyKeyMovementHistoryItem) {
  const who = [movement.holder_name || movement.actor_name, movement.reason].filter(Boolean).join(", ");
  const where = movement.from_location && movement.to_location && movement.from_location !== movement.to_location
    ? `De ${movement.from_location} para ${movement.to_location}`
    : movement.to_location || movement.from_location;
  const notes = [
    movement.expected_return_at ? `Devolver até ${formatPropertyDate(movement.expected_return_at, true)}` : null,
    where,
    movement.notes,
  ].filter(Boolean).join(" · ");
  return { who, notes };
}

export function KeyMovementTimeline({ propertyId, enabled }: { propertyId: string; enabled: boolean }) {
  const [filter, setFilter] = useState<MovementFilter>("all");
  const query = usePropertyKeyMovements(propertyId, filter === "all" ? undefined : filter, enabled);
  const pages = query.data?.pages ?? [];
  const movements = pages.flatMap((page) => page.data);
  // Custody is manager-only: other viewers get an empty page and no panel at all.
  if (pages[0]?.meta.can_view_key_custody === false) return null;

  return (
    <Panel title="Histórico de movimentações" aside="Quem pegou, quando e por quê">
      <PropertyChipTabs value={filter} onChange={setFilter} options={FILTERS} ariaLabel="Filtrar movimentações" />
      <div className="mt-3">
        {query.isLoading ? (
          <EmptyNote>Carregando movimentações…</EmptyNote>
        ) : query.isError ? (
          <div role="alert" className="rounded-[8px] bg-destructive/10 p-3 text-[12px] font-light text-destructive">
            Não foi possível carregar as movimentações.
            <Button type="button" variant="ghost" className={cn(PROPERTY_SECONDARY_BUTTON_CLASS, "ml-2")} onClick={() => void query.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : movements.length === 0 ? (
          <EmptyNote>Nenhuma movimentação registrada.</EmptyNote>
        ) : (
          <ol className="relative space-y-3 before:absolute before:bottom-1 before:left-[3.5px] before:top-1 before:w-px before:bg-[var(--app-border)]">
            {movements.map((movement) => {
              const { who, notes } = movementLines(movement);
              return (
                <li key={movement.id} className="relative flex items-start gap-3 pl-5">
                  <span className={cn("absolute left-0 top-1.5 h-2 w-2 rounded-full", DOT_TONES[movement.movement_type] ?? "bg-[var(--app-text-tertiary)]")} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-light text-[var(--app-text-primary)]">
                      {KEY_MOVEMENT_LABELS[movement.movement_type]} · {movement.key_name}
                    </p>
                    {who && <p className="text-[12px] font-light text-[var(--app-text-secondary)]">{who}</p>}
                    {notes && <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">{notes}</p>}
                  </div>
                  <time dateTime={movement.occurred_at} className="shrink-0 text-[11px] font-light text-[var(--app-text-tertiary)]">
                    {formatPropertyDate(movement.occurred_at, true)}
                  </time>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {query.hasNextPage && (
        <Button
          type="button"
          variant="ghost"
          disabled={query.isFetchingNextPage}
          className={cn(PROPERTY_SECONDARY_BUTTON_CLASS, "mt-3")}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Carregar mais
        </Button>
      )}
    </Panel>
  );
}
