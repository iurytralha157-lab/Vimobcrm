import { usePipelines, useStages } from "@/hooks/use-stages";
import { useStageOperationalConfigs, useUpsertStageOperationalConfig, type OperationContext } from "@/hooks/use-stage-operational-configs";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Settings2,
  ShieldAlert,
  Workflow
} from "lucide-react";
import { useState } from "react";

const CONTEXTS = [
  { value: 'comercial', label: 'Comercial' },
  { value: 'financeiro', label: 'Financeiro' },
  { value: 'arquitetura', label: 'Arquitetura' },
  { value: 'compras', label: 'Compras' },
  { value: 'documental', label: 'Documental' },
  { value: 'juridico', label: 'Jurídico' },
  { value: 'pos-venda', label: 'Pós-Venda' }
] satisfies { value: OperationContext; label: string }[];

function isOperationContext(value: string): value is OperationContext {
  return CONTEXTS.some((context) => context.value === value);
}

export function OperationalTab() {
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const { data: pipelines } = usePipelines();
  const { data: configs, isLoading: loadingConfigs } = useStageOperationalConfigs(selectedPipelineId);
  const { data: allStages, isLoading: loadingStages } = useStages(selectedPipelineId);

  const upsertConfig = useUpsertStageOperationalConfig();

  const handleUpdateContext = (stageId: string, context: string) => {
    if (!isOperationContext(context)) return;

    upsertConfig.mutate({
      stage_id: stageId,
      operation_context: context
    });
  };

  const handleUpdateSLA = (stageId: string, hours: string) => {
    const sla = parseInt(hours);
    if (isNaN(sla)) return;
    upsertConfig.mutate({
      stage_id: stageId,
      sla_hours: sla
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Workflow className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Mapeamento de Estágios</CardTitle>
              <CardDescription>Defina a inteligência operacional para cada etapa do seu funil.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs space-y-2">
            <Label>Selecione o Pipeline</Label>
            <Select value={selectedPipelineId} onValueChange={setSelectedPipelineId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um pipeline..." />
              </SelectTrigger>
              <SelectContent>
                {pipelines?.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedPipelineId && (
            <div className="rounded-md border mt-6 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Estágio</TableHead>
                    <TableHead>Contexto Operacional</TableHead>
                    <TableHead>Setor Responsável</TableHead>
                    <TableHead>SLA (Horas)</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingStages || loadingConfigs ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : allStages?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                        Nenhum estágio encontrado para este pipeline.
                      </TableCell>
                    </TableRow>
                  ) : (
                    allStages?.map(stage => {
                      const config = configs?.find(c => c.stage_id === stage.id);
                      return (
                        <TableRow key={stage.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: stage.color ?? undefined }} />
                              {stage.name}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={config?.operation_context || "comercial"}
                              onValueChange={(val) => handleUpdateContext(stage.id, val)}
                            >
                              <SelectTrigger className="w-[180px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CONTEXTS.map(ctx => (
                                  <SelectItem key={ctx.value} value={ctx.value}>{ctx.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input
                              placeholder="Ex: Financeiro N1"
                              className="w-[180px]"
                              defaultValue={config?.responsible_sector || ""}
                              onBlur={(e) => upsertConfig.mutate({ stage_id: stage.id, responsible_sector: e.target.value })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              className="w-[80px]"
                              defaultValue={config?.sla_hours || 24}
                              onBlur={(e) => handleUpdateSLA(stage.id, e.target.value)}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" title="Configurações Avançadas">
                              <Settings2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {!selectedPipelineId && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 flex items-start gap-4">
          <ShieldAlert className="h-6 w-6 text-amber-600 shrink-0" />
          <div>
            <h4 className="font-semibold text-amber-900">Configuração Necessária</h4>
            <p className="text-sm text-amber-800">Selecione um pipeline acima para mapear os gatilhos operacionais. Sem esse mapeamento, o sistema não saberá quais solicitações gerar automaticamente ao mover os leads.</p>
          </div>
        </div>
      )}
    </div>
  );
}
