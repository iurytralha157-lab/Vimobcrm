import { Globe, MessageSquare, Webhook } from "lucide-react";

import {
  PropertyPickerDialog,
  type PropertyPickerProperty,
} from "@/components/features/properties/PropertyPickerDialog";
import { SearchableTagPicker } from "@/components/shared/SearchableTagPicker";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Tag } from "@/hooks/use-tags";
import type {
  RoundRobinMetaFormOption,
  RoundRobinWhatsAppSessionOption,
} from "@/lib/api/round-robins";
import type { WebhookIntegration } from "@/lib/api/webhooks";
import {
  DISTRIBUTION_QUEUE_SOURCE_OPTIONS,
  DISTRIBUTION_QUEUE_WEBSITE_CATEGORY_OPTIONS,
  type DistributionQueueCondition,
} from "@/lib/round-robin/distribution-queue-form";
import { cn } from "@/lib/utils";

interface DistributionQueueConditionValueEditorProps {
  condition: DistributionQueueCondition;
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
  onUpdate: (
    conditionId: string,
    updates: Partial<DistributionQueueCondition>,
  ) => void;
}

function conditionOptionBadgeClass(selected: boolean) {
  return cn(
    "min-h-8 max-w-full cursor-pointer whitespace-normal break-words rounded-[5px] border border-transparent px-2.5 py-1.5 text-left text-[12px] font-light leading-4 shadow-none transition-colors",
    selected
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : "bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]",
  );
}

const compactOptionListClassName =
  "scrollbar-thin flex max-h-[152px] min-h-10 min-w-0 flex-wrap content-start gap-1.5 overflow-y-auto rounded-[6px] bg-[var(--app-surface-soft)] p-2 [scrollbar-gutter:stable]";
const textEntryClassName =
  "h-10 border-0 bg-[var(--app-surface-solid)] text-[12px] shadow-none focus-visible:ring-1 focus-visible:ring-primary/30";

function metaFormOptionClass(selected: boolean, canToggle: boolean) {
  return cn(
    "group flex min-h-[52px] w-full min-w-0 items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
    selected
      ? "bg-primary/12 text-[var(--app-text-primary)] hover:bg-primary/15"
      : "bg-[var(--app-surface-soft)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]",
    !canToggle &&
      "cursor-not-allowed opacity-55 hover:bg-[var(--app-surface-soft)]",
  );
}

