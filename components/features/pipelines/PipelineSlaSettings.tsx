import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePipelineSlaSettings, useUpsertPipelineSlaSettings } from "@/hooks/use-pipeline-sla-settings";
import { Loader2, Clock, AlertTriangle } from "lucide-react";

interface PipelineSlaSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  pipelineName: string;
}

export function PipelineSlaSettings({
  open,
  onOpenChange,
  pipelineId,
  pipelineName,
}: PipelineSlaSettingsProps) {
  const { data: settings, isLoading } = usePipelineSlaSettings(pipelineId);
  const upsertMutation = useUpsertPipelineSlaSettings();

  // Form state - using hours from DB schema
  const [warningHours, setWarningHours] = useState(1);
  const [criticalHours, setCriticalHours] = useState(4);

  // Load existing settings
  useEffect(() => {
    if (!settings) return;

    const nextWarningHours = settings.warning_hours || 1;
    const nextCriticalHours = settings.critical_hours || 4;
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      setWarningHours(nextWarningHours);
      setCriticalHours(nextCriticalHours);
    });

    return () => {
      cancelled = true;
    };
  }, [settings]);

  const handleSave = () => {
    upsertMutation.mutate(
      {
        pipeline_id: pipelineId,
        warning_hours: warningHours,
        critical_hours: criticalHours,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] w-[90%] sm:w-full rounded-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Configurações de SLA
          </DialogTitle>
          <DialogDescription>
            Configure os alertas de primeiro contato para o pipeline &quot;{pipelineName}&quot;
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* Warning Time */}
            <div className="space-y-2">
              <Label htmlFor="warn-time" className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                Alertar após (horas)
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="warn-time"
                  type="number"
                  min={1}
                  max={168}
                  value={warningHours}
                  onChange={(e) => setWarningHours(parseInt(e.target.value) || 1)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">horas</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Tempo para enviar alerta de warning
              </p>
            </div>

            {/* Critical Time */}
            <div className="space-y-2">
              <Label htmlFor="critical-time" className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Marcar crítico após (horas)
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="critical-time"
                  type="number"
                  min={1}
                  max={168}
                  value={criticalHours}
                  onChange={(e) => setCriticalHours(parseInt(e.target.value) || 4)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">horas</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Tempo para marcar como SLA crítico
              </p>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-4 border-t">
          <Button variant="outline" className="w-[40%]" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button className="w-[60%]" onClick={handleSave} disabled={upsertMutation.isPending}>
            {upsertMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
