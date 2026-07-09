import { useFloatingChat } from "@/contexts/FloatingChatContext";
import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import { useWhatsAppConversations, useWhatsAppRealtimeConversations } from "@/hooks/use-whatsapp-conversations";
import { useAccessibleSessions } from "@/hooks/use-accessible-sessions";
import { usePathname } from 'next/navigation';
import { useState, useRef, useCallback, useEffect } from "react";

const FLOATING_CHAT_INITIAL_LOAD_DELAY_MS = 2000;

export function FloatingChatButton() {
  const { state, toggleChat } = useFloatingChat();
  const pathname = usePathname();
  const isOnConversationsPage = pathname === "/crm/conversas";
  const floatingChatReadyKey = isOnConversationsPage ? null : pathname || "app";
  const [readyPathKey, setReadyPathKey] = useState<string | null>(null);
  const shouldLoadFloatingChatData = !!floatingChatReadyKey && readyPathKey === floatingChatReadyKey;
  const { data: sessions, isLoading: loadingSessions } = useAccessibleSessions({
    enabled: shouldLoadFloatingChatData,
  });
  const accessibleSessionIds = sessions?.map((s) => s.id) || [];
  const conversationSessionIds = shouldLoadFloatingChatData && !loadingSessions ? accessibleSessionIds : [];
  const { data: conversations } = useWhatsAppConversations(
    undefined,
    { hideGroups: true },
    conversationSessionIds,
  );

  useWhatsAppRealtimeConversations(
    shouldLoadFloatingChatData && !isOnConversationsPage,
    loadingSessions ? undefined : accessibleSessionIds,
  );

  const [side, setSide] = useState<'right' | 'left'>('right');
  const [offsetX, setOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dragState = useRef({ startX: 0, startY: 0, moved: false, pointerId: -1 });

  useEffect(() => {
    if (!floatingChatReadyKey) return undefined;

    const timeout = setTimeout(() => setReadyPathKey(floatingChatReadyKey), FLOATING_CHAT_INITIAL_LOAD_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [floatingChatReadyKey]);

  const hasConnectedSession = sessions?.some((s) => s.status === "connected");

  const leadUnreadCount = conversations?.reduce((acc, c) => {
    if (c.lead_id) {
      return acc + (c.unread_count || 0);
    }
    return acc;
  }, 0) || 0;

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

  if (state.isOpen || !shouldLoadFloatingChatData || !hasConnectedSession || isOnConversationsPage) return null;

  return (
    <div
      className={`fixed bottom-20 md:bottom-4 z-50 ${side === 'right' ? 'right-4' : 'left-4'}`}
      style={{
        touchAction: 'none',
        transform: isDragging ? `translateX(${offsetX}px)` : undefined,
        transition: isDragging ? 'none' : 'transform 0.3s ease',
      }}
    >
      <Button
        ref={btnRef}
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
        className={`h-16 w-16 rounded-full shadow-none hover:shadow-none bg-primary text-primary-foreground transition-all duration-300 hover:scale-110 active:scale-95 select-none ${isDragging ? 'scale-95 opacity-80 cursor-grabbing' : 'cursor-grab animate-in fade-in zoom-in duration-500'}`}
      >
        <MessageCircle className="h-8 w-8 stroke-[2.5px]" />
        {leadUnreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-6 min-w-6 px-1.5 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold shadow-md border-2 border-background animate-pulse">
            {leadUnreadCount > 99 ? "99+" : leadUnreadCount}
          </span>
        )}
      </Button>
    </div>
  );
}
