import { useDeferredValue, useRef, useState } from "react";
import { Loader2, User, UserPlus, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConfirmConversationLeadLinkDialog } from "@/components/features/whatsapp/ConfirmConversationLeadLinkDialog";
import { WhatsAppAvatarImage as AvatarImage } from "@/components/features/whatsapp/WhatsAppAvatarImage";
import { useLeads } from "@/hooks/use-leads";
import type { WhatsAppConversationLinkPreview } from "@/lib/api/whatsapp";
import { formatPhoneForDisplay, formatWhatsAppContactLabel } from "@/lib/phone-utils";
import { cn } from "@/lib/utils";
import { formatWhatsAppPersonName } from "@/lib/whatsapp-person-name";

interface ConversationUnregisteredPanelProps {
  contactName?: string | null;
  contactPhone?: string | null;
  contactPicture?: string | null;
  contactPictureFallback?: string | null;
  isGroup?: boolean;
  currentLeadId?: string;
  currentLeadName?: string;
  onCreateLead?: () => void;
  canLinkLead?: boolean;
  onPreviewLinkLead?: (leadId: string) => Promise<WhatsAppConversationLinkPreview>;
  onLinkLead?: (leadId: string, preview: WhatsAppConversationLinkPreview) => Promise<void>;
  isLinkingLead?: boolean;
  historyDeadlineAt?: string | null;
  onClose?: () => void;
  className?: string;
}

