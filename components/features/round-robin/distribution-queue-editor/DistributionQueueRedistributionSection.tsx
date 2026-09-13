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
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-[6px] border-0 bg-[var(--app-surface-muted)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--app-surface-hover)] data-[state=open]:bg-primary/10">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-primary" />
          <span className="font-medium">Redistribuicao</span>
          {settings.enable_redistribution && (
            <Badge variant="secondary" className="text-xs">
              Ativa
            </Badge>
          )}
        </div>
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-0.5 pt-2.5">
        <div className="space-y-4 rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-4">
          <div className="space-y-2">
            <Label>Quando um lead já existente retornar</Label>
            <Select
              value={settings.reentry_behavior ?? "redistribute"}
              onValueChange={(value) => {
                if (value === "redistribute" || value === "keep_assignee") {
                  onReentryBehaviorChange(value);
                }
              }}
            >
              <SelectTrigger className="bg-[var(--app-surface-solid)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="redistribute">
                  Redistribuir novamente pela fila
                </SelectItem>
                <SelectItem value="keep_assignee">
                  Manter o responsável atual
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Controla novas entradas válidas do mesmo lead sem criar um contato
              duplicado.
            </p>
          </div>

          <div className="border-t border-[var(--app-border)] pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label>Ativar redistribuicao de lead parado</Label>
                <p className="text-xs text-muted-foreground">
                  Se o responsavel nao fizer contato nem movimentar o proprio
                  lead no prazo, o sistema envia para o proximo participante da
                  fila.
                </p>
              </div>
              <Switch
                checked={Boolean(settings.enable_redistribution)}
                onCheckedChange={onEnabledChange}
              />
            </div>

            {settings.enable_redistribution && (
              <div className="space-y-3">
                <p className="rounded-md bg-background px-3 py-2 text-xs text-muted-foreground">
                  A fila so sera ativada se houver pelo menos dois corretores
                  elegiveis. Equipes inativas e participantes sem acesso a
                  organizacao sao ignorados.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Tempo</Label>
                    <Input
                      type="number"
                      min={1}
                      value={settings.redistribution_timeout_minutes ?? 20}
                      onChange={(event) =>
                        onTimeoutChange(
                          Math.max(1, Number(event.target.value) || 20),
                        )
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Minutos.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Aviso</Label>
                    <Input
                      type="number"
                      min={0}
                      value={settings.redistribution_warning_minutes ?? 5}
                      onChange={(event) =>
                        onWarningChange(
                          Math.max(0, Number(event.target.value) || 0),
                        )
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Minutos antes.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Tentativas</Label>
                    <Input
                      type="number"
                      min={0}
                      value={settings.redistribution_max_attempts ?? 10}
                      onChange={(event) =>
                        onMaxAttemptsChange(
                          Math.max(0, Number(event.target.value) || 0),
                        )
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">
                      0 sem limite.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
