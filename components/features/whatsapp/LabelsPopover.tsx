import { useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, Tag, Loader2 } from "lucide-react";
import {
  useWhatsAppLabels,
  useChatLabels,
  useAssignLabel,
  useSyncLabels,
} from "@/hooks/use-whatsapp-labels";
import { cn } from "@/lib/utils";

// WhatsApp label palette (color indexes 0-19 map roughly to these hues)
const LABEL_COLORS = [
  "#ff6b6b", "#feca57", "#48dbfb", "#1dd1a1", "#5f27cd",
  "#ff9ff3", "#54a0ff", "#00d2d3", "#ee5a6f", "#c8d6e5",
  "#ff6348", "#f368e0", "#576574", "#222f3e", "#10ac84",
  "#2e86de", "#ee5253", "#341f97", "#ff9f43", "#01a3a4",
];

function colorFor(label: { color: number | null }) {
  if (label.color == null) return "#8E8E93";
  return LABEL_COLORS[label.color % LABEL_COLORS.length];
}

interface LabelsPopoverProps {
  sessionId: string;
  conversationId: string;
  remoteJid: string;
  triggerClassName?: string;
}

export function LabelsPopover({
  sessionId,
  conversationId,
  remoteJid,
  triggerClassName,
}: LabelsPopoverProps) {
  const { data: labels = [], isLoading } = useWhatsAppLabels(sessionId);
  const { data: assigned = [] } = useChatLabels(conversationId);
  const assignMut = useAssignLabel();
  const syncMut = useSyncLabels();

  const assignedIds = useMemo(() => new Set(assigned.map((l) => l.id)), [assigned]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-7 px-2 text-xs gap-1", triggerClassName)}
          title="Etiquetas"
        >
          <Tag className="w-3.5 h-3.5" />
          {assigned.length > 0 ? (
            <span className="text-[10px] font-semibold">{assigned.length}</span>
          ) : (
            <span className="text-[10px]">Etiquetas</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0 bg-popover">
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <span className="text-sm font-semibold">Etiquetas</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px]"
            disabled={syncMut.isPending}
            onClick={() => syncMut.mutate(sessionId)}
          >
            {syncMut.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              "Sincronizar"
            )}
          </Button>
        </div>
        <ScrollArea className="max-h-72">
          <div className="p-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : labels.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                Nenhuma etiqueta encontrada.
                <br />
                Clique em Sincronizar.
              </div>
            ) : (
              labels.map((label) => {
                const isOn = assignedIds.has(label.id);
                const color = colorFor(label);
                return (
                  <button
                    key={label.id}
                    type="button"
                    disabled={assignMut.isPending}
                    onClick={() =>
                      assignMut.mutate({
                        sessionId,
                        remoteJid,
                        labelId: label.id,
                        conversationId,
                        add: !isOn,
                      })
                    }
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm",
                      "hover:bg-accent transition-colors",
                      isOn && "bg-accent/50",
                    )}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="flex-1 truncate">{label.name}</span>
                    {isOn && <Check className="w-3.5 h-3.5 text-primary" />}
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
        {assigned.length > 0 && (
          <div className="px-3 py-2 border-t flex flex-wrap gap-1">
            {assigned.map((l) => (
              <Badge
                key={l.id}
                variant="secondary"
                className="text-[10px] px-1.5 py-0 h-4 border-0"
                style={{ backgroundColor: colorFor(l), color: "#fff" }}
              >
                {l.name}
              </Badge>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
