import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  Loader2,
  GripVertical,
  Trash2,
  UserPlus,
  Filter,
  RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { leadsAPI } from '@/lib/api/leads';

// Drag and Drop imports
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';

interface QueueItem {
  id: string;
  name: string;
  source: string;
  created_at: string;
  deal_status: string;
  stage_name: string;
  stage_color: string;
  priority_index: number;
}

function SortableQueueRow({
  item,
  onRemove,
  onAssign
}: {
  item: QueueItem;
  onRemove: (id: string) => void;
  onAssign: (item: QueueItem) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <TableRow ref={setNodeRef} style={style} className={cn(isDragging && "bg-white/[0.055]")}>
      <TableCell className="w-10">
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {item.id.slice(0, 8)}
      </TableCell>
      <TableCell className="font-medium">
        {item.name}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="capitalize">
          {item.source || 'Manual'}
        </Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {format(new Date(item.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
      </TableCell>
      <TableCell>
        <Badge
          style={{ backgroundColor: `${item.stage_color}20`, color: item.stage_color, borderColor: `${item.stage_color}40` }}
          variant="outline"
        >
          {item.stage_name || 'Sem estágio'}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => onAssign(item)}>
            <UserPlus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onRemove(item.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function DistributionQueueTab() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  const [localItems, setLocalItems] = useState<QueueItem[]>([]);

  // Fetch leads unassigned (in queue)
  const { isLoading } = useQuery({
    queryKey: ['distribution-queue-leads', organization?.id],
    queryFn: async () => {
      const { data } = await leadsAPI.getLeads(organization!.id, {
        assigned: 'none',
        limit: 200,
      });

      const mapped: QueueItem[] = (data || []).map((l) => ({
        id: l.id,
        name: l.name || 'Lead sem nome',
        source: l.source || '',
        created_at: l.created_at,
        deal_status: l.deal_status || 'open',
        stage_name: l.stage?.name || 'Sem estágio',
        stage_color: l.stage?.color || '#6b7280',
        priority_index: 0
      }));

      setLocalItems(mapped);
      return mapped;
    },
    enabled: !!organization?.id
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = localItems.findIndex((item) => item.id === active.id);
      const newIndex = localItems.findIndex((item) => item.id === over.id);

      const newOrder = arrayMove(localItems, oldIndex, newIndex);
      setLocalItems(newOrder);

      // Order persisted in local state only (no priority column in DB yet)
      toast.success('Ordem da fila atualizada (sessão atual)');
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm('Tem certeza que deseja remover este item da fila?')) return;

    try {
      const { error } = await leadsAPI.updateLead(id, {
        deal_status: 'lost',
        lost_reason: 'Removido da fila manualmente',
      }, organization?.id);

      if (error) throw error;

      setLocalItems(prev => prev.filter(item => item.id !== id));
      toast.success('Item removido da fila');
    } catch {
      toast.error('Erro ao remover item');
    }
  };

  const handleAssign = async (item: QueueItem) => {
    // This could open a dialog, but for now let's just pick a random admin or show users
    const userId = prompt('Digite o ID do usuário ou use a interface de atribuição manual');
    if (!userId) return;

    try {
      const { error } = await leadsAPI.updateLead(item.id, {
        assigned_user_id: userId,
      }, organization?.id);

      if (error) throw error;

      setLocalItems(prev => prev.filter(i => i.id !== item.id));
      toast.success('Atribuído com sucesso');
    } catch {
      toast.error('Erro na atribuição');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Fila de Distribuição Manual</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {localItems.length} itens aguardando distribuição
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ['distribution-queue-leads'] })}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
          <Button variant="outline" size="sm">
            <Filter className="h-4 w-4 mr-2" />
            Filtrar
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Itens na Fila</CardTitle>
          <CardDescription>
            Arraste e solte para reordenar a prioridade de atendimento
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : localItems.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              Nenhum item na fila de espera.
            </div>
          ) : (
            <div className="border-t">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
                modifiers={[restrictToVerticalAxis]}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead className="w-24">ID</TableHead>
                      <TableHead>Lead</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Entrada</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <SortableContext
                      items={localItems.map(i => i.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {localItems.map((item) => (
                        <SortableQueueRow
                          key={item.id}
                          item={item}
                          onRemove={handleRemove}
                          onAssign={handleAssign}
                        />
                      ))}
                    </SortableContext>
                  </TableBody>
                </Table>
              </DndContext>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
