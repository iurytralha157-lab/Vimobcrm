import type { DragEventHandler, ReactNode, Ref } from "react";

import { AppLayout } from "@/components/shared/layout/AppLayout";

type ConversationsLayoutProps = {
  mobile: boolean;
  containerRef: Ref<HTMLDivElement>;
  inbox: ReactNode;
  thread: ReactNode;
  emptyThread: ReactNode;
  leadDetails: ReactNode;
  overlays: ReactNode;
  onDrop: DragEventHandler<HTMLElement>;
  onDragOver: DragEventHandler<HTMLElement>;
};

export function ConversationsLayout({
  mobile,
  containerRef,
  inbox,
  thread,
  emptyThread,
  leadDetails,
  overlays,
  onDrop,
  onDragOver,
}: ConversationsLayoutProps) {
  return (
    <AppLayout title="Conversas" disableMainScroll>
      {mobile ? (
        <div ref={containerRef} data-conversations-mobile-surface className="app-card flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
          {thread ? (
            <div className="relative flex flex-col h-full overflow-hidden" onDrop={onDrop} onDragOver={onDragOver}>
              {thread}
              {leadDetails}
            </div>
          ) : (
            <div className="flex flex-col h-full">
              {inbox}
            </div>
          )}
        </div>
      ) : (
        <div ref={containerRef} className="relative flex h-full min-h-0 gap-3 overflow-hidden">
          <aside data-tour="conversations-overview" className="app-card flex w-[280px] min-w-[280px] max-w-[280px] lg:w-[365px] lg:min-w-[365px] lg:max-w-[365px] flex-col overflow-hidden">
            {inbox}
          </aside>
          <main data-tour="conversations-chat" className="app-card flex min-w-0 flex-1 flex-col overflow-hidden" onDrop={onDrop} onDragOver={onDragOver}>
            {thread ?? emptyThread}
          </main>
          {leadDetails}
        </div>
      )}
      {overlays}
    </AppLayout>
  );
}
