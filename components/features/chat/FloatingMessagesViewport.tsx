import type { ReactNode, RefObject, UIEventHandler } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ScrollToLatestButton } from "@/components/features/whatsapp/ScrollToLatestButton";

export function FloatingMessagesViewport({
  children,
  scrollAreaRef,
  onScroll,
  showScrollToLatest,
  onScrollToLatest,
  unreadCount = 0,
}: {
  children: ReactNode;
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
  showScrollToLatest: boolean;
  onScrollToLatest: () => void;
  unreadCount?: number;
}) {
  return (
    <div className="relative flex-1 overflow-hidden min-h-0 flex flex-col bg-[var(--app-surface-solid)]">
      <ScrollArea ref={scrollAreaRef} className="flex-1 [&_[data-radix-scroll-area-viewport]>div]:block! [&_[data-radix-scroll-area-viewport]>div]:min-w-0! [&_[data-radix-scroll-area-viewport]>div]:w-full" onScrollCapture={onScroll}>
        {children}
      </ScrollArea>
      {showScrollToLatest && (
        <ScrollToLatestButton onClick={onScrollToLatest} unreadCount={unreadCount} />
      )}
    </div>
  );
}
