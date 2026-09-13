import { ChevronDown, MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY,
  DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS,
  MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS,
  MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_LENGTH,
  isValidWhatsAppDistributionAutoReplyDelay,
  type DistributionQueueSettings,
} from "@/lib/round-robin/distribution-queue-form";
import { cn } from "@/lib/utils";

interface DistributionQueueWhatsAppAutoReplySectionProps {
  open: boolean;
  settings: DistributionQueueSettings;
  onToggle: () => void;
  onSettingsChange: (updates: Partial<DistributionQueueSettings>) => void;
}

export function DistributionQueueWhatsAppAutoReplySection({
  open,
  settings,
  onToggle,
  onSettingsChange,
}: DistributionQueueWhatsAppAutoReplySectionProps) {
  const enabled = settings.whatsapp_distribution_auto_reply_enabled === true;
  const message =
    settings.whatsapp_distribution_auto_reply_message ??
    DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY;
  const delay =
    settings.whatsapp_distribution_auto_reply_delay_seconds ??
    DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS;

  return (
    <Collapsible
      data-tour="distribution-queue-whatsapp-auto-reply"
      open={open}
      onOpenChange={onToggle}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-[6px] border-0 bg-[var(--app-surface-muted)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--app-surface-hover)] data-[state=open]:bg-primary/10">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <span className="font-medium">Resposta ao lead</span>
          {enabled && (
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
        <div className="space-y-4 rounded-[6px] bg-[var(--app-surface-soft)] p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="distribution-whatsapp-auto-reply">
                Enviar resposta automática após distribuir
              </Label>
              <p className="text-xs text-muted-foreground">
                Recurso opcional. Depois que esta fila distribuir o lead, a
                mesma conexão do WhatsApp enviará a mensagem configurada.
              </p>
            </div>
            <Switch
              id="distribution-whatsapp-auto-reply"
              checked={enabled}
              onCheckedChange={(checked) => {
                const currentMessage = message.trim();
                onSettingsChange({
                  whatsapp_distribution_auto_reply_enabled: checked,
                  whatsapp_distribution_auto_reply_message:
                    currentMessage || DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY,
                  whatsapp_distribution_auto_reply_delay_seconds:
                    isValidWhatsAppDistributionAutoReplyDelay(delay)
                      ? delay
                      : DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS,
                });
              }}
            />
          </div>

          {enabled && (
            <div className="space-y-4 border-t border-[var(--app-border)] pt-4">
              <div className="space-y-2">
                <Label htmlFor="distribution-whatsapp-auto-reply-message">
                  Mensagem
                </Label>
                <Textarea
                  id="distribution-whatsapp-auto-reply-message"
                  maxLength={MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_LENGTH}
                  rows={4}
                  value={message}
                  onChange={(event) =>
                    onSettingsChange({
                      whatsapp_distribution_auto_reply_message:
                        event.target.value,
                    })
                  }
                />
                <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                  <span>
                    Use uma mensagem curta e genérica para confirmar o
                    atendimento.
                  </span>
                  <span className="shrink-0">
                    {Array.from(message).length}/
                    {MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_LENGTH}
                  </span>
                </div>
              </div>

              <div className="space-y-2 sm:max-w-xs">
                <Label htmlFor="distribution-whatsapp-auto-reply-delay">
                  Atraso para envio
                </Label>
                <Input
                  id="distribution-whatsapp-auto-reply-delay"
                  type="number"
                  min={1}
                  max={MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS}
                  step={1}
                  value={delay}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    onSettingsChange({
                      whatsapp_distribution_auto_reply_delay_seconds:
                        Number.isFinite(parsed)
                          ? Math.min(
                              MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS,
                              Math.max(1, parsed),
                            )
                          : DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS,
                    });
                  }}
                />
                <p className="text-[11px] text-muted-foreground">
                  Segundos após a distribuição concluída. Padrão:{" "}
                  {DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS}s.
                </p>
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
