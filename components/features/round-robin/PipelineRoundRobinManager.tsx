import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, GitBranch, Shuffle, AlertCircle } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePipelines } from '@/hooks/use-stages';
import { useRoundRobins } from '@/hooks/use-round-robins';
import { useUpdatePipelineRoundRobin } from '@/hooks/use-pipeline-round-robin';

const getDefaultRoundRobinId = (pipeline: object) => {
  if (!('default_round_robin_id' in pipeline)) return null;

  const value = (pipeline as { default_round_robin_id?: unknown }).default_round_robin_id;
  return typeof value === 'string' ? value : null;
};

export function PipelineRoundRobinManager() {
  const { data: pipelines = [], isLoading: pipelinesLoading } = usePipelines();
  const { data: roundRobins = [], isLoading: rrLoading } = useRoundRobins();
  const updatePipelineRR = useUpdatePipelineRoundRobin();

  const handleChange = async (pipelineId: string, roundRobinId: string | null) => {
    await updatePipelineRR.mutateAsync({
      pipelineId,
      roundRobinId: roundRobinId === 'none' ? null : roundRobinId
    });
  };

  if (pipelinesLoading || rrLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const activeRoundRobins = roundRobins.filter(rr => rr.is_active);
  const pipelinesWithoutRR = pipelines.filter(p => !getDefaultRoundRobinId(p));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-medium mb-2">Round-Robin Padrão por Pipeline</h3>
        <p className="text-sm text-muted-foreground">
          Configure qual fila de distribuição será usada como fallback para cada pipeline,
          quando nenhuma regra específica corresponder ao lead.
        </p>
      </div>

      {pipelinesWithoutRR.length > 0 && (
        <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <p className="text-sm">
            {pipelinesWithoutRR.length} pipeline(s) sem round-robin padrão configurado.
            Leads podem ficar sem atribuição automática.
          </p>
        </div>
      )}

      <div className="grid gap-4">
        {pipelines.map((pipeline) => {
          const currentRRId = getDefaultRoundRobinId(pipeline);

          return (
            <Card key={pipeline.id}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <GitBranch className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{pipeline.name}</p>
                      {pipeline.is_default && (
                        <Badge variant="secondary" className="text-xs">Padrão</Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Select
                      value={currentRRId || 'none'}
                      onValueChange={(value) => handleChange(pipeline.id, value)}
                    >
                      <SelectTrigger className="w-64">
                        <SelectValue placeholder="Selecione uma fila..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          <span className="text-muted-foreground">Nenhum (sem fallback)</span>
                        </SelectItem>
                        {activeRoundRobins.map((rr) => (
                          <SelectItem key={rr.id} value={rr.id}>
                            <div className="flex items-center gap-2">
                              <Shuffle className="h-4 w-4" />
                              {rr.name}
                              <Badge variant="outline" className="text-xs ml-1">
                                {rr.members.length} membros
                              </Badge>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {pipelines.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <GitBranch className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">Nenhum pipeline encontrado</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
