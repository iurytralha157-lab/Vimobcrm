import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ScrollToLatestButton({ onClick, unreadCount = 0 }: {
  onClick: () => void;
  unreadCount?: number;
}) {
  return (
    <Button
      type="button"
      data-scroll-to-latest
      variant="ghost"
      size="icon"
      aria-label={unreadCount > 0 ? `Ir para mensagens mais recentes, ${unreadCount} não lidas` : "Ir para mensagens mais recentes"}
      title="Ir para mensagens mais recentes"
      className="absolute bottom-3 right-4 z-20 h-8 w-8 rounded-full border-0 bg-white text-primary shadow-[0_4px_12px_rgba(0,0,0,0.14)] hover:bg-primary hover:text-primary-foreground focus-visible:ring-1 focus-visible:ring-primary/30"
      onClick={onClick}
    >
      <ArrowDown className="h-4 w-4" aria-hidden="true" />
      {unreadCount > 0 && <span aria-hidden="true" className="absolute -top-2 -right-2 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground">{unreadCount > 99 ? "99+" : unreadCount}</span>}
    </Button>
  );
}
