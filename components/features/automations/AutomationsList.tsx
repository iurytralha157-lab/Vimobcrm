import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useStageAutomations, useDeleteStageAutomation, useToggleStageAutomation, AUTOMATION_TYPE_LABELS, DEAL_STATUS_LABELS, StageAutomation } from "@/hooks/use-stage-automations";
import { useOrganizationUsers } from "@/hooks/use-users";
import { Pencil, Trash2, Zap, Clock, Bell, User, Trophy, XCircle, Circle } from "lucide-react";

interface AutomationsListProps {
  stageId: string;
  pipelineId?: string;
  onEdit?: (automation: StageAutomation) => void;
}

export function AutomationsList({ stageId, onEdit }: AutomationsListProps) {
  const { data: automations, isLoading } = useStageAutomations(stageId);
  const { data: users } = useOrganizationUsers();
  const deleteAutomation = useDeleteStageAutomation();
  const toggleAutomation = useToggleStageAutomation();
  const [deletingAutomationId, setDeletingAutomationId] = useState<string | null>(null);

  const getAutomationIcon = (type: string | null) => {
    switch (type) {
      case 'alert_on_inactivity':
        return <Bell className="h-4 w-4" />;
      case 'change_assignee_on_enter':
        return <User className="h-4 w-4" />;
      case 'change_deal_status_on_enter':
        return <Trophy className="h-4 w-4" />;
      default:
        return <Zap className="h-4 w-4" />;
    }
  };
  const getUserName = (userId: string | null) => {
    if (!userId || !users) return null;
    const user = users.find(u => u.id === userId);
    return user?.name || 'Usuário desconhecido';
  };

  const getDealStatusIcon = (status: string) => {
    switch (status) {
      case 'won': return <Trophy className="h-3 w-3 text-green-500" />;
      case 'lost': return <XCircle className="h-3 w-3 text-red-500" />;
      default: return <Circle className="h-3 w-3 text-blue-500" />;
    }
  };

  const getAutomationDescription = (automation: StageAutomation) => {
    const config = automation.action_config as Record<string, unknown> || {};

    switch (automation.automation_type) {
      case 'alert_on_inactivity':
        return (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Clock className="h-3 w-3" />
            {automation.trigger_days} dias - {automation.alert_message}
          </span>
        );
      case 'change_assignee_on_enter':
        return (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <User className="h-3 w-3" />
            → {getUserName(config.target_user_id as string) || 'Não definido'}
          </span>
        );
      case 'change_deal_status_on_enter': {
        const status = config.deal_status as string || 'open';
        return (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            {getDealStatusIcon(status)}
            → {DEAL_STATUS_LABELS[status] || status}
          </span>
        );
      }
      default:
        return null;
    }
  };

  if (isLoading) {
    return <div className="text-center py-4 text-muted-foreground">Carregando...</div>;
  }

  if (!automations || automations.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>Nenhuma automação configurada</p>
        <p className="text-sm">Adicione uma automação para este estágio</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {automations.map((automation) => {
        const automationType = automation.automation_type as keyof typeof AUTOMATION_TYPE_LABELS | null;

        return (
        <Card key={automation.id} className={!automation.is_active ? 'opacity-60' : ''}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="p-1.5 rounded-md bg-primary/10 text-primary shrink-0">
                  {getAutomationIcon(automation.automation_type)}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-xs leading-tight truncate">
                    {automationType ? AUTOMATION_TYPE_LABELS[automationType] || automationType : 'Automação'}
                  </h4>
                  <div className="truncate">{getAutomationDescription(automation)}</div>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Switch
                  checked={automation.is_active ?? true}
                  onCheckedChange={(checked) =>
                    toggleAutomation.mutate({ id: automation.id, is_active: checked })
                  }
                />

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onEdit?.(automation)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Excluir automação?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta ação não pode ser desfeita. A automação será permanentemente removida.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          setDeletingAutomationId(automation.id);
                          deleteAutomation.mutate(automation.id, {
                            onSettled: () => setDeletingAutomationId(null),
                          });
                        }}
                        disabled={deletingAutomationId === automation.id && deleteAutomation.isPending}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Excluir
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </CardContent>
        </Card>
        );
      })}
    </div>
  );
}
