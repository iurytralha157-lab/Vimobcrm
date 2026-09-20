import { AlertCircle, ChevronDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { DistributionQueueSettings } from "@/lib/round-robin/distribution-queue-form";
import { cn } from "@/lib/utils";

interface DistributionQueueRedistributionSectionProps {
  open: boolean;
  settings: DistributionQueueSettings;
  eligibleUserCount: number;
  onToggle: () => void;
  onEnabledChange: (checked: boolean) => void;
  onTimeoutChange: (minutes: number) => void;
  onWarningChange: (minutes: number) => void;
  onMaxAttemptsChange: (attempts: number) => void;
  onReentryBehaviorChange: (behavior: "redistribute" | "keep_assignee") => void;
}

export function DistributionQueueRedistributionSection({
  open,
  settings,
  eligibleUserCount,
  onToggle,
  onEnabledChange,
  onTimeoutChange,
  onWarningChange,
  onMaxAttemptsChange,
  onReentryBehaviorChange,
}: DistributionQueueRedistributionSectionProps) {
  return (
    <Collapsible
      data-tour="distribution-queue-redistribution"
      open={open}
      onOpenChange={onToggle}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-[6px] border-0 bg-[var(--app-surface-muted)] px-3 py-2 text-left transition-colors hover:bg-[var(--app-surface-hover)] data-[state=open]:bg-primary/10">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-primary/50 text-white">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">Redistribuição</span>
            <span className="block truncate text-[10px] font-light text-[var(--app-text-tertiary)]">
              Retorno do lead e prazo sem atendimento
            </span>
          </span>
          {settings.enable_redistribution && (
            <Badge className="h-5 shrink-0 rounded-[5px] border-0 bg-primary/50 px-1.5 text-[10px] font-light text-white shadow-none hover:bg-primary/50">
              Ativa
            </Badge>
          )}
        </div>
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-0.5 pt-2.5">
        <section className="rounded-[7px] bg-[var(--app-surface-soft)] p-3">
          <div className="mb-2">
            <Label className="text-[12px]">Retorno do mesmo lead</Label>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              Escolha se uma nova entrada mantém o responsável atual ou volta
              para a ordem da fila.
            </p>
          </div>
          <Select
            value={settings.reentry_behavior ?? "redistribute"}
            onValueChange={(value) => {
              if (value === "redistribute" || value === "keep_assignee") {
                onReentryBehaviorChange(value);
              }
            }}
          >
            <SelectTrigger
              aria-label="Comportamento quando o mesmo lead retornar"
              className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[12px] font-light shadow-none"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="redistribute">
                Redistribuir pela fila
              </SelectItem>
              <SelectItem value="keep_assignee">
                Manter o responsável atual
              </SelectItem>
            </SelectContent>
          </Select>
        </section>

        <section className="rounded-[7px] bg-[var(--app-surface-soft)] p-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="distribution-inactivity-redistribution">
                Redistribuição por inatividade
              </Label>
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                Se ninguém atender ou movimentar o lead no prazo, ele segue
                para o próximo participante.
              </p>
            </div>
            <Switch
              id="distribution-inactivity-redistribution"
              aria-label="Ativar redistribuição por inatividade"
              checked={Boolean(settings.enable_redistribution)}
              onCheckedChange={onEnabledChange}
            />
          </div>

          {settings.enable_redistribution && (
            <div className="mt-3 space-y-3 border-t border-[var(--app-border)] pt-3">
              <p
                role={eligibleUserCount < 2 ? "alert" : "status"}
                className={cn(
                  "rounded-[6px] px-3 py-2 text-[11px] leading-4",
                  eligibleUserCount < 2
                    ? "bg-destructive/10 text-destructive"
                    : "bg-[var(--app-surface-solid)] text-muted-foreground",
                )}
              >
                {eligibleUserCount < 2
                  ? `Adicione pelo menos dois corretores ativos. Esta fila possui ${eligibleUserCount}.`
                  : `${eligibleUserCount} corretores ativos podem receber a redistribuição.`}{" "}
                Equipes inativas e usuários sem acesso são ignorados.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="distribution-timeout">
                    Prazo sem atendimento
                  </Label>
                  <Input
                    id="distribution-timeout"
                    aria-label="Prazo sem atendimento em minutos"
                    type="number"
                    min={1}
                    value={settings.redistribution_timeout_minutes ?? 20}
                    onChange={(event) =>
                      onTimeoutChange(
                        Math.max(1, Number(event.target.value) || 20),
                      )
                    }
                    className="h-9 border-0 bg-[var(--app-surface-solid)] shadow-none"
                  />
                  <p className="text-[10px] text-muted-foreground">Minutos</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="distribution-warning">Avisar antes</Label>
                  <Input
                    id="distribution-warning"
                    aria-label="Antecedência do aviso em minutos"
                    type="number"
                    min={0}
                    value={settings.redistribution_warning_minutes ?? 5}
                    onChange={(event) =>
                      onWarningChange(
                        Math.max(0, Number(event.target.value) || 0),
                      )
                    }
                    className="h-9 border-0 bg-[var(--app-surface-solid)] shadow-none"
                  />
                  <p className="text-[10px] text-muted-foreground">Minutos</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="distribution-attempts">
                    Máximo de tentativas
                  </Label>
                  <Input
                    id="distribution-attempts"
                    aria-label="Máximo de tentativas de redistribuição"
                    type="number"
                    min={0}
                    value={settings.redistribution_max_attempts ?? 10}
                    onChange={(event) =>
                      onMaxAttemptsChange(
                        Math.max(0, Number(event.target.value) || 0),
                      )
                    }
                    className="h-9 border-0 bg-[var(--app-surface-solid)] shadow-none"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Use 0 para não limitar
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>
      </CollapsibleContent>
    </Collapsible>
  );
}