export function DistributionQueueConditionValueEditor({
  condition,
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
  onUpdate,
}: DistributionQueueConditionValueEditorProps) {
  switch (condition.type) {
    case "source":
      return (
        <div className={compactOptionListClassName}>
          {DISTRIBUTION_QUEUE_SOURCE_OPTIONS.map((option) => (
            <Badge
              key={option.value}
              variant="outline"
              className={conditionOptionBadgeClass(
                condition.values.includes(option.value),
              )}
              onClick={() => {
                const values = condition.values.includes(option.value)
                  ? condition.values.filter((value) => value !== option.value)
                  : [...condition.values, option.value];
                onUpdate(condition.id, { values });
              }}
            >
              {option.label}
            </Badge>
          ))}
        </div>
      );
    case "webhook":
      return (
        <div className={compactOptionListClassName}>
          {incomingWebhooks.length === 0 && (
            <span className="rounded-md bg-[var(--app-surface)] px-2 py-1 text-xs text-muted-foreground">
              Nenhum webhook de entrada encontrado.
            </span>
          )}
          {incomingWebhooks.map((webhook) => (
            <Badge
              key={webhook.id}
              variant="outline"
              className={cn(
                conditionOptionBadgeClass(
                  condition.values.includes(webhook.id),
                ),
                "gap-1",
              )}
              onClick={() => {
                const values = condition.values.includes(webhook.id)
                  ? condition.values.filter((value) => value !== webhook.id)
                  : [...condition.values, webhook.id];
                onUpdate(condition.id, { values });
              }}
            >
              <Webhook className="h-3 w-3" />
              {webhook.name}
            </Badge>
          ))}
        </div>
      );
    case "whatsapp_session":
      return (
        <div className={compactOptionListClassName}>
          {activeWhatsAppSessions.length === 0 && (
            <span className="rounded-md bg-[var(--app-surface)] px-2 py-1 text-xs text-muted-foreground">
              Nenhuma conexão WhatsApp ativa.
            </span>
          )}
          {activeWhatsAppSessions.map((session) => (
            <Badge
              key={session.id}
              variant="outline"
              className={cn(
                conditionOptionBadgeClass(
                  condition.values.includes(session.id),
                ),
                "gap-1",
              )}
              onClick={() => {
                const values = condition.values.includes(session.id)
                  ? condition.values.filter((value) => value !== session.id)
                  : [...condition.values, session.id];
                onUpdate(condition.id, { values });
              }}
            >
              <MessageSquare className="h-3 w-3" />
              {session.display_name ||
                session.phone_number ||
                session.instance_name}
            </Badge>
          ))}
        </div>
      );
    case "meta_form": {
      const knownFormIds = new Set(
        metaForms.flatMap((form) => [form.form_id, form.config_id]),
      );
      const unavailableFormIds = condition.values.filter(
        (formId) => !knownFormIds.has(formId),
      );
      const visibleMetaForms = metaForms.filter(
        (form) =>
          (form.is_active && form.integration_connected) ||
          condition.values.includes(form.form_id) ||
          condition.values.includes(form.config_id) ||
          form.round_robin_id === queueId,
      );

      return (
        <div className="min-w-0">
          {(metaFormsLoading || metaFormsError) &&
            visibleMetaForms.length === 0 &&
            unavailableFormIds.length === 0 && (
              <div className="flex min-h-10 items-center rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2">
                {metaFormsLoading && !metaFormsError && (
                  <span className="text-xs text-muted-foreground">
                    Carregando formulários Meta...
                  </span>
                )}
                {metaFormsError && (
                  <span className="text-xs text-destructive">
                    Não foi possível carregar os formulários Meta.
                  </span>
                )}
              </div>
            )}
          {!metaFormsLoading &&
            !metaFormsError &&
            visibleMetaForms.length === 0 &&
            unavailableFormIds.length === 0 && (
              <div className="flex min-h-10 items-center rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2 text-xs text-muted-foreground">
                Nenhum formulário Meta ativo configurado nesta organização.
              </div>
            )}
          {(visibleMetaForms.length > 0 || unavailableFormIds.length > 0) && (
            <div className="scrollbar-thin grid max-h-[232px] min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-1.5 overflow-y-auto rounded-[7px] bg-[var(--app-surface-muted)] p-1.5 [scrollbar-gutter:stable]">
              {visibleMetaForms.map((form) => {
                const formValues = [form.form_id, form.config_id];
                const selected = condition.values.some((value) =>
                  formValues.includes(value),
                );
                const linkedToCurrentQueue =
                  Boolean(queueId) && form.round_robin_id === queueId;
                const linkedToAnotherQueue =
                  Boolean(form.round_robin_id) && !linkedToCurrentQueue;
                const available = form.is_active && form.integration_connected;
                const canToggle =
                  selected ||
                  (!metaFormsFetching &&
                    !metaFormsError &&
                    available &&
                    !linkedToAnotherQueue);
                const statusLabel = linkedToAnotherQueue
                  ? "Outra fila"
                  : !form.is_active
                    ? "Inativo"
                    : !form.integration_connected
                      ? "Desconectado"
                      : linkedToCurrentQueue
                        ? "Nesta fila"
                        : null;
                const toggleForm = () => {
                  if (!canToggle) return;
                  const values = selected
                    ? condition.values.filter(
                        (value) => !formValues.includes(value),
                      )
                    : [...condition.values, form.form_id];
                  onUpdate(condition.id, { values });
                };

                return (
                  <button
                    type="button"
                    key={form.form_id}
                    aria-pressed={selected}
                    disabled={!canToggle}
                    title={
                      linkedToAnotherQueue
                        ? "Este formulário já está vinculado a outra fila."
                        : [
                            form.form_name || form.form_id,
                            form.page_name || form.page_id,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                    }
                    className={metaFormOptionClass(selected, canToggle)}
                    onClick={toggleForm}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        selected
                          ? "bg-primary"
                          : "bg-[var(--app-text-tertiary)]/45",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium leading-4">
                        {form.form_name || form.form_id}
                      </span>
                      <span className="block truncate text-[10px] leading-4 text-muted-foreground">
                        {form.page_name || form.page_id || "Página Meta"}
                      </span>
                    </span>
                    {statusLabel && (
                      <span
                        className={cn(
                          "shrink-0 rounded-[4px] px-1.5 py-0.5 text-[9px] font-medium leading-4",
                          linkedToAnotherQueue
                            ? "bg-amber-500/12 text-amber-700 dark:text-amber-300"
                            : selected || linkedToCurrentQueue
                              ? "bg-primary/12 text-primary"
                              : "bg-[var(--app-surface-hover)] text-muted-foreground",
                        )}
                      >
                        {statusLabel}
                      </span>
                    )}
                  </button>
                );
              })}
              {unavailableFormIds.map((formId) => (
                <button
                  type="button"
                  key={formId}
                  aria-pressed={true}
                  className={metaFormOptionClass(true, true)}
                  onClick={() =>
                    onUpdate(condition.id, {
                      values: condition.values.filter(
                        (value) => value !== formId,
                      ),
                    })
                  }
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full bg-primary"
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                    {formId}
                  </span>
                  <span className="shrink-0 rounded-[4px] bg-amber-500/12 px-1.5 py-0.5 text-[9px] font-medium leading-4 text-amber-700 dark:text-amber-300">
                    Indisponível
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }
    case "website_category":
      return (
        <div className={compactOptionListClassName}>
          {DISTRIBUTION_QUEUE_WEBSITE_CATEGORY_OPTIONS.map((option) => (
            <Badge
              key={option.value}
              variant="outline"
              className={cn(
                conditionOptionBadgeClass(
                  condition.values.includes(option.value),
                ),
                "gap-1",
              )}
              onClick={() => {
                const values = condition.values.includes(option.value)
                  ? condition.values.filter((value) => value !== option.value)
                  : [...condition.values, option.value];
                onUpdate(condition.id, { values });
              }}
            >
              <Globe className="h-3 w-3" />
              {option.label}
            </Badge>
          ))}
        </div>
      );
    case "campaign_contains":
      return (
        <Input
          placeholder="Digite parte do nome da campanha..."
          value={condition.values[0] || ""}
          onChange={(event) =>
            onUpdate(condition.id, { values: [event.target.value] })
          }
          className={textEntryClassName}
        />
      );
    case "whatsapp_message_contains": {
      const selectedSession = whatsappSessions.find(
        (session) => session.id === condition.sessionId,
      );
      const selectableSession = campaignWhatsAppSessions.find(
        (session) => session.id === condition.sessionId,
      );
      const selectedSessionUnavailable = Boolean(
        condition.sessionId && !selectableSession,
      );
      const selectedSessionLabel =
        selectedSession?.display_name ||
        selectedSession?.phone_number ||
        selectedSession?.instance_name ||
        "Conexão salva indisponível";
      const selectedSessionConnected =
        selectedSession?.status.trim().toLowerCase() === "connected";

      return (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor={`whatsapp-session-${condition.id}`}>
              Conexão WhatsApp *
            </Label>
            <Select
              value={condition.sessionId || ""}
              onValueChange={(sessionId) =>
                onUpdate(condition.id, { sessionId })
              }
              disabled={
                campaignWhatsAppSessions.length === 0 && !condition.sessionId
              }
            >
              <SelectTrigger
                id={`whatsapp-session-${condition.id}`}
                className={cn(
                  textEntryClassName,
                  !condition.sessionId && "ring-1 ring-destructive/50",
                )}
              >
                <SelectValue placeholder="Selecione uma conexão..." />
              </SelectTrigger>
              <SelectContent>
                {selectedSessionUnavailable && condition.sessionId && (
                  <SelectItem value={condition.sessionId} disabled>
                    {selectedSessionLabel} (indisponível)
                  </SelectItem>
                )}
                {campaignWhatsAppSessions.map((session) => (
                  <SelectItem key={session.id} value={session.id}>
                    {session.display_name ||
                      session.phone_number ||
                      session.instance_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {campaignWhatsAppSessions.length === 0 && !condition.sessionId && (
              <p className="text-xs text-destructive">
                Nenhuma conexão do WhatsApp ativa está disponível para esta
                conta.
              </p>
            )}
            {!condition.sessionId && campaignWhatsAppSessions.length > 0 && (
              <p className="text-xs text-destructive">
                Selecione a conexão que receberá esta campanha.
              </p>
            )}
          </div>

          <Label htmlFor={`whatsapp-message-${condition.id}`}>
            Mensagem contém
          </Label>
          <Input
            id={`whatsapp-message-${condition.id}`}
            maxLength={180}
            placeholder="Digite uma palavra ou trecho da mensagem..."
            value={condition.values[0] || ""}
            onChange={(event) =>
              onUpdate(condition.id, { values: [event.target.value] })
            }
            className={textEntryClassName}
          />
          {selectedSessionUnavailable ? (
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              A conexão salva não está disponível nesta conta. Ela foi
              preservada; selecione outra para validar o funcionamento.
            </p>
          ) : condition.sessionId ? (
            <p
              className={cn(
                "rounded-md px-3 py-2 text-xs",
                selectedSessionConnected
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
              )}
            >
              {selectedSessionConnected
                ? "Quando esta conexão receber uma mensagem com esse trecho de um contato ainda não cadastrado, o CRM cria o lead automaticamente e o envia para esta fila."
                : "Esta conexão não está conectada. Reconecte-a para receber a mensagem, criar o lead e fazer a distribuição automaticamente."}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Selecione a conexão que receberá a mensagem e criará o lead
              automaticamente.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            A atribuição inicial respeita a estratégia, os participantes e as
            escalas. Com a redistribuição ativa, o lead entra no monitoramento
            de inatividade da fila.
          </p>
        </div>
      );
    }
    case "tag":
      return (
        <SearchableTagPicker
          tags={tags}
          selectedTagIds={condition.values}
          onToggleTag={(tagId) => {
            const normalizedTagId = tagId.trim().toLowerCase();
            const selected = condition.values.some(
              (value) => value.trim().toLowerCase() === normalizedTagId,
            );
            const values = selected
              ? condition.values.filter(
                  (value) => value.trim().toLowerCase() !== normalizedTagId,
                )
              : [...condition.values, tagId];
            onUpdate(condition.id, { values });
          }}
          loading={tagsLoading}
          error={tagsError}
          placeholder="Selecionar tags..."
          triggerClassName="h-10 border-0 bg-[var(--app-surface-solid)] text-[12px] shadow-none hover:bg-[var(--app-surface-hover)]"
          allowCreate={false}
          maxSelected={100}
        />
      );
    case "city":
      return (
        <Input
          placeholder="Ex: Sao Paulo, Campinas"
          value={condition.values.join(", ")}
          onChange={(event) =>
            onUpdate(condition.id, {
              values: event.target.value
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
            })
          }
          className={textEntryClassName}
        />
      );
    case "interest_property":
      if (!hasPropertiesModule) {
        return (
          <p className="rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface-solid)] px-3 py-2 text-xs text-[var(--app-text-tertiary)]">
            O módulo de imóveis não está disponível. O critério existente será
            preservado até ser removido.
          </p>
        );
      }
      return (
        <PropertyPickerDialog
          properties={properties}
          selectedPropertyId={condition.values[0]}
          onSelect={(property) =>
            onUpdate(condition.id, { values: [property.id] })
          }
        />
      );
    default:
      return null;
  }
}
