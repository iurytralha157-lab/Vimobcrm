import { useFloatingChat } from "@/contexts/FloatingChatContext";
import { Button } from "@/components/ui/button";
import { useWhatsAppUnreadCount } from "@/hooks/use-whatsapp-conversations";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { usePathname } from 'next/navigation';
import { useState, useRef, useCallback, useEffect } from "react";
import { MessageCircle } from "lucide-react";

export function FloatingChatButton() {
  const { state, toggleChat } = useFloatingChat();
  const pathname = usePathname();
  const isOnConversationsPage = pathname === "/crm/conversas";
  const floatingChatReadyKey = isOnConversationsPage ? null : pathname || "app";
  const shouldLoadFloatingChatData = Boolean(floatingChatReadyKey);
  const { isLoading: modulesLoading, hasModule } = useOrganizationModules();
  const { isLoading: permissionsLoading, hasPermission } = useUserPermissions();
  const canViewWhatsApp = hasModule("whatsapp")
    && (hasPermission("whatsapp_view") || hasPermission("whatsapp_operate"));
  const shouldQueryFloatingChatData = shouldLoadFloatingChatData
    && !modulesLoading
    && !permissionsLoading
    && canViewWhatsApp;
  const conversationSessionIds: string[] | undefined = shouldQueryFloatingChatData ? undefined : [];
  const { data: unreadCount = 0 } = useWhatsAppUnreadCount(
    undefined,
    undefined,
    conversationSessionIds,
    { enabled: shouldQueryFloatingChatData },
  );

  const [side, setSide] = useState<'right' | 'left'>('right');
  const [offsetX, setOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const wasChatOpenRef = useRef(state.isOpen);
  const dragState = useRef({ startX: 0, startY: 0, moved: false, pointerId: -1 });

  useEffect(() => {
    const wasChatOpen = wasChatOpenRef.current;
    wasChatOpenRef.current = state.isOpen;
    if (!wasChatOpen || state.isOpen || state.isPresenceOpen) return undefined;

    const focusFrame = window.requestAnimationFrame(() => {
      btnRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [state.isOpen, state.isPresenceOpen]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, moved: false, pointerId: e.pointerId };
    setOffsetX(0);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (dragState.current.pointerId === -1) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = Math.abs(e.clientY - dragState.current.startY);
    if (Math.abs(dx) > 10 || dy > 10) {
      dragState.current.moved = true;
      setIsDragging(true);
      setOffsetX(dx);
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (dragState.current.moved) {
      const screenMid = window.innerWidth / 2;
      setSide(e.clientX < screenMid ? 'left' : 'right');
    }
    dragState.current.pointerId = -1;
    setOffsetX(0);
    setIsDragging(false);
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (dragState.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      dragState.current.moved = false;
      return;
    }
    toggleChat();
  }, [toggleChat]);

  if (
    !shouldLoadFloatingChatData
    || modulesLoading
    || permissionsLoading
    || !canViewWhatsApp
    || isOnConversationsPage
  ) return null;

  const surfaceHidden = state.isOpen || state.isPresenceOpen;
  const launcherLabel = unreadCount > 0
    ? `Abrir chat do WhatsApp, ${unreadCount} ${unreadCount === 1 ? 'mensagem não lida' : 'mensagens não lidas'}`
    : 'Abrir chat do WhatsApp';

  return (
    <div
      aria-hidden={surfaceHidden}
      inert={surfaceHidden}
      className={`fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 md:bottom-6 ${side === 'right' ? 'right-6' : 'left-6'} ${surfaceHidden ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      style={{
        touchAction: 'none',
        transform: isDragging ? `translateX(${offsetX}px)` : undefined,
        transition: isDragging ? 'none' : 'transform 0.3s ease, opacity 0.15s ease',
      }}
    >
      <Button
        ref={btnRef}
        type="button"
        aria-label={launcherLabel}
        aria-controls="floating-whatsapp-chat"
        aria-expanded={state.isOpen && !state.isPresenceOpen}
        tabIndex={surfaceHidden ? -1 : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          dragState.current.pointerId = -1;
          setOffsetX(0);
          setIsDragging(false);
        }}
        onClick={handleClick}
        size="icon"
        className={`relative h-14 w-14 select-none rounded-full bg-primary text-primary-foreground shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-primary/90 hover:shadow-[0_10px_28px_rgba(0,0,0,0.14)] active:scale-[0.98] ${isDragging ? 'cursor-grabbing opacity-80' : 'cursor-grab'}`}
      >
        <MessageCircle aria-hidden="true" className="h-7 w-7" />
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-[26px] min-w-[26px] items-center justify-center rounded-[7px] border-0 bg-destructive px-1.5 text-[12px] font-light text-destructive-foreground shadow-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>
    </div>
  );
}
