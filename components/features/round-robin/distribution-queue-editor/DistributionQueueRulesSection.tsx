import { ChevronDown, Filter, Plus, X } from "lucide-react";

import type { PropertyPickerProperty } from "@/components/features/properties/PropertyPickerDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { Tag } from "@/hooks/use-tags";
import type {
  RoundRobinMetaFormOption,
  RoundRobinWhatsAppSessionOption,
} from "@/lib/api/round-robins";
import type { WebhookIntegration } from "@/lib/api/webhooks";
import {
  isDistributionQueueConditionType,
  type DistributionQueueCondition,
  type DistributionQueueConditionType,
} from "@/lib/round-robin/distribution-queue-form";
import { queueIgnoresAvailability } from "@/lib/round-robin/member-context";
import { cn } from "@/lib/utils";

import { DistributionQueueConditionValueEditor } from "@/components/features/round-robin/distribution-queue-editor/DistributionQueueConditionValueEditor";

interface DistributionQueueRulesSectionProps {
  open: boolean;
  conditions: DistributionQueueCondition[];
  availableConditionTypes: readonly {
    value: DistributionQueueConditionType;
    label: string;
  }[];
  hasWhatsAppMessageCondition: boolean;
  hasValidCriteria: boolean;
  ignoreAvailability: boolean | undefined;
  incomingWebhooks: WebhookIntegration[];
  whatsappSessions: RoundRobinWhatsAppSessionOption[];
  activeWhatsAppSessions: RoundRobinWhatsAppSessionOption[];
  campaignWhatsAppSessions: RoundRobinWhatsAppSessionOption[];
  metaForms: RoundRobinMetaFormOption[];
  metaFormsLoading: boolean;
  metaFormsFetching: boolean;
  metaFormsError: boolean;
  queueId?: string;
  tags: Tag[];
  tagsLoading: boolean;
  tagsError: boolean;
  properties: PropertyPickerProperty[];
  hasPropertiesModule: boolean;
  onToggle: () => void;
  onAddCondition: () => void;
  onUpdateCondition: (
    conditionId: string,
    updates: Partial<DistributionQueueCondition>,
  ) => void;
  onRemoveCondition: (conditionId: string) => void;
  onIgnoreAvailabilityChange: (checked: boolean) => void;
}

export function DistributionQueueRulesSection({
  open,
  conditions,
  availableConditionTypes,
  hasWhatsAppMessageCondition,
  hasValidCriteria,
  ignoreAvailability,
  incomingWebhooks,
  whatsappSessions,
  activeWhatsAppSessions,
  campaignWhatsAppSessions,
  metaForms,
  metaFormsLoading,
  metaFormsFetching,
  metaFormsError,
  queueId,
  tags,
  tagsLoading,
  tagsError,
  properties,
  hasPropertiesModule,
  onToggle,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
  onIgnoreAvailabilityChange,
}: DistributionQueueRulesSectionProps) {
  return (
    <Collapsible
      data-tour="distribution-queue-rules"
      open={open}
      onOpenChange={onToggle}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-[6px] border-0 bg-[var(--app-surface-muted)] px-3 py-2 text-left transition-colors hover:bg-[var(--app-surface-hover)] data-[state=open]:bg-primary/10">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-primary/50 text-white">
            <Filter className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">Regras de entrada</span>
            <span className="block truncate text-[10px] font-light text-[var(--app-text-tertiary)]">
              Defina quais leads entram nesta fila
            </span>
          </span>
          {!hasValidCriteria ? (
            <Badge className="h-5 shrink-0 rounded-[5px] border-0 bg-primary/15 px-1.5 text-[10px] font-light text-primary shadow-none hover:bg-primary/15">
              Pendente
            </Badge>
          ) : (
            <Badge
              variant="secondary"
              className="h-5 shrink-0 rounded-[5px] border-0 px-1.5 text-[10px] font-light"
            >
              {conditions.length}
            </Badge>
          )}
        </div>
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-0.5 pt-3">
        {conditions.map((condition) => (
          <div
            key={condition.id}
            className={cn(
              "grid min-w-0 gap-3 rounded-[7px] bg-[var(--app-surface-muted)] p-3 sm:items-start",
              condition.type === "meta_form"
                ? "grid-cols-[minmax(0,1fr)_32px]"
                : "sm:grid-cols-[minmax(170px,210px)_minmax(0,1fr)_32px]",
            )}
          >
            <Select
              value={condition.type}
              onValueChange={(value) => {
                if (isDistributionQueueConditionType(value)) {
                  onUpdateCondition(condition.id, {
                    type: value,
                    values: [],
                    sessionId: undefined,
                  });
                }
              }}
            >
              <SelectTrigger
                className={cn(
                  "h-10 w-full min-w-0 border-0 bg-[var(--app-surface-solid)] text-[12px] shadow-none",
                  condition.type === "meta_form" && "max-w-[230px]",
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableConditionTypes.map((conditionType) => (
                  <SelectItem
                    key={conditionType.value}
                    value={conditionType.value}
                  >
                    {conditionType.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div
              className={cn(
                "min-w-0",
                condition.type === "meta_form" && "col-span-2 row-start-2",
              )}
            >
              <DistributionQueueConditionValueEditor
                condition={condition}
                incomingWebhooks={incomingWebhooks}
                whatsappSessions={whatsappSessions}
                activeWhatsAppSessions={activeWhatsAppSessions}
                campaignWhatsAppSessions={campaignWhatsAppSessions}
                metaForms={metaForms}
                metaFormsLoading={metaFormsLoading}
                metaFormsFetching={metaFormsFetching}
                metaFormsError={metaFormsError}
                queueId={queueId}
                tags={tags}
                tagsLoading={tagsLoading}
                tagsError={tagsError}
                properties={properties}
                hasPropertiesModule={hasPropertiesModule}
                onUpdate={onUpdateCondition}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remover regra"
              className={cn(
                "h-8 w-8 justify-self-end rounded-[5px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:justify-self-auto",
                condition.type === "meta_form" &&
                  "col-start-2 row-start-1 justify-self-end",
              )}
              onClick={() => onRemoveCondition(condition.id)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {hasWhatsAppMessageCondition && (
          <div className="flex items-start justify-between gap-4 rounded-lg bg-[var(--app-surface-soft)] p-3">
            <div className="space-y-1">
              <Label htmlFor="distribution-ignore-availability">
                Ignorar escala dos corretores
              </Label>
              <p className="text-xs text-muted-foreground">
                Desativado, o lead é distribuído somente para quem está dentro
                da escala. Ative para permitir distribuição fora dos dias e
                horários configurados.
              </p>
            </div>
            <Switch
              id="distribution-ignore-availability"
              checked={queueIgnoresAvailability(ignoreAvailability)}
              onCheckedChange={onIgnoreAvailabilityChange}
            />
          </div>
        )}
        {!hasValidCriteria && (
          <p className="text-xs text-destructive">
            Adicione pelo menos um criterio preenchido para salvar a fila.
          </p>
        )}
        <Button
          variant="outline"
          onClick={onAddCondition}
          className="h-9 w-full gap-2 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
        >
          <Plus className="h-3.5 w-3.5" /> Nova condição
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}
