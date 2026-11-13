import type { ChangeEventHandler, KeyboardEventHandler, ReactNode, RefObject } from "react";
import { Paperclip } from "lucide-react";

import { ConversationAutomationAction } from "@/components/features/whatsapp/ConversationAutomationAction";
import type { AudioRecorderButtonProps } from "@/components/features/whatsapp/AudioRecorderButton";
import { ScopedMessageBox } from "@/components/features/whatsapp/ScopedMessageBox";
import type { WhatsAppQuotedMessage } from "@/lib/api/whatsapp";
import type { WhatsAppAttachments } from "@/hooks/use-whatsapp-attachments";
import { AttachmentPreviewComposer } from "@/components/features/whatsapp/AttachmentPreviewComposer";

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
  readOnly?: boolean;
  whatsAppControls?: boolean;
  startNotice?: ReactNode;
  selectedLeadId: string | null;
  canStartAutomations: boolean;
  hasActiveAutomation: boolean;
  isLoadingAutomationState: boolean;
  isAutomationStateUnavailable: boolean;
  onStartAutomation: () => void;
  onCancelAutomation: () => void;
  isCancellingAutomation: boolean;
  audioContextKey: string;
  audioDisabled: boolean;
  onSendAudio: AudioRecorderButtonProps["onSend"];
  onResolveAudio: AudioRecorderButtonProps["onResolveUnconfirmed"];
  quotedMessage?: WhatsAppQuotedMessage | null;
  onClearQuote?: () => void;
  attachments?: WhatsAppAttachments;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
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
  readOnly = false,
  whatsAppControls = true,
  startNotice,
  selectedLeadId,
  canStartAutomations,
  hasActiveAutomation,
  isLoadingAutomationState,
  isAutomationStateUnavailable,
  onStartAutomation,
  onCancelAutomation,
  isCancellingAutomation,
  onSendAudio,
  audioContextKey,
  audioDisabled,
  onResolveAudio,
  quotedMessage,
  onClearQuote,
  attachments,
  inputRef,
}: ConversationComposerProps) {
  const isMobile = layout === "mobile";
  const automationAction = !readOnly && selectedLeadId && canStartAutomations && (
    <ConversationAutomationAction
      loading={isLoadingAutomationState} unavailable={isAutomationStateUnavailable} active={hasActiveAutomation}
      cancelling={isCancellingAutomation} onStart={onStartAutomation} onCancel={onCancelAutomation}
      showLabel={Boolean(startNotice)}
    />
  );
  if (startNotice) return (
    <footer className="shrink-0 bg-[var(--app-surface-soft)]">
      {startNotice}
      {automationAction && <div className="flex justify-end px-3 pb-2">{automationAction}</div>}
    </footer>
  );
  if (readOnly) return <footer role="status" className="shrink-0 bg-[var(--app-surface-soft)] px-3 py-3 text-xs text-muted-foreground">{placeholder || "Somente leitura"}</footer>;
  const leftActions = (
    <>
      {whatsAppControls && <button aria-label="Anexar arquivo" type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled}>
        <Paperclip className="w-5 h-5" />
      </button>}
      {automationAction}
    </>
  );

  return (
    <footer
      {...(!isMobile ? { "data-tour": "conversations-composer" } : {})}
      className="shrink-0 bg-[var(--app-surface-soft)] px-3 pb-3 pt-2"
      onPaste={attachments?.onPaste}
      onDrop={attachments?.onDrop}
      onDragOver={attachments?.onDragOver}
    >
      <input
        key={audioContextKey}
        type="file"
        ref={fileInputRef}
        onChange={attachments?.onFileSelect || onFileSelect}
        multiple={Boolean(attachments)}
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
        className="hidden"
        disabled={!whatsAppControls || disabled}
      />
      {attachments && <AttachmentPreviewComposer attachments={attachments} />}
      {quotedMessage && (
        <div className="mb-2 flex min-w-0 items-center justify-between gap-2 rounded border-l-2 border-primary bg-muted px-2 py-1 text-xs" role="status">
          <span className="truncate">Respondendo: {quotedMessage.content || quotedMessage.media_filename || "Mensagem"}</span>
          <button type="button" aria-label="Cancelar resposta citada" className="shrink-0 px-2 py-1" onClick={onClearQuote}>×</button>
        </div>
      )}
      <ScopedMessageBox
        showAudio={whatsAppControls}
        value={messageText}
        inputAriaLabel="Digite sua mensagem"
        onChange={onMessageTextChange}
        onSend={onSendMessage}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        isSending={isSending}
        multiline
        inputRef={inputRef}
        leftActions={leftActions}
        audio={{ contextKey: audioContextKey, onSend: onSendAudio,
          onResolveUnconfirmed: onResolveAudio, disabled: audioDisabled }}
      />
    </footer>
  );
}
