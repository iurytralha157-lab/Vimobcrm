import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Plus,
  Phone,
  MessageCircle,
  Mail,
  FileText,
  GripVertical,
  Trash2,
  Loader2,
  Lightbulb,
  FileEdit,
  Lock
} from 'lucide-react';
import { useCadenceTemplates, useCreateCadenceTask, useDeleteCadenceTask } from '@/hooks/use-cadences';
import { useCanEditCadences } from '@/hooks/use-can-edit-cadences';
import { usePipelines, useStages } from '@/hooks/use-stages';

const taskTypeIcons = {
  call: Phone,
  message: MessageCircle,
  email: Mail,
  note: FileText,
};

const taskTypeLabels = {
  call: 'Ligação',
  message: 'Mensagem',
  email: 'Email',
  note: 'Observação',
};

type CadenceTaskType = keyof typeof taskTypeLabels;

function isCadenceTaskType(value: string): value is CadenceTaskType {
  return value in taskTypeLabels;
}

export function CadencesTab() {
  const { data: templates = [], isLoading } = useCadenceTemplates();
  const createTask = useCreateCadenceTask();
  const deleteTask = useDeleteCadenceTask();
  const canEdit = useCanEditCadences();
  const { data: pipelines = [] } = usePipelines();
  const { data: allStages = [] } = useStages();
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('all');

  // Filter templates by selected pipeline
  const filteredTemplates = selectedPipelineId === 'all'
    ? templates
    : (() => {
        const stageKeysInPipeline = new Set(
          allStages
            .filter(s => s.pipeline_id === selectedPipelineId)
            .map(s => s.stage_key)
        );
        return templates.filter(t => stageKeysInPipeline.has(t.stage_key));
      })();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [newTask, setNewTask] = useState({
    dayOffset: 0,
    type: 'call' as CadenceTaskType,
    title: '',
    description: '',
    observation: '',
    recommendedMessage: '',
  });

  const handleAddTask = async () => {
    if (!selectedTemplateId || !newTask.title) return;

    await createTask.mutateAsync({
      cadence_template_id: selectedTemplateId,
      day_offset: newTask.dayOffset,
      type: newTask.type,
      title: newTask.title,
      description: newTask.description || undefined,
      observation: newTask.observation || undefined,
      recommended_message: newTask.recommendedMessage || undefined,
    });

    setTaskDialogOpen(false);
    setNewTask({ dayOffset: 0, type: 'call', title: '', description: '', observation: '', recommendedMessage: '' });
  };

  const handleDeleteTask = async (taskId: string) => {
    await deleteTask.mutateAsync(taskId);
  };

  const openAddTaskDialog = (templateId: string) => {
    setSelectedTemplateId(templateId);
    setTaskDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <p className="text-muted-foreground text-sm">
          Configure as tarefas automáticas para cada estágio do pipeline
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={selectedPipelineId} onValueChange={setSelectedPipelineId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Pipeline" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as pipelines</SelectItem>
              {pipelines.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!canEdit && (
            <Badge variant="secondary" className="gap-1">
              <Lock className="h-3 w-3" />
              Somente visualização
            </Badge>
          )}
        </div>
      </div>

      {/* Empty State */}
      {filteredTemplates.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <h3 className="font-medium mb-2">Nenhum template de cadência</h3>
            <p className="text-muted-foreground text-sm px-4">
              Os templates de cadência são criados automaticamente baseados nos estágios do pipeline
            </p>
          </CardContent>
        </Card>
      )}

      {/* Stages Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
        {filteredTemplates.map((template) => (
          <Card key={template.id}>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base font-medium">{template.name}</CardTitle>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={() => openAddTaskDialog(template.id)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="pt-0">
              {template.tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhuma tarefa configurada
                </p>
              ) : (
                <div className="space-y-2">
                  {template.tasks.map((task) => {
                    const Icon = taskTypeIcons[task.type as keyof typeof taskTypeIcons] || FileText;
                    return (
                      <div
                        key={task.id}
                        className="flex items-center gap-3 p-3 rounded-lg border border-white/[0.055] bg-white/[0.035] group"
                      >
                        <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab" />
                        <Badge variant="outline" className="shrink-0 font-mono text-xs">
                          D{task.day_offset >= 0 ? '+' : ''}{task.day_offset}
                        </Badge>
                        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <Icon className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{task.title}</p>
                          {task.observation && (
                            <p className="text-xs text-amber-600 mt-0.5 flex items-center gap-1">
                              <Lightbulb className="h-3 w-3" />
                              {task.observation}
                            </p>
                          )}
                          {task.recommended_message && (
                            <p className="text-xs text-green-600 mt-0.5 flex items-center gap-1">
                              <FileEdit className="h-3 w-3" />
                              Mensagem pronta para enviar
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {taskTypeLabels[task.type as keyof typeof taskTypeLabels] || task.type}
                          </p>
                        </div>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteTask(task.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add Task Dialog */}
      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Adicionar Tarefa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Dia</Label>
                <Input
                  type="number"
                  value={newTask.dayOffset}
                  onChange={(e) => setNewTask({ ...newTask, dayOffset: parseInt(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground">
                  0 = dia da entrada, -1 = dia anterior
                </p>
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={newTask.type}
                  onValueChange={(v) => {
                    if (isCadenceTaskType(v)) setNewTask({ ...newTask, type: v });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="call">Ligação</SelectItem>
                    <SelectItem value="message">Mensagem</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="note">Observação</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Título</Label>
              <Input
                value={newTask.title}
                onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                placeholder="Ex: Primeira ligação de apresentação"
              />
            </div>

            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Input
                value={newTask.description}
                onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                placeholder="Instruções adicionais..."
              />
            </div>

            {newTask.type === 'message' && (
              <div className="space-y-2">
                <Label>Mensagem Recomendada</Label>
                <Textarea
                  value={newTask.recommendedMessage}
                  onChange={(e) => setNewTask({ ...newTask, recommendedMessage: e.target.value })}
                  placeholder="Olá {nome}, tudo bem? Gostaria de..."
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Use {'{nome}'} para inserir o nome do lead automaticamente
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Observação Interna (dica para o corretor)</Label>
              <Input
                value={newTask.observation}
                onChange={(e) => setNewTask({ ...newTask, observation: e.target.value })}
                placeholder="Mencionar a promoção do mês..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setTaskDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleAddTask} disabled={createTask.isPending}>
                {createTask.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Adicionar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
