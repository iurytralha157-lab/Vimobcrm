import type { DragEventHandler, FocusEventHandler, ReactNode, Ref } from "react";
import { Loader2 } from "lucide-react";
import { FilterAwareMobileChatSurface } from "@/components/features/chat/FilterAwareMobileChatSurface";
import { cn } from "@/lib/utils";

type FloatingChatSurfaceProps = {
  children: ReactNode;
  header: ReactNode;
  mobile: boolean;
  minimized: boolean;
  isStartingConversation: boolean;
  surfaceRef: Ref<HTMLDivElement>;
  onFocusCapture: FocusEventHandler<HTMLDivElement>;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
  onOpenAutoFocus: (event: Event) => void;
  onEscapeKeyDown: (event: KeyboardEvent) => void;
};

export function FloatingChatSurface({
  children,
  header,
  mobile,
  minimized,
  isStartingConversation,
  surfaceRef,
  onFocusCapture,
  onDragOver,
  onDrop,
  onOpenAutoFocus,
  onEscapeKeyDown,
}: FloatingChatSurfaceProps) {
  const parked = !mobile && minimized;
  const surface = (
    <div
      id="floating-whatsapp-chat"
      ref={surfaceRef}
      onFocusCapture={onFocusCapture}
      onDragOver={onDragOver}
      onDrop={onDrop}
      role="dialog"
      aria-modal={mobile || undefined}
      aria-label="Chat do WhatsApp"
      tabIndex={-1}
      hidden={parked || undefined}
      inert={parked || undefined}
      aria-hidden={parked || undefined}
      data-filter-panel-chat-minimized={parked ? "" : undefined}
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden bg-[var(--app-surface-solid)] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] focus:outline-none",
        mobile
          ? "inset-0"
          : "inset-y-0 right-0 w-[420px] max-w-full rounded-l-[8px] pr-[env(safe-area-inset-right)] shadow-[0_12px_32px_rgba(0,0,0,0.10)]",
      )}
      style={{ display: parked ? "none" : undefined }}
    >
      {header}
      {isStartingConversation && (
        <div className="absolute inset-0 bg-background/50 flex flex-col items-center justify-center z-50">
          <Loader2 className="h-8 w-8 animate-spin motion-reduce:animate-none text-primary mb-2" />
          <p className="text-xs text-muted-foreground animate-pulse motion-reduce:animate-none">Iniciando conversa...</p>
        </div>
      )}
      {mobile ? (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 w-full max-w-full">
          {children}
        </div>
      ) : children}
    </div>
  );

  return mobile ? (
    <FilterAwareMobileChatSurface minimized={minimized} onOpenAutoFocus={onOpenAutoFocus} onEscapeKeyDown={onEscapeKeyDown}>
      {surface}
    </FilterAwareMobileChatSurface>
  ) : surface;
}
