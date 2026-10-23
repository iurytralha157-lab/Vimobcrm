"use client";

import { useState } from "react";
import { Loader2, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePropertyDevelopmentMaintenance } from "@/hooks/properties/use-property-development-maintenance";
import { VimobAPIError, stringifyErrorMessage } from "@/lib/api/vimob-error";
import type {
  PropertyDevelopmentMaintenanceKind,
  PropertyDevelopmentWorkspace,
} from "@/lib/validation";
import { DEVELOPMENT_MAINTENANCE_KIND_LABELS } from "@/components/features/properties/developments/development-maintenance-fields";

import { DevelopmentMaintenanceFields } from "@/components/features/properties/developments/DevelopmentMaintenanceFields";

export function DevelopmentMaintenanceDialog({
  workspace,
  onClose,
}: {
  workspace: PropertyDevelopmentWorkspace;
  onClose: () => void;
}) {
  // Refetches may change the server version while the user is typing. Only an
  // explicit reload may replace the record and its compare-and-swap version.
  const [snapshot, setSnapshot] = useState(() => structuredClone(workspace));
  const [kind, setKind] =
    useState<PropertyDevelopmentMaintenanceKind>("development");
  const [entityId, setEntityId] = useState(snapshot.development.id);
  const [dirty, setDirty] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const mutation = usePropertyDevelopmentMaintenance(
    snapshot.development.id,
    snapshot.development.organization_id,
  );
  const busy = mutation.isPending || refreshing;
  const records =
    kind === "development"
      ? [snapshot.development]
      : kind === "phase"
        ? snapshot.phases
        : kind === "building"
          ? snapshot.buildings
          : snapshot.floor_plans;
  const selected =
    records.find((record) => record.id === entityId) ?? records[0];
  const confirmDiscard = () =>
    !dirty ||
    window.confirm("Descartar as alterações que ainda não foram salvas?");
  const close = () => {
    if (!busy && confirmDiscard()) onClose();
  };
  const reload = async () => {
    if (busy || !confirmDiscard()) return;
    setRefreshing(true);
    try {
      const current = await mutation.reloadWorkspace();
      setSnapshot(structuredClone(current));
      setDirty(false);
      setConflicted(false);
      mutation.reset();
    } catch (error) {
      if (mutation.isCurrentScope()) toast.error(stringifyErrorMessage(error));
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-24px)] max-w-2xl flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none sm:p-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-normal">
            <PencilLine className="h-4 w-4 text-primary" />
            Editar cadastro
          </DialogTitle>
          <DialogDescription className="text-xs font-light">
            Atualize os dados e a situação do cadastro. Reservas e publicações
            ativas precisam ser encerradas antes de desativar a estrutura.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="maintenance-kind" className="text-xs">
              Cadastro
            </Label>
            <Select
              value={kind}
              disabled={busy || !mutation.scopeValid}
              onValueChange={(value) => {
                if (confirmDiscard()) {
                  setKind(value as PropertyDevelopmentMaintenanceKind);
                  setEntityId("");
                  setDirty(false);
                  setConflicted(false);
                  mutation.reset();
                }
              }}
            >
              <SelectTrigger id="maintenance-kind" className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DEVELOPMENT_MAINTENANCE_KIND_LABELS).map(
                  ([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="maintenance-entity" className="text-xs">
              Selecionar
            </Label>
            <Select
              value={selected?.id ?? ""}
              disabled={busy || !mutation.scopeValid || records.length === 0}
              onValueChange={(value) => {
                if (confirmDiscard()) {
                  setEntityId(value);
                  setDirty(false);
                  setConflicted(false);
                  mutation.reset();
                }
              }}
            >
              <SelectTrigger id="maintenance-entity" className="h-9 text-xs">
                <SelectValue placeholder="Nenhum cadastro" />
              </SelectTrigger>
              <SelectContent>
                {records.map((record) => (
                  <SelectItem key={record.id} value={record.id}>
                    {record.code} · {record.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {!mutation.scopeValid && (
          <p role="alert" className="text-xs text-destructive">
            Seu acesso mudou. Feche e abra o cadastro novamente.
          </p>
        )}
        {conflicted && mutation.scopeValid && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 text-xs"
          >
            <p className="flex-1 text-muted-foreground">
              A alteração conflitou com o cadastro atual. Recarregue e revise os
              dados, vínculos e reservas antes de tentar novamente.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={reload}
            >
              {refreshing && (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              )}
              Recarregar cadastro
            </Button>
          </div>
        )}
        {selected ? (
          <DevelopmentMaintenanceFields
            key={`${kind}-${selected.id}-${selected.updated_at}`}
            kind={kind}
            record={{ ...selected }}
            phases={snapshot.phases}
            pending={busy}
            scopeValid={mutation.scopeValid}
            onDirty={setDirty}
            onCancel={close}
            onSubmit={async (changes) => {
              try {
                await mutation.mutateAsync({
                  kind,
                  entityId: selected.id,
                  input: { expected_updated_at: selected.updated_at, changes },
                });
                if (mutation.isCurrentScope()) {
                  setDirty(false);
                  onClose();
                }
              } catch (error) {
                if (
                  error instanceof VimobAPIError &&
                  error.status === 409 &&
                  mutation.isCurrentScope()
                ) {
                  setConflicted(true);
                }
              }
            }}
          />
        ) : (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Nenhum cadastro disponível nesta categoria.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
