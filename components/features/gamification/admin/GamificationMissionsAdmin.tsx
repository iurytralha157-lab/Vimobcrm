"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Pencil, Plus, Target, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
  GamificationActionType,
  GamificationAdminSnapshot,
  GamificationMission,
} from "@/hooks/gamification";

import {
  ACTION_OPTIONS,
  type GamificationAdminController,
  type MissionDraft,
  getEventLabel,
} from "../gamification-domain";
import {
  ConfirmActionDialog,
  EmptyPanel,
  Field,
  PanelTitle,
} from "../GamificationUi";

export function GamificationMissionsAdmin({
  missions,
  users,
  admin,
}: {
  missions: GamificationMission[];
  users: GamificationAdminSnapshot["users"];
  admin: GamificationAdminController;
}) {
  const [form, setForm] = useState<MissionDraft>({
    title: "",
    description: "",
    actionType: "call_made",
    targetCount: 10,
    bonusPoints: 100,
    period: "daily",
    targetScope: "organization" as "organization" | "user",
    targetUserId: "",
    isActive: true,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [missionToDelete, setMissionToDelete] =
    useState<GamificationMission | null>(null);
  const editingMissionHasProgress = editingId
    ? missions.some(
        (mission) => mission.id === editingId && mission.currentProgress > 0,
      )
    : false;
  const missionFormPending =
    admin.createMission.isPending || admin.updateMission.isPending;

  const resetForm = () => {
    setEditingId(null);
    setForm({
      title: "",
      description: "",
      actionType: "call_made",
      targetCount: 10,
      bonusPoints: 100,
      period: "daily",
      targetScope: "organization",
      targetUserId: "",
      isActive: true,
    });
  };

  const startEdit = (mission: GamificationMission) => {
    setEditingId(mission.id);
    setForm({
      title: mission.title,
      description: mission.description || "",
      actionType: mission.actionType || "call_made",
      targetCount: mission.targetCount || 1,
      bonusPoints: mission.bonusPoints || 0,
      period: mission.period || "daily",
      targetScope: mission.targetScope === "user" ? "user" : "organization",
      targetUserId: mission.targetUserId || "",
      isActive: mission.isActive,
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      title: form.title,
      description: form.description || null,
      actionType: form.actionType,
      targetCount: form.targetCount,
      bonusPoints: form.bonusPoints,
      period: form.period,
      targetScope: form.targetScope,
      targetUserId: form.targetScope === "user" ? form.targetUserId : null,
      isActive: form.isActive,
    };
    if (editingId) {
      admin.updateMission.mutate(
        { id: editingId, mission: payload },
        { onSuccess: resetForm },
      );
      return;
    }
    admin.createMission.mutate(payload, { onSuccess: resetForm });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <form onSubmit={submit} className="app-card space-y-4 p-4">
        <PanelTitle
          icon={Plus}
          eyebrow="Missões"
          title={editingId ? "Editar missão" : "Nova missão"}
          showIcon={false}
        />
        {editingMissionHasProgress && (
          <p
            className="rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"
            role="note"
          >
            Esta missão já possui progresso. Ação, período, meta, bônus e
            público ficam bloqueados para preservar o histórico.
          </p>
        )}
        <Field label="Título">
          <Input
            value={form.title}
            disabled={missionFormPending}
            onChange={(event) =>
              setForm({ ...form, title: event.target.value })
            }
            required
          />
        </Field>
        <Field label="Descrição">
          <Input
            value={form.description}
            disabled={missionFormPending}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ação">
            <Select
              disabled={editingMissionHasProgress || missionFormPending}
              value={form.actionType}
              onValueChange={(value) =>
                setForm({
                  ...form,
                  actionType: value as GamificationActionType,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
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
          <Field label="Período">
            <Select
              disabled={editingMissionHasProgress || missionFormPending}
              value={form.period}
              onValueChange={(value) => setForm({ ...form, period: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Diário</SelectItem>
                <SelectItem value="weekly">Semanal</SelectItem>
                <SelectItem value="monthly">Mensal</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Meta">
            <Input
              type="number"
              min={1}
              disabled={editingMissionHasProgress || missionFormPending}
              value={form.targetCount}
              onChange={(event) =>
                setForm({
                  ...form,
                  targetCount: Number(event.target.value) || 1,
                })
              }
            />
          </Field>
          <Field label="Bônus">
            <Input
              type="number"
              min={0}
              disabled={editingMissionHasProgress || missionFormPending}
              value={form.bonusPoints}
              onChange={(event) =>
                setForm({
                  ...form,
                  bonusPoints: Number(event.target.value) || 0,
                })
              }
            />
          </Field>
        </div>
        <Field label="Público">
          <Select
            disabled={editingMissionHasProgress || missionFormPending}
            value={form.targetScope}
            onValueChange={(value: "organization" | "user") =>
              setForm({ ...form, targetScope: value, targetUserId: "" })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="organization">Toda a equipe</SelectItem>
              <SelectItem value="user">Pessoa específica</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {form.targetScope === "user" && (
          <Field label="Participante">
            <Select
              disabled={editingMissionHasProgress || missionFormPending}
              value={form.targetUserId}
              onValueChange={(value) =>
                setForm({ ...form, targetUserId: value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {users.length === 0 ? (
                  <SelectItem value="unavailable" disabled>
                    Nenhum participante disponível
                  </SelectItem>
                ) : (
                  users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </Field>
        )}
        <div className="flex gap-2">
          {editingId && (
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={resetForm}
              disabled={missionFormPending}
            >
              Cancelar
            </Button>
          )}
          <Button
            type="submit"
            className="flex-1"
            disabled={
              missionFormPending ||
              form.title.trim().length < 2 ||
              (form.targetScope === "user" && !form.targetUserId)
            }
          >
            {missionFormPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {editingId ? "Salvar missão" : "Criar missão"}
          </Button>
        </div>
      </form>

      <section className="app-card p-4">
        <PanelTitle
          icon={Target}
          eyebrow="Missões"
          title="Missões configuradas"
        />
        <div className="mt-4 space-y-3">
          {missions.length === 0 ? (
            <EmptyPanel title="Nenhuma missão criada ainda" compact />
          ) : (
            missions.map((mission) => (
              <div
                key={mission.id}
                className="rounded-md bg-[var(--app-surface-soft)] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {mission.title}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {mission.description || "Sem descrição"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={mission.isActive ? "default" : "secondary"}>
                      {mission.isActive ? "Ativa" : "Inativa"}
                    </Badge>
                    <Switch
                      checked={mission.isActive}
                      disabled={admin.updateMission.isPending}
                      onCheckedChange={(checked) =>
                        admin.updateMission.mutate({
                          id: mission.id,
                          mission: {
                            title: mission.title,
                            description: mission.description || null,
                            actionType: mission.actionType || "call_made",
                            targetCount: mission.targetCount,
                            bonusPoints: mission.bonusPoints,
                            period: mission.period || "daily",
                            targetScope:
                              mission.targetScope === "user"
                                ? "user"
                                : "organization",
                            targetUserId:
                              mission.targetScope === "user"
                                ? mission.targetUserId
                                : null,
                            isActive: checked,
                          },
                        })
                      }
                      aria-label={`${mission.isActive ? "Desativar" : "Ativar"} missão ${mission.title}`}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => startEdit(mission)}
                      disabled={
                        admin.updateMission.isPending ||
                        admin.deleteMission.isPending
                      }
                      aria-label={`Editar missão ${mission.title}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={
                        admin.updateMission.isPending ||
                        admin.deleteMission.isPending
                      }
                      onClick={() => setMissionToDelete(mission)}
                      aria-label={`Excluir missão ${mission.title}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                  <span>
                    Ação:{" "}
                    {mission.actionType
                      ? getEventLabel(mission.actionType)
                      : "--"}
                  </span>
                  <span>Meta: {mission.targetCount}</span>
                  <span>Bônus: +{mission.bonusPoints}</span>
                  <span>Período: {mission.period || "--"}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
      <ConfirmActionDialog
        open={missionToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setMissionToDelete(null);
        }}
        title="Excluir missão?"
        description={
          missionToDelete
            ? `A missão “${missionToDelete.title}” será excluída permanentemente.`
            : "Esta ação não pode ser desfeita."
        }
        confirmLabel="Excluir missão"
        destructive
        isPending={admin.deleteMission.isPending}
        onConfirm={() => {
          if (!missionToDelete) return;
          admin.deleteMission.mutate(missionToDelete.id, {
            onSuccess: () => setMissionToDelete(null),
          });
        }}
      />
    </div>
  );
}
