"use client";

import { useState, type FormEvent } from "react";
import { Flag, History, Loader2, RotateCcw, ShieldOff, Trophy, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
  GamificationParticipant,
  GamificationSeason,
} from "@/hooks/gamification";
import { cn } from "@/lib/utils";

import {
  type GamificationAdminController,
  formatDateTime,
  formatNumber,
} from "../gamification-domain";
import {
  ConfirmActionDialog,
  EmptyPanel,
  Field,
  PanelTitle,
} from "../GamificationUi";

export function GamificationParticipantsAdmin({
  participants,
  admin,
}: {
  participants: GamificationParticipant[];
  admin: GamificationAdminController;
}) {
  return (
    <section className="app-card p-4">
      <PanelTitle
        icon={Users}
        eyebrow="Admin"
        title="Participantes da competição"
      />
      <div className="mt-4 space-y-3">
        {participants.length === 0 ? (
          <EmptyPanel title="Nenhum participante disponível" compact />
        ) : (
          participants.map((participant) => (
            <div
              key={participant.userId}
              className="flex items-center justify-between gap-3 rounded-md bg-[var(--app-surface-soft)] p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">
                    {participant.name}
                  </p>
                  {participant.role === "admin" && (
                    <Badge variant="secondary">Admin</Badge>
                  )}
                  {!participant.isActive && (
                    <Badge variant="outline">Usuário inativo</Badge>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {participant.email}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <div className="hidden text-right sm:block">
                  <p className="text-xs font-medium">
                    {participant.participates
                      ? "Competindo"
                      : "Fora do ranking"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatNumber(participant.points)} pts
                  </p>
                </div>
                {participant.participates ? (
                  <Trophy className="h-4 w-4 text-primary" />
                ) : (
                  <ShieldOff className="h-4 w-4 text-muted-foreground" />
                )}
                <Switch
                  checked={participant.participates}
                  onCheckedChange={(checked) =>
                    admin.setParticipant.mutate({
                      userId: participant.userId,
                      participates: checked,
                    })
                  }
                  disabled={
                    admin.setParticipant.isPending || !participant.isActive
                  }
                  aria-label={`${participant.participates ? "Remover" : "Adicionar"} ${participant.name} do ranking`}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function GamificationSeasonsAdmin({
  seasons,
  admin,
}: {
  seasons: GamificationSeason[];
  admin: GamificationAdminController;
}) {
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const active = seasons.find((season) => season.isActive);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2 || reason.trim().length < 2) return;
    setConfirmResetOpen(true);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <form onSubmit={submit} className="app-card space-y-4 p-4">
        <PanelTitle
          icon={RotateCcw}
          eyebrow="Temporada"
          title="Iniciar nova temporada"
        />
        {active && (
          <div className="rounded-md bg-primary/10 p-3">
            <p className="text-xs text-muted-foreground">Em andamento</p>
            <p className="font-medium">{active.name}</p>
            <p className="text-xs text-muted-foreground">
              Início: {formatDateTime(active.startedAt)}
            </p>
          </div>
        )}
        <Field label="Nome">
          <Input
            value={name}
            disabled={admin.resetSeason.isPending}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        <Field label="Mensagem para equipe">
          <Textarea
            value={reason}
            disabled={admin.resetSeason.isPending}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
            required
            minLength={2}
          />
        </Field>
        <Button
          type="submit"
          disabled={
            admin.resetSeason.isPending ||
            name.trim().length < 2 ||
            reason.trim().length < 2
          }
        >
          {admin.resetSeason.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Flag className="h-4 w-4" />
          )}
          Iniciar temporada
        </Button>
      </form>

      <section className="app-card p-4">
        <PanelTitle icon={History} eyebrow="Temporadas" title="Histórico" />
        <div className="mt-4 space-y-3">
          {seasons.length === 0 ? (
            <EmptyPanel title="Nenhuma temporada registrada" compact />
          ) : (
            seasons.map((season) => (
              <div
                key={season.id}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-md p-3",
                  season.isActive
                    ? "bg-primary/10"
                    : "bg-[var(--app-surface-soft)]",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{season.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(season.startedAt)}{" "}
                    {season.endedAt
                      ? `- ${formatDateTime(season.endedAt)}`
                      : ""}
                  </p>
                </div>
                {season.isActive && <Badge>Ativa</Badge>}
              </div>
            ))
          )}
        </div>
      </section>
      <ConfirmActionDialog
        open={confirmResetOpen}
        onOpenChange={setConfirmResetOpen}
        title="Iniciar nova temporada?"
        description="O ranking da temporada atual será encerrado e uma nova disputa será iniciada. O histórico anterior será preservado."
        confirmLabel="Iniciar temporada"
        isPending={admin.resetSeason.isPending}
        onConfirm={() =>
          admin.resetSeason.mutate(
            { name: name.trim(), reason: reason.trim() },
            {
              onSuccess: () => {
                setConfirmResetOpen(false);
                setName("");
                setReason("");
              },
            },
          )
        }
      />
    </div>
  );
}
