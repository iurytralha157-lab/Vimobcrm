"use client";

import { useState } from "react";
import {
  Award,
  Calendar,
  ClipboardCheck,
  FileCheck,
  FileText,
  Flag,
  Home,
  Loader2,
  MessageSquare,
  Phone,
  RotateCcw,
  Save,
  Settings,
  ShieldOff,
  Target,
  Trophy,
  UserCheck,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import type {
  GamificationAdminSnapshot,
  GamificationRule,
} from "@/hooks/gamification";
import { getFriendlyErrorMessage } from "@/lib/error-handler";

import type { GamificationAdminController } from "./gamification-domain";
import { getEventLabel } from "./gamification-domain";
import { ConfigTab, EmptyPanel, PanelTitle } from "./GamificationUi";
import { GamificationManualEntriesAdmin } from "./admin/GamificationManualEntriesAdmin";
import { GamificationMissionsAdmin } from "./admin/GamificationMissionsAdmin";
import {
  GamificationParticipantsAdmin,
  GamificationSeasonsAdmin,
} from "./admin/GamificationPeopleAdmin";

const RULE_ICONS: Record<string, LucideIcon> = {
  call_made: Phone,
  message_sent: MessageSquare,
  contact_made: UserCheck,
  visit_scheduled: Calendar,
  visit_confirmed: ClipboardCheck,
  meeting_scheduled: Calendar,
  meeting_held: Users,
  proposal_sent: FileText,
  sale_closed: Award,
  contract_signed: FileCheck,
  lost_lead_recovered: RotateCcw,
  lead_created: UserPlus,
  lead_created_manual: UserPlus,
  property_created: Home,
};

export function GamificationAdmin({
  admin,
  snapshot,
  isLoading,
}: {
  admin: GamificationAdminController;
  snapshot: GamificationAdminSnapshot;
  isLoading: boolean;
}) {
  if (admin.error && !admin.snapshot) {
    return (
      <div
        className="app-card flex min-h-[220px] flex-col items-center justify-center px-6 text-center"
        role="alert"
      >
        <ShieldOff
          className="mb-3 h-8 w-8 text-destructive"
          aria-hidden="true"
        />
        <p className="text-sm font-medium">
          Não foi possível verificar o acesso administrativo.
        </p>
        <p className="mt-2 max-w-md text-xs text-muted-foreground">
          {getFriendlyErrorMessage(admin.error)}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => void admin.refetch()}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="app-card flex min-h-[260px] items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        Carregando configurações da arena...
      </div>
    );
  }

  if (!snapshot.canManage) {
    return (
      <div className="app-card flex min-h-[220px] flex-col items-center justify-center text-center text-muted-foreground">
        <ShieldOff className="mb-3 h-8 w-8 opacity-40" />
        <p className="text-sm font-medium">
          Você não possui a permissão de gerenciar gamificação.
        </p>
      </div>
    );
  }

  return (
    <Tabs defaultValue="rules" className="space-y-5">
      <div>
        <p className="text-[10px] font-normal text-primary">Configuração</p>
        <h1 className="mt-1 text-2xl font-medium tracking-tight">
          Gestão de gamificação
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ajuste regras, missões, participantes, temporada e aprovações manuais.
        </p>
      </div>

      <div data-collapse="wide" className="app-responsive-tab-list min-w-0">
        <TabsList
          data-responsive-tab-scroll
          aria-label="Configurações de gamificação"
          className="inline-flex h-auto w-fit max-w-full justify-start gap-1 overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1"
        >
          <ConfigTab value="rules" icon={Settings} label="Regras" />
          <ConfigTab value="missions" icon={Target} label="Missões" />
          <ConfigTab value="participants" icon={Users} label="Participantes" />
          <ConfigTab value="seasons" icon={Flag} label="Temporada" />
          <ConfigTab value="manual" icon={ClipboardCheck} label="Aprovações" />
        </TabsList>
      </div>

      <TabsContent value="rules" className="mt-0">
        <RulesAdmin rules={snapshot.rules} admin={admin} />
      </TabsContent>
      <TabsContent value="missions" className="mt-0">
        <GamificationMissionsAdmin
          missions={snapshot.missions}
          users={snapshot.users}
          admin={admin}
        />
      </TabsContent>
      <TabsContent value="participants" className="mt-0">
        <GamificationParticipantsAdmin
          participants={snapshot.participants}
          admin={admin}
        />
      </TabsContent>
      <TabsContent value="seasons" className="mt-0">
        <GamificationSeasonsAdmin seasons={snapshot.seasons} admin={admin} />
      </TabsContent>
      <TabsContent value="manual" className="mt-0">
        <GamificationManualEntriesAdmin snapshot={snapshot} admin={admin} />
      </TabsContent>
    </Tabs>
  );
}

function RulesAdmin({
  rules,
  admin,
}: {
  rules: GamificationRule[];
  admin: GamificationAdminController;
}) {
  const [editing, setEditing] = useState<Record<string, number>>({});

  return (
    <section className="app-card p-4">
      <PanelTitle
        icon={Settings}
        eyebrow="Configuração"
        title="Regras de pontuação"
        showIcon={false}
      />
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {rules.length === 0 ? (
          <div className="md:col-span-2">
            <EmptyPanel title="Nenhuma regra de pontuação disponível" compact />
          </div>
        ) : (
          rules.map((rule) => {
            const Icon = RULE_ICONS[rule.actionType] || Trophy;
            const points = editing[rule.actionType] ?? rule.points;
            return (
              <div
                key={rule.actionType}
                className="flex items-center justify-between gap-3 rounded-md bg-[var(--app-surface-soft)] p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {getEventLabel(rule.actionType)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {rule.isActive ? "Ativa" : "Inativa"}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={100000}
                    className="h-9 w-20"
                    value={points}
                    disabled={admin.upsertRule.isPending}
                    onChange={(event) =>
                      setEditing((current) => ({
                        ...current,
                        [rule.actionType]: Number(event.target.value) || 0,
                      }))
                    }
                  />
                  <Switch
                    checked={rule.isActive}
                    disabled={admin.upsertRule.isPending}
                    onCheckedChange={(checked) =>
                      admin.upsertRule.mutate({
                        actionType: rule.actionType,
                        points,
                        isActive: checked,
                      })
                    }
                    aria-label={`${rule.isActive ? "Desativar" : "Ativar"} regra ${getEventLabel(rule.actionType)}`}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      admin.upsertRule.mutate({
                        actionType: rule.actionType,
                        points,
                        isActive: rule.isActive,
                      })
                    }
                    disabled={admin.upsertRule.isPending}
                    aria-label={`Salvar pontos de ${getEventLabel(rule.actionType)}`}
                  >
                    <Save className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
