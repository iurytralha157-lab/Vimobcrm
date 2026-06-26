import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateStageAutomation, useUpdateStageAutomation, AutomationType, AUTOMATION_TYPE_LABELS, AUTOMATION_TYPE_DESCRIPTIONS, StageAutomation, type CreateAutomationData } from "@/hooks/use-stage-automations";
import { useOrganizationUsers } from "@/hooks/use-users";
import { Loader2, Info, User, Trophy, XCircle, Circle } from "lucide-react";

interface AutomationFormProps {
  stageId: string;
  pipelineId: string;
  automation?: StageAutomation | null;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function AutomationForm({ stageId, automation, onSuccess, onCancel }: AutomationFormProps) {
  const [automationType, setAutomationType] = useState<AutomationType>('alert_on_inactivity');
  const [triggerDays, setTriggerDays] = useState<number>(7);
  const [alertMessage, setAlertMessage] = useState<string>('');
  const [targetUserId, setTargetUserId] = useState<string>('');
  const [dealStatus, setDealStatus] = useState<'open' | 'won' | 'lost'>('won');

  const { data: users } = useOrganizationUsers();
  const createAutomation = useCreateStageAutomation();
  const updateAutomation = useUpdateStageAutomation();

  const isEditing = !!automation;
  const isLoading = createAutomation.isPending || updateAutomation.isPending;


  useEffect(() => {
    if (automation) {
      // Parse action_config for new fields
      const config = automation.action_config as Record<string, unknown> || {};
      queueMicrotask(() => {
        setAutomationType(automation.automation_type as AutomationType);
        setTriggerDays(automation.trigger_days || 7);
        setAlertMessage(automation.alert_message || '');
        setTargetUserId((config.target_user_id as string) || '');
        setDealStatus((config.deal_status as 'open' | 'won' | 'lost') || 'won');
      });
    }
  }, [automation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const data: CreateAutomationData = {
      stage_id: stageId,
      automation_type: automationType,
      trigger_days: automationType === 'alert_on_inactivity' ? triggerDays : null,
      target_stage_id: null,
      whatsapp_template: null,
      alert_message: automationType === 'alert_on_inactivity' ? alertMessage : null,
      // Pass direct values - hook will build action_config
      deal_status: automationType === 'change_deal_status_on_enter' ? dealStatus : undefined,
      target_user_id: automationType === 'change_assignee_on_enter' ? targetUserId : undefined,
    };

    if (isEditing && automation) {
      await updateAutomation.mutateAsync({ id: automation.id, ...data });
    } else {
      await createAutomation.mutateAsync(data);
    }

    onSuccess?.();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Tipo de Automação</Label>
        <Select value={automationType} onValueChange={(v) => setAutomationType(v as AutomationType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(AUTOMATION_TYPE_LABELS) as AutomationType[]).map(type => (
              <SelectItem key={type} value={type}>
                {AUTOMATION_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Info className="h-3 w-3" />
          {AUTOMATION_TYPE_DESCRIPTIONS[automationType]}
        </p>
      </div>

      {/* Trigger Days - for inactivity alert */}
      {automationType === 'alert_on_inactivity' && (
        <div className="space-y-2">
          <Label>Dias de Inatividade</Label>
          <Input
            type="number"
            min={1}
            max={365}
            value={triggerDays}
            onChange={(e) => setTriggerDays(parseInt(e.target.value) || 1)}
          />
          <p className="text-xs text-muted-foreground">
            Número de dias sem atividade para disparar a Automação
          </p>
        </div>
      )}
      {/* Alert Message */}
      {automationType === 'alert_on_inactivity' && (
        <div className="space-y-2">
          <Label>Mensagem do Alerta</Label>
          <Input
            value={alertMessage}
            onChange={(e) => setAlertMessage(e.target.value)}
            placeholder="Lead está há X dias sem atendimento"
          />
        </div>
      )}

      {/* Target User - for change assignee automation */}
      {automationType === 'change_assignee_on_enter' && (
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Novo Responsável
          </Label>
          <Select value={targetUserId} onValueChange={setTargetUserId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione o Responsável" />
            </SelectTrigger>
            <SelectContent>
              {users?.map(user => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            O lead será atribuído automaticamente a este usuário ao entrar no estágio
          </p>
        </div>
      )}

      {/* Deal Status - for change status automation */}
      {automationType === 'change_deal_status_on_enter' && (
        <div className="space-y-2">
          <Label>Novo Status do Deal</Label>
          <Select value={dealStatus} onValueChange={(v) => setDealStatus(v as 'open' | 'won' | 'lost')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">
                <div className="flex items-center gap-2">
                  <Circle className="h-4 w-4 text-blue-500" />
                  Aberto
                </div>
              </SelectItem>
              <SelectItem value="won">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-green-500" />
                  Ganho
                </div>
              </SelectItem>
              <SelectItem value="lost">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  Perdido
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            O status do deal será alterado automaticamente ao entrar neste estágio
          </p>
        </div>
      )}

      <div className="flex gap-2 pt-4">
        {onCancel && (
          <Button type="button" variant="outline" className="w-[40%] rounded-xl" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={isLoading} className={`rounded-xl ${onCancel ? 'w-[60%]' : 'w-full'}`}>
          {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {isEditing ? 'Salvar' : 'Criar Automação'}
        </Button>
      </div>
    </form>
  );
}
