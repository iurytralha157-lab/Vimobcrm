import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAutomations, TRIGGER_TYPE_LABELS, TriggerType } from "@/hooks/use-automations";
import { automationsAPI } from "@/lib/api/automations";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Clock, GitBranch, Loader2, MessageSquare, Play, Tag, UserPlus, Zap } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useHasPermission } from "@/hooks/use-organization-roles";

interface StartAutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  conversationId?: string;
  contactName?: string;
}

const getTriggerIcon = (type: TriggerType) => {
  switch (type) {
    case "message_received":
      return MessageSquare;
    case "scheduled":
      return Clock;
    case "lead_stage_changed":
      return GitBranch;
    case "tag_added":
      return Tag;
    case "lead_created":
      return UserPlus;
    case "manual":
      return Play;
    default:
      return Zap;
  }
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Erro desconhecido";
}

export function StartAutomationDialog({
  open,
  onOpenChange,
  leadId,
  conversationId,
  contactName,
}: StartAutomationDialogProps) {
  const { data: canStartAutomations = false, isLoading: permissionLoading } = useHasPermission("automations_edit");
  const { data: automations, isLoading, error, refetch } = useAutomations(open && canStartAutomations);
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState<string | null>(null);

  const activeAutomations = automations?.filter((automation) => automation.is_active) || [];

  const handleStart = async (automationId: string, automationName: string) => {
    if (!profile?.organization_id || !canStartAutomations) return;
    setStarting(automationId);

    try {
      const result = await automationsAPI.startAutomation(
        automationId,
        { leadId, conversationId },
        profile.organization_id,
      );

      await queryClient.invalidateQueries({ queryKey: ["automation-executions"] });

      if (result.status === 'completed') {
        toast.success(`Automação "${automationName}" concluída.`);
      } else if (result.status === 'waiting') {
        toast.success(`Automação "${automationName}" iniciada e aguardando a próxima etapa.`);
      } else if (result.status === 'cancelled' || result.status === 'canceled') {
        toast.warning(`A execução de "${automationName}" foi cancelada.`);
      } else if (result.status === 'queued' && result.dispatchPending) {
        toast.warning("Automação enfileirada para processamento. Ela será retomada automaticamente.");
      } else if (result.status === 'queued') {
        toast.info(`Automação "${automationName}" foi enfileirada.`);
      } else {
        toast.success(`Automação "${automationName}" iniciada!`);
      }

      onOpenChange(false);
    } catch (err: unknown) {
      toast.error("Erro ao iniciar automação: " + getErrorMessage(err));
    } finally {
      setStarting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Iniciar automação
          </DialogTitle>
          <DialogDescription>
            {contactName
              ? `Selecione uma automação para iniciar para ${contactName}`
              : "Selecione uma automação para iniciar para este contato"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {permissionLoading ? (
            <div className="flex items-center justify-center py-8" role="status">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !canStartAutomations ? (
            <div className="py-8 text-center" role="alert">
              <p className="text-sm font-medium">Você não possui permissão para iniciar automações.</p>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="py-8 text-center" role="alert">
              <p className="text-sm font-medium">Não foi possível carregar as automações.</p>
              <p className="mt-1 text-xs text-muted-foreground">{getErrorMessage(error)}</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : activeAutomations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Nenhuma automação ativa encontrada</p>
              <p className="text-xs mt-1">Crie automações na página de Automações</p>
            </div>
          ) : (
            activeAutomations.map((automation) => {
              const Icon = getTriggerIcon(automation.trigger_type as TriggerType);
              const isStarting = starting === automation.id;

              return (
                <button
                  key={automation.id}
                  type="button"
                  onClick={() => handleStart(automation.id, automation.name)}
                  disabled={!!starting}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/[0.055] hover:bg-white/[0.055] transition-colors text-left disabled:opacity-50"
                >
                  <div className="p-2.5 rounded-xl bg-primary/20 shrink-0">
                    <Icon className="h-5 w-5 text-primary drop-shadow-sm" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{automation.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {TRIGGER_TYPE_LABELS[automation.trigger_type as TriggerType] || automation.trigger_type}
                    </p>
                  </div>
                  {isStarting ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                  ) : (
                    <Play className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
