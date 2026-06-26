import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateFeatureRequest } from '@/hooks/use-feature-requests';
import { useOrganizationModules, type ModuleName } from '@/hooks/use-organization-modules';
import { AlertCircle, Lightbulb } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface FeatureRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORY_OPTIONS: { value: string; label: string; module?: ModuleName }[] = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'pipeline', label: 'Pipeline' },
  { value: 'conversations', label: 'Conversas / WhatsApp', module: 'whatsapp' },
  { value: 'agenda', label: 'Agenda', module: 'agenda' },
  { value: 'contacts', label: 'Contatos' },
  { value: 'properties', label: 'Imóveis', module: 'properties' },
  { value: 'financial', label: 'Financeiro', module: 'financial' },
  { value: 'contracts', label: 'Contratos', module: 'financial' },
  { value: 'commissions', label: 'Comissões', module: 'financial' },
  { value: 'automations', label: 'Automações', module: 'automations' },
  { value: 'performance', label: 'Desempenho', module: 'performance' },
  { value: 'notifications', label: 'Notificações' },
  { value: 'settings', label: 'Configurações' },
  { value: 'site', label: 'Site Público', module: 'site' },
  { value: 'other', label: 'Outra área / Nova funcionalidade' },
];

export function FeatureRequestDialog({ open, onOpenChange }: FeatureRequestDialogProps) {
  const [category, setCategory] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const { hasModule } = useOrganizationModules();
  const createRequest = useCreateFeatureRequest();

  // Filter categories based on active modules
  const availableCategories = CATEGORY_OPTIONS.filter(
    (cat) => !cat.module || hasModule(cat.module)
  );

  const handleSubmit = async () => {
    if (!category || !title.trim() || !description.trim()) return;

    await createRequest.mutateAsync({
      category,
      title: title.trim(),
      description: description.trim(),
    });

    // Reset form and close
    setCategory('');
    setTitle('');
    setDescription('');
    onOpenChange(false);
  };

  const isValid = category && title.trim().length >= 5 && description.trim().length >= 20;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90%] sm:max-w-lg sm:w-full rounded-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary" />
            Sugerir Melhoria
          </DialogTitle>
          <DialogDescription>
            Compartilhe suas ideias para melhorar o sistema. Cada solicitação é analisada em 15-30 dias.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="category">Área do Sistema</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a área" />
              </SelectTrigger>
              <SelectContent>
                {availableCategories.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Título da Sugestão</Label>
            <Input
              id="title"
              placeholder="Ex: Filtro avançado por data no pipeline"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground">Mínimo 5 caracteres</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição Detalhada</Label>
            <Textarea
              id="description"
              placeholder="Descreva em detalhes o que você gostaria de ver implementado, como funcionaria e qual problema resolveria..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={2000}
            />
            <p className="text-xs text-muted-foreground">
              {description.length}/2000 caracteres (mínimo 20)
            </p>
          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Solicitações são analisadas em até 15-30 dias. Você receberá uma notificação quando houver uma resposta.
            </AlertDescription>
          </Alert>
        </div>

        <div className="flex gap-2 pt-4">
          <Button variant="outline" className="w-[40%] rounded-xl" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="w-[60%] rounded-xl"
            onClick={handleSubmit}
            disabled={!isValid || createRequest.isPending}
          >
            {createRequest.isPending ? 'Enviando...' : 'Enviar Sugestão'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
