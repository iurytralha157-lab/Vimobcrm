import type { ChangeEventHandler, KeyboardEventHandler, RefObject } from "react";
import { Loader2, Paperclip, Square, Zap } from "lucide-react";

import { AudioRecorderButton } from "@/components/features/whatsapp/AudioRecorderButton";
import { MessageBox } from "@/components/ui/message-box";

type ConversationComposerProps = {
  layout: "mobile" | "desktop";
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileSelect: ChangeEventHandler<HTMLInputElement>;
  messageText: string;
  onMessageTextChange: (value: string) => void;
  onSendMessage: () => void;
  onKeyDown: KeyboardEventHandler<Element>;
  placeholder: string;
  disabled: boolean;
  isSending: boolean;
  selectedLeadId: string | null;
  canStartAutomations: boolean;
  hasActiveAutomation: boolean;
  isLoadingAutomationState: boolean;
  isAutomationStateUnavailable: boolean;
  onStartAutomation: () => void;
  onCancelAutomation: () => void;
  isCancellingAutomation: boolean;
  onSendAudio: (base64: string, mimetype: string) => Promise<boolean | void>;
};

export function ConversationComposer({
  layout,
  fileInputRef,
  onFileSelect,
  messageText,
  onMessageTextChange,
  onSendMessage,
  onKeyDown,
  placeholder,
  disabled,
  isSending,
  selectedLeadId,
  canStartAutomations,
  hasActiveAutomation,
  isLoadingAutomationState,
  isAutomationStateUnavailable,
  onStartAutomation,
  onCancelAutomation,
  isCancellingAutomation,
  onSendAudio,
}: ConversationComposerProps) {
  const isMobile = layout === "mobile";
  const leftActions = (
    <>
      <button aria-label="Anexar arquivo" type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled}>
        <Paperclip className="w-5 h-5" />
      </button>
      {selectedLeadId && canStartAutomations && (
        isLoadingAutomationState ? (
          <span
            className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground"
            role="status"
            aria-label="Verificando automações ativas"
            title="Verificando automações ativas"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          </span>
        ) : isAutomationStateUnavailable ? (
          <span
            className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground/50"
            role="img"
            aria-label="Estado das automações indisponível"
            title="Não foi possível verificar as automações agora"
          >
            <Zap className="h-4 w-4" aria-hidden="true" />
          </span>
        ) : hasActiveAutomation ? (
          <button
            type="button"
            onClick={onCancelAutomation}
            disabled={isCancellingAutomation}
            aria-label="Parar automação ativa"
            title="Parar automação ativa"
          >
            {isCancellingAutomation
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <Square className="w-5 h-5" />}
          </button>
        ) : (
          <button
            aria-label="Iniciar automação"
            type="button"
            onClick={onStartAutomation}
            title="Iniciar automação"
          >
            <Zap className="w-5 h-5" />
          </button>
        )
      )}
    </>
  );

  return (
    <footer
      {...(!isMobile ? { "data-tour": "conversations-composer" } : {})}
      className="shrink-0 bg-[var(--app-surface-soft)] px-3 pb-3 pt-2"
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={onFileSelect}
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
        className="hidden"
      />
      <MessageBox
        value={messageText}
        inputAriaLabel="Digite sua mensagem"
        onChange={onMessageTextChange}
        onSend={onSendMessage}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        isSending={isSending}
        multiline
        {...(!isMobile ? { showRightActionsWhenEmpty: !isSending } : {})}
        leftActions={leftActions}
        {...(!isMobile ? {
          rightActions: (
            <AudioRecorderButton
              onSend={onSendAudio}
              disabled={disabled}
            />
          ),
        } : {})}
      />
    </footer>
  );
}
