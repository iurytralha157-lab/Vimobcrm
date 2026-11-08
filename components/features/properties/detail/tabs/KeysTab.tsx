"use client";

import { KeyRound, Plus } from "lucide-react";

import { KpiCard, KpiRow, Panel } from "@/components/features/marketing/marketing-ui";
import { formatCount } from "@/components/features/marketing/marketing-format";
import { Button } from "@/components/ui/button";
import { formatPropertyDate } from "@/lib/property-display-utils";
import type { PropertyKeyMovementType, PropertyWorkspaceKey } from "@/lib/validation";
import { cn } from "@/lib/utils";

import {
  PROPERTY_PRIMARY_BUTTON_CLASS,
  PROPERTY_SECONDARY_BUTTON_CLASS,
  PropertyChip,
  PropertyFieldGrid,
  filledFields,
  type PropertyChipTone,
} from "../../property-ui";
import { countOverdueKeys, hasField, type WorkspaceProperty } from "../property-workspace-model";
import { KeyMovementTimeline } from "./KeyMovementTimeline";

export type ActionableKeyMovement = Exclude<PropertyKeyMovementType, "registration">;

const KEY_STATUS: Record<string, { label: string; tone: PropertyChipTone }> = {
  available: { label: "Disponível", tone: "success" },
  checked_out: { label: "Com corretor", tone: "warning" },
  lost: { label: "Perdida", tone: "danger" },
  inactive: { label: "Inativa", tone: "neutral" },
};

function KeyActions({
  propertyKey,
  onMove,
}: {
  propertyKey: PropertyWorkspaceKey;
  onMove: (key: PropertyWorkspaceKey, type: ActionableKeyMovement) => void;
}) {
  const action = (type: ActionableKeyMovement, label: string, primary = false) => (
    <Button
      key={type}
      type="button"
      variant={primary ? "default" : "ghost"}
      className={primary ? PROPERTY_PRIMARY_BUTTON_CLASS : PROPERTY_SECONDARY_BUTTON_CLASS}
      onClick={() => onMove(propertyKey, type)}
    >
      {label}
    </Button>
  );
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {propertyKey.status === "available" && [
        action("checkout", "Registrar retirada", true),
        action("location_change", "Mudar local"),
        action("mark_lost", "Marcar como perdida"),
      ]}
      {propertyKey.status === "checked_out" && [
        action("return", "Registrar devolução", true),
        action("transfer", "Transferir"),
      ]}
      {propertyKey.status === "lost" && action("mark_found", "Registrar localização", true)}
      {propertyKey.status === "inactive" ? action("reactivate", "Reativar") : action("deactivate", "Desativar")}
    </div>
  );
}

function KeyCard({
  propertyKey,
  canAct,
  onMove,
}: {
  propertyKey: PropertyWorkspaceKey;
  canAct: boolean;
  onMove: (key: PropertyWorkspaceKey, type: ActionableKeyMovement) => void;
}) {
  const status = KEY_STATUS[propertyKey.status];
  const fields = filledFields([
    { label: propertyKey.holder_name ? "Com quem" : "Onde está", value: propertyKey.holder_name || propertyKey.current_location || "Na imobiliária" },
    { label: "Local", value: propertyKey.holder_name ? propertyKey.current_location : null },
    { label: "Retirada", value: propertyKey.checked_out_at ? formatPropertyDate(propertyKey.checked_out_at, true) : null },
    { label: "Devolver até", value: propertyKey.expected_return_at ? formatPropertyDate(propertyKey.expected_return_at, true) : null },
    { label: "Código", value: propertyKey.key_code },
  ]);
  return (
    <Panel
      title={propertyKey.label}
      aside={<PropertyChip tone={status.tone}>{status.label}</PropertyChip>}
    >
      <PropertyFieldGrid fields={fields} columns={2} />
      {canAct && <KeyActions propertyKey={propertyKey} onMove={onMove} />}
    </Panel>
  );
}

export function KeysTab({
  property,
  keys,
  canManage,
  normalizedResourcesAvailable,
  active,
  onCreateKey,
  onMove,
}: {
  property: WorkspaceProperty;
  keys: PropertyWorkspaceKey[];
  canManage: boolean;
  normalizedResourcesAvailable: boolean;
  active: boolean;
  onCreateKey: () => void;
  onMove: (key: PropertyWorkspaceKey, type: ActionableKeyMovement) => void;
}) {
  const atOffice = keys.filter((key) => key.status === "available").length;
  const withBroker = keys.filter((key) => key.status === "checked_out");
  const overdue = countOverdueKeys(withBroker);
  const lost = keys.filter((key) => key.status === "lost").length;
  const canAct = canManage && normalizedResourcesAvailable;

  return (
    <div className="min-w-0 space-y-3">
      {!normalizedResourcesAvailable && (
        <Panel title="Local das chaves">
          <p className="text-[13px] font-light text-[var(--app-text-primary)]">
            {hasField(property, "local_chaves") && property.local_chaves
              ? property.local_chaves
              : "Informação não disponível para este perfil."}
          </p>
        </Panel>
      )}
      {keys.length > 0 && (
        <KpiRow>
          <KpiCard label="Conjuntos" value={formatCount(keys.length)} />
          <KpiCard label="Na imobiliária" value={formatCount(atOffice)} />
          <KpiCard label="Com corretor" value={formatCount(withBroker.length)} note={overdue > 0 ? `${overdue} com devolução atrasada` : undefined} />
          <KpiCard label="Perdidas" value={formatCount(lost)} />
        </KpiRow>
      )}
      <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {keys.map((key) => <KeyCard key={key.id} propertyKey={key} canAct={canAct} onMove={onMove} />)}
        {canAct ? (
          <button
            type="button"
            onClick={onCreateKey}
            className={cn(
              "flex min-h-[120px] items-center justify-center gap-2 rounded-[12px] border border-dashed border-[var(--app-border)] text-[13px] font-light text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
            )}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Cadastrar conjunto
          </button>
        ) : keys.length === 0 && normalizedResourcesAvailable ? (
          <div className="flex items-center gap-2 rounded-[12px] bg-[var(--app-surface-solid)] p-4 text-[13px] font-light text-[var(--app-text-secondary)] md:col-span-2">
            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
            Nenhuma chave cadastrada para este imóvel.
          </div>
        ) : null}
      </div>
      {normalizedResourcesAvailable && <KeyMovementTimeline propertyId={property.id} enabled={active} />}
    </div>
  );
}