export function ConversationUnregisteredPanel({
  contactName,
  contactPhone,
  contactPicture,
  contactPictureFallback,
  isGroup,
  currentLeadId,
  currentLeadName,
  onCreateLead,
  canLinkLead = false,
  onPreviewLinkLead,
  onLinkLead,
  isLinkingLead = false,
  historyDeadlineAt,
  onClose,
  className,
}: ConversationUnregisteredPanelProps) {
  const [leadPickerOpen, setLeadPickerOpen] = useState(false);
  const [leadSearch, setLeadSearch] = useState("");
  const [selectedLead, setSelectedLead] = useState<{ id: string; name: string } | null>(null);
  const [linkPreview, setLinkPreview] = useState<WhatsAppConversationLinkPreview | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const previewRequestRef = useRef(0);
  const deferredLeadSearch = useDeferredValue(leadSearch.trim());
  const defaultLeadSearch = (contactPhone || "").replace(/\D/g, "");
  const {
    data: candidateLeads = [],
    isLoading: candidateLeadsLoading,
    isError: candidateLeadsFailed,
  } = useLeads(
    {
      search: deferredLeadSearch || defaultLeadSearch || undefined,
      limit: 12,
    },
    {
      enabled: leadPickerOpen && canLinkLead && Boolean(onLinkLead),
    },
  );
  const contactLabel = formatWhatsAppContactLabel(contactName, contactPhone);
  const displayName = isGroup
    ? (contactName || contactLabel || "Contato")
    : ((contactLabel === "Contato sem identificação"
        ? contactLabel
        : formatWhatsAppPersonName(contactLabel)) || "Contato");
  // Cronometro dos 7 dias: prazo contado da ultima mensagem (modelo de 12/11).
  // Mostra a politica; a limpeza automatica fica com o worker de retencao.
  const historyDeadline = (() => {
    if (!historyDeadlineAt) return null;
    const deadline = new Date(historyDeadlineAt);
    if (Number.isNaN(deadline.getTime())) return null;
    const ms = deadline.getTime() - Date.now();
    const label = deadline.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
      + " às " + deadline.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    if (ms <= 0) return { expired: true as const, label, remaining: "" };
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const remaining = days > 0
      ? `${days} ${days === 1 ? "dia" : "dias"} restante${days === 1 ? "" : "s"}`
      : `${Math.max(hours, 1)}h restantes`;
    return { expired: false as const, label, remaining };
  })();
  const availableCandidateLeads = candidateLeads.filter((candidate) => candidate.id !== currentLeadId);

  const loadLinkPreview = async (leadId: string) => {
    const requestId = ++previewRequestRef.current;
    setIsPreviewLoading(true);
    setPreviewFailed(false);
    setLinkPreview(null);
    try {
      if (!onPreviewLinkLead) throw new Error("Prévia de vínculo indisponível");
      const preview = await onPreviewLinkLead(leadId);
      if (requestId !== previewRequestRef.current) return;
      if (preview.leadId !== leadId) throw new Error("Lead da prévia não corresponde ao selecionado");
      setLinkPreview(preview);
    } catch {
      if (requestId === previewRequestRef.current) setPreviewFailed(true);
    } finally {
      if (requestId === previewRequestRef.current) setIsPreviewLoading(false);
    }
  };

  const handleSelectLead = (leadId: string, leadName: string) => {
    if (!onLinkLead || isLinkingLead) return;
    setSelectedLead({ id: leadId, name: leadName });
    setLeadPickerOpen(false);
    void loadLinkPreview(leadId);
  };

  const handleLinkLead = async () => {
    if (!onLinkLead || !selectedLead || !linkPreview || isLinkingLead || previewFailed) return;
    if (linkPreview.leadId !== selectedLead.id) return;
    try {
      await onLinkLead(selectedLead.id, linkPreview);
      previewRequestRef.current += 1;
      setSelectedLead(null);
      setLinkPreview(null);
      setLeadPickerOpen(false);
      setLeadSearch("");
    } catch {
      // The caller owns user-facing feedback and keeps confirmation open for retry.
    }
  };

  const handleLinkDialogOpenChange = (open: boolean) => {
    if (open || isLinkingLead) return;
    previewRequestRef.current += 1;
    setSelectedLead(null);
    setLinkPreview(null);
    setPreviewFailed(false);
  };

  return (
    <aside
      className={cn(
        "lead-detail-dialog lead-detail-v2 flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]",
        className,
      )}
    >
      <div className="relative flex shrink-0 flex-col items-center border-b border-[var(--app-border)] px-4 py-5 text-center">
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-7 w-7 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text-primary)]"
            onClick={onClose}
            data-conversation-panel-close
            aria-label="Fechar painel do contato"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
        <Avatar className="h-14 w-14 border-0">
          <AvatarImage src={contactPicture || undefined} fallbackSrc={contactPictureFallback} alt={displayName} />
          <AvatarFallback className="bg-[var(--app-surface-soft)] text-base font-medium text-[var(--app-text-secondary)]">
            {isGroup ? (
              <User className="h-5 w-5" />
            ) : (
              displayName[0]?.toUpperCase() || "?"
            )}
          </AvatarFallback>
        </Avatar>
        <h2 className="mt-3 max-w-full truncate" style={{ fontSize: "var(--app-font-size-card-title)", fontWeight: "var(--app-font-weight-body)" }}>
          {displayName}
        </h2>
        {contactPhone && (
          <p className="mt-1 text-xs text-[var(--app-text-tertiary)]">
            {formatPhoneForDisplay(contactPhone)}
          </p>
        )}
        <Badge className="mt-3 rounded-[5px] border-0 bg-amber-500/14 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
          {currentLeadId ? `Vinculado a ${formatWhatsAppPersonName(currentLeadName) || "um lead"}` : "Não cadastrado"}
        </Badge>
        {!currentLeadId && historyDeadline && (
          <p className="mt-2 text-[11px] leading-snug text-[var(--app-text-tertiary)]">
            {historyDeadline.expired
              ? "Prazo do histórico sem lead vencido"
              : `Histórico guardado até ${historyDeadline.label} · ${historyDeadline.remaining}`}
          </p>
        )}
      </div>

      <div className="flex flex-1 flex-col justify-center gap-4 px-4 py-5 text-center">
        <div className="rounded-[8px] bg-[var(--app-surface-soft)] px-3 py-4">
          <p className="text-sm font-medium text-[var(--app-text-primary)]">
            {currentLeadId ? "Mudar o vínculo desta conversa" : "Vincular esta conversa a um lead"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--app-text-tertiary)]">
            {currentLeadId
              ? "Escolha outro lead com o mesmo WhatsApp. O histórico já atribuído ao lead atual permanecerá nele."
              : "Use um lead existente com o mesmo WhatsApp ou cadastre um novo para acompanhar etapa, responsável e histórico comercial."}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {canLinkLead && onLinkLead && (
            <Popover open={leadPickerOpen} onOpenChange={setLeadPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3"
                  disabled={isLinkingLead}
                  aria-label={`${currentLeadId ? "Mudar vínculo de" : "Vincular"} ${displayName} a um lead existente`}
                >
                  {isLinkingLead ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <User className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {currentLeadId ? "Escolher outro lead" : "Vincular existente"}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                collisionPadding={12}
                className="w-[300px] overflow-hidden border-0 bg-[var(--app-surface-solid)] p-1 shadow-none"
              >
                <Command
                  shouldFilter={false}
                  className="border-none bg-transparent [&_[cmdk-input-wrapper]]:border-b-0 [&_[cmdk-input-wrapper]]:px-2"
                >
                  <CommandInput
                    value={leadSearch}
                    onValueChange={setLeadSearch}
                    placeholder="Buscar por nome ou WhatsApp..."
                    aria-label="Buscar lead existente"
                    className="h-8 py-0 text-[12px] font-light"
                  />
                  <p className="px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
                    A vinculação só será concluída se o WhatsApp do lead
                    corresponder ao desta conversa.
                  </p>
                  <CommandList className="max-h-[260px]">
                    {candidateLeadsLoading ? (
                      <div
                        className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground"
                        role="status"
                      >
                        <Loader2
                          className="h-4 w-4 animate-spin motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                        Buscando leads...
                      </div>
                    ) : candidateLeadsFailed ? (
                      <div
                        className="px-3 py-6 text-center text-xs text-destructive"
                        role="alert"
                      >
                        Não foi possível buscar os leads.
                      </div>
                    ) : availableCandidateLeads.length === 0 ? (
                      <CommandEmpty>Nenhum lead encontrado.</CommandEmpty>
                    ) : (
                      <CommandGroup heading="Leads encontrados">
                        {availableCandidateLeads.map((candidate) => (
                          <CommandItem
                            key={candidate.id}
                            value={candidate.id}
                            disabled={isLinkingLead}
                            onSelect={() => handleSelectLead(candidate.id, candidate.name || "Lead sem nome")}
                            className="cursor-pointer rounded-[6px] px-3 py-2"
                          >
                            <div className="min-w-0 flex-1 text-left">
                              <p className="truncate text-xs font-medium">
                                {formatWhatsAppPersonName(candidate.name) || "Lead sem nome"}
                              </p>
                              <p className="truncate text-[10px] text-muted-foreground">
                                {candidate.phone
                                  ? formatPhoneForDisplay(candidate.phone)
                                  : "Sem WhatsApp cadastrado"}
                              </p>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          )}

          {onCreateLead && (
            <Button
              className="lead-detail-primary-action h-8 rounded-[6px] px-3"
              onClick={onCreateLead}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Cadastrar lead
            </Button>
          )}
        </div>
      </div>
      <ConfirmConversationLeadLinkDialog
        open={Boolean(selectedLead)}
        mode="existing"
        leadName={selectedLead?.name}
        preview={linkPreview}
        isLoading={isPreviewLoading}
        isConfirming={isLinkingLead}
        hasError={previewFailed}
        onOpenChange={handleLinkDialogOpenChange}
        onRetry={() => {
          if (selectedLead) void loadLinkPreview(selectedLead.id);
        }}
        onConfirm={() => void handleLinkLead()}
      />
    </aside>
  );
}
