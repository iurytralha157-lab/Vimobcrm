import { useState } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useMessageTemplatesByCategory,
  useCreateMessageTemplate,
  useDeleteMessageTemplate,
  replaceTemplateVariables,
  TEMPLATE_CATEGORIES,
  type MessageTemplate,
  type TemplateVariables,
} from '@/hooks/use-message-templates';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface QuickMessageTemplatesProps {
  onSelectTemplate: (content: string) => void;
  leadName?: string;
  variables?: TemplateVariables;
}

export function QuickMessageTemplates({
  onSelectTemplate,
  leadName,
  variables = {},
}: QuickMessageTemplatesProps) {
  const { profile, organization } = useAuth();
  const { data: groupedTemplates, isLoading } = useMessageTemplatesByCategory();
  const createTemplate = useCreateMessageTemplate();
  const deleteTemplate = useDeleteMessageTemplate();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    content: '',
    category: 'geral',
  });

  // Combine provided variables with defaults
  const allVariables: TemplateVariables = {
    nome: leadName || '',
    corretor: profile?.name || '',
    imobiliaria: organization?.name || '',
    data: new Date().toLocaleDateString('pt-BR'),
    horario: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    ...variables,
  };

  const handleSelectTemplate = (template: MessageTemplate) => {
    const processedContent = replaceTemplateVariables(template.content, allVariables);
    onSelectTemplate(processedContent);
    toast.success('Template inserido!');
  };

  const handleCreateTemplate = async () => {
    if (!newTemplate.name.trim() || !newTemplate.content.trim()) {
      toast.error('Preencha o nome e conteúdo do template');
      return;
    }

    await createTemplate.mutateAsync({
      name: newTemplate.name,
      content: newTemplate.content,
      category: newTemplate.category,
    });

    setCreateDialogOpen(false);
    setNewTemplate({ name: '', content: '', category: 'geral' });
  };

  const handleDeleteTemplate = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteTemplate.mutateAsync(id);
  };

  const hasTemplates = Object.values(groupedTemplates).some(arr => arr.length > 0);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            title="Templates de mensagem"
          >
            <FileText className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 max-h-[400px] overflow-y-auto">
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>Templates Rápidos</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2"
              onClick={() => setCreateDialogOpen(true)}
            >
              <Plus className="h-3 w-3 mr-1" />
              Novo
            </Button>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {isLoading ? (
            <div className="p-3 text-sm text-muted-foreground text-center">
              Carregando...
            </div>
          ) : !hasTemplates ? (
            <div className="p-4 text-center">
              <p className="text-sm text-muted-foreground mb-2">
                Nenhum template criado
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateDialogOpen(true)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Criar primeiro template
              </Button>
            </div>
          ) : (
            Object.entries(groupedTemplates).map(([category, templates]) => (
              templates.length > 0 && (
                <div key={category}>
                  <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wider">
                    {TEMPLATE_CATEGORIES[category] || category}
                  </DropdownMenuLabel>
                  {templates.map((template) => (
                    <DropdownMenuItem
                      key={template.id}
                      onClick={() => handleSelectTemplate(template)}
                      className="flex items-start justify-between gap-2 cursor-pointer"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{template.name}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {template.content}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 opacity-50 hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                        onClick={(e) => handleDeleteTemplate(template.id, e)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </div>
              )
            ))
          )}

          <div className="p-2 text-xs text-muted-foreground">
            <p>Variáveis disponíveis:</p>
            <code className="text-[10px]">{'{nome}'} {'{corretor}'} {'{data}'} {'{horario}'}</code>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create Template Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="w-[90%] sm:max-w-md sm:w-full rounded-lg">
          <DialogHeader>
            <DialogTitle>Novo Template de Mensagem</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label>Nome do template</Label>
              <Input
                placeholder="Ex: Saudação inicial"
                value={newTemplate.name}
                onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
              />
            </div>

            <div>
              <Label>Categoria</Label>
              <Select
                value={newTemplate.category}
                onValueChange={(v) => setNewTemplate({ ...newTemplate, category: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TEMPLATE_CATEGORIES).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Conteúdo</Label>
              <Textarea
                placeholder="Olá {nome}! Aqui é o/a {corretor}..."
                value={newTemplate.content}
                onChange={(e) => setNewTemplate({ ...newTemplate, content: e.target.value })}
                rows={4}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Use variáveis: {'{nome}'}, {'{corretor}'}, {'{imobiliaria}'}, {'{data}'}, {'{horario}'}
              </p>
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button variant="outline" className="w-[40%] rounded-xl" onClick={() => setCreateDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              className="w-[60%] rounded-xl"
              onClick={handleCreateTemplate}
              disabled={createTemplate.isPending}
            >
              {createTemplate.isPending ? 'Criando...' : 'Criar Template'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
