"use client";

import {
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { CheckCircle2, ClipboardCheck, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  GamificationActionType,
  GamificationAdminSnapshot,
  GamificationManualEntry,
} from "@/hooks/gamification";

import {
  ACTION_OPTIONS,
  type GamificationAdminController,
  type ManualEntryDraft,
  formatDateTime,
  getEventLabel,
} from "../gamification-domain";
import {
  ConfirmActionDialog,
  EmptyPanel,
  Field,
  ManualEntryStatusBadge,
  PanelTitle,
} from "../GamificationUi";

export function GamificationManualEntriesAdmin({
  snapshot,
  admin,
}: {
  snapshot: GamificationAdminSnapshot;
  admin: GamificationAdminController;
}) {
  const [form, setForm] = useState<ManualEntryDraft>({
    actionKey: "",
    quantity: 1,
    notes: "",
  });
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>(
    {},
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.actionKey) return;
    admin.createManualEntry.mutate(
      { ...form, actionKey: form.actionKey },
      {
        onSuccess: () => setForm({ actionKey: "", quantity: 1, notes: "" }),
      },
    );
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <form onSubmit={submit} className="app-card space-y-4 p-4">
        <PanelTitle
          icon={ClipboardCheck}
          eyebrow="Manual"
          title="Novo lançamento"
          showIcon={false}
        />
        <p className="text-sm text-muted-foreground">
          Aprovações são atividades enviadas pela equipe para validar pontos
          feitos fora do CRM.
        </p>
        <Field label="Tipo de atividade">
          <Select
            value={form.actionKey}
            disabled={admin.createManualEntry.isPending}
            onValueChange={(value) =>
              setForm({ ...form, actionKey: value as GamificationActionType })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {ACTION_OPTIONS.map((action) => (
                <SelectItem key={action} value={action}>
                  {getEventLabel(action)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Quantidade">
          <Input
            type="number"
            min={1}
            max={100}
            value={form.quantity}
            disabled={admin.createManualEntry.isPending}
            onChange={(event) =>
              setForm({ ...form, quantity: Number(event.target.value) || 1 })
            }
          />
        </Field>
        <Field label="Observações / evidência">
          <Textarea
            value={form.notes}
            disabled={admin.createManualEntry.isPending}
            onChange={(event) =>
              setForm({ ...form, notes: event.target.value })
            }
            rows={4}
          />
        </Field>
        <Button
          type="submit"
          className="w-full"
          disabled={admin.createManualEntry.isPending || !form.actionKey}
        >
          {admin.createManualEntry.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Enviar para aprovação
        </Button>
      </form>

      <section className="space-y-4">
        <ManualEntryList
          title="Fila de aprovações e concessões"
          entries={snapshot.pendingManualEntries}
          admin={admin}
          rejectReasons={rejectReasons}
          setRejectReasons={setRejectReasons}
        />
        <ManualEntryList
          title="Minhas últimas solicitações"
          entries={snapshot.myManualEntries}
          admin={admin}
        />
      </section>
    </div>
  );
}

function ManualEntryList({
  title,
  entries,
  admin,
  rejectReasons,
  setRejectReasons,
}: {
  title: string;
  entries: GamificationManualEntry[];
  admin: GamificationAdminController;
  rejectReasons?: Record<string, string>;
  setRejectReasons?: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  const [decision, setDecision] = useState<{
    entry: GamificationManualEntry;
    status: "approved" | "rejected";
  } | null>(null);

  const approveEntry = (entry: GamificationManualEntry) => {
    setDecision({ entry, status: "approved" });
  };

  const rejectEntry = (entry: GamificationManualEntry) => {
    const reason = rejectReasons?.[entry.id]?.trim() || "";
    if (!reason || !setRejectReasons) return;
    setDecision({ entry, status: "rejected" });
  };

  return (
    <div className="app-card p-4">
      <PanelTitle icon={ClipboardCheck} eyebrow="Manual" title={title} />
      <div className="mt-4 space-y-3">
        {entries.length === 0 ? (
          <EmptyPanel title="Nenhum lançamento encontrado" compact />
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-md bg-[var(--app-surface-soft)] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {entry.userName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {getEventLabel(entry.actionKey)} ({entry.quantity}x) -{" "}
                    {formatDateTime(entry.createdAt)}
                  </p>
                  {entry.notes && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {entry.notes}
                    </p>
                  )}
                  {entry.rejectionReason && (
                    <p className="mt-2 text-xs text-destructive">
                      {entry.rejectionReason}
                    </p>
                  )}
                </div>
                <ManualEntryStatusBadge entry={entry} />
              </div>

              {entry.status === "pending" &&
                rejectReasons &&
                setRejectReasons && (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => approveEntry(entry)}
                      disabled={admin.decideManualEntry.isPending}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Aprovar
                    </Button>
                    <Input
                      placeholder="Motivo da rejeição"
                      value={rejectReasons[entry.id] || ""}
                      disabled={admin.decideManualEntry.isPending}
                      onChange={(event) =>
                        setRejectReasons((current) => ({
                          ...current,
                          [entry.id]: event.target.value,
                        }))
                      }
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => rejectEntry(entry)}
                      disabled={
                        admin.decideManualEntry.isPending ||
                        !(rejectReasons[entry.id] || "").trim()
                      }
                    >
                      Rejeitar
                    </Button>
                  </div>
                )}
            </div>
          ))
        )}
      </div>
      <ConfirmActionDialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open) setDecision(null);
        }}
        title={
          decision?.status === "rejected"
            ? "Rejeitar lançamento?"
            : "Aprovar lançamento?"
        }
        description={
          decision
            ? decision.status === "rejected"
              ? "A solicitação será rejeitada com o motivo informado. Esta decisão não poderá ser alterada."
              : `${decision.entry.quantity} ocorrência(s) de ${getEventLabel(decision.entry.actionKey)} serão aprovadas e a pontuação será processada em seguida.`
            : "Revise a decisão antes de continuar."
        }
        confirmLabel={decision?.status === "rejected" ? "Rejeitar" : "Aprovar"}
        destructive={decision?.status === "rejected"}
        isPending={admin.decideManualEntry.isPending}
        onConfirm={() => {
          if (!decision) return;
          const reason = rejectReasons?.[decision.entry.id]?.trim();
          if (decision.status === "rejected" && !reason) return;
          admin.decideManualEntry.mutate(
            {
              id: decision.entry.id,
              status: decision.status,
              reason: decision.status === "rejected" ? reason : undefined,
            },
            {
              onSuccess: () => {
                if (decision.status === "rejected" && setRejectReasons) {
                  setRejectReasons((current) => ({
                    ...current,
                    [decision.entry.id]: "",
                  }));
                }
                setDecision(null);
              },
            },
          );
        }}
      />
    </div>
  );
}
