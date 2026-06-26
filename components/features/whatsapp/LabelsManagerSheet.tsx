import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RefreshCw, Tag } from "lucide-react";
import { useWhatsAppLabels, useSyncLabels } from "@/hooks/use-whatsapp-labels";
import { toast } from "@/hooks/use-toast";

// WhatsApp native label color palette (index → hex)
const LABEL_COLORS = [
  "#FF6B6B", "#FFB347", "#FFD93D", "#6BCB77", "#4D96FF",
  "#A66CFF", "#FF7BB3", "#7BD3EA", "#A0A0A0", "#FF5252",
  "#9C27B0", "#3F51B5", "#009688", "#795548", "#607D8B",
  "#E91E63", "#673AB7", "#2196F3", "#00BCD4", "#4CAF50",
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  sessionName?: string;
}

export function LabelsManagerSheet({ open, onOpenChange, sessionId, sessionName }: Props) {
  const { data: labels = [], isLoading } = useWhatsAppLabels(sessionId || undefined);
  const sync = useSyncLabels();

  const handleSync = () => {
    if (!sessionId) return;
    sync.mutate(sessionId, {
      onSuccess: () => toast({ title: "Etiquetas sincronizadas" }),
      onError: (error: unknown) => toast({
        title: "Erro",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      }),
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[90%] sm:w-[650px] sm:max-w-[650px] p-6 flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Tag className="w-5 h-5" />
            Etiquetas {sessionName && <span className="text-muted-foreground font-normal">— {sessionName}</span>}
          </SheetTitle>
          <SheetDescription>
            Etiquetas nativas do WhatsApp sincronizadas desta conexão
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between py-3">
          <p className="text-sm text-muted-foreground">
            {labels.length} {labels.length === 1 ? "etiqueta" : "etiquetas"}
          </p>
          <Button size="sm" variant="outline" onClick={handleSync} disabled={sync.isPending || !sessionId}>
            {sync.isPending
              ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
            Sincronizar
          </Button>
        </div>

        <ScrollArea className="flex-1 -mx-2 px-2">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : labels.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nenhuma etiqueta sincronizada ainda. Clique em &quot;Sincronizar&quot; para buscar do WhatsApp.
            </div>
          ) : (
            <div className="space-y-2">
              {labels.map((label) => {
                const color = label.color != null ? LABEL_COLORS[label.color % LABEL_COLORS.length] : "#999";
                return (
                  <div key={label.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-white/[0.055] hover:bg-white/[0.035] transition-colors">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="flex-1 text-sm font-medium truncate">{label.name}</span>
                    {label.predefined && (
                      <Badge variant="secondary" className="text-[10px]">padrão</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
