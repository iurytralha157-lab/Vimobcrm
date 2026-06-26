import { useState } from "react";
import type { HTMLAttributes } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { Plus, GripVertical, Pencil, Trash2, Search } from "lucide-react";
import {
  useSiteSearchFilters,
  useCreateSearchFilter,
  useUpdateSearchFilter,
  useDeleteSearchFilter,
  useReorderSearchFilters,
  AVAILABLE_FILTERS,
  SiteSearchFilter,
} from "@/hooks/use-site-search-filters";

interface FilterFormData {
  filter_key: string;
  label: string;
  is_active: boolean;
}

const defaultForm: FilterFormData = {
  filter_key: "",
  label: "",
  is_active: true,
};

export function SearchFiltersTab() {
  const { data: items = [], isLoading } = useSiteSearchFilters();
  const createItem = useCreateSearchFilter();
  const updateItem = useUpdateSearchFilter();
  const deleteItem = useDeleteSearchFilter();
  const reorderItems = useReorderSearchFilters();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FilterFormData>(defaultForm);

  // Filters already added
  const usedKeys = items.map(i => i.filter_key);
  const availableToAdd = AVAILABLE_FILTERS.filter(f => !usedKeys.includes(f.key));

  const handleLoadDefaults = async () => {
    const defaults = [
      { filter_key: 'search', label: 'Buscar', position: 0, is_active: true },
      { filter_key: 'tipo', label: 'Tipo de Imóvel', position: 1, is_active: true },
      { filter_key: 'finalidade', label: 'Finalidade', position: 2, is_active: true },
    ];
    for (const item of defaults) {
      await createItem.mutateAsync(item);
    }
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(defaultForm);
    setDialogOpen(true);
  };

  const openEdit = (item: SiteSearchFilter) => {
    setEditingId(item.id);
    setForm({
      filter_key: item.filter_key,
      label: item.label,
      is_active: item.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.filter_key || !form.label.trim()) return;

    if (editingId) {
      await updateItem.mutateAsync({ id: editingId, label: form.label, is_active: form.is_active });
    } else {
      await createItem.mutateAsync({
        filter_key: form.filter_key,
        label: form.label,
        position: items.length,
        is_active: form.is_active,
      });
    }
    setDialogOpen(false);
  };

  const handleDelete = async (id: string) => {
    await deleteItem.mutateAsync(id);
  };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const reordered = Array.from(items);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);

    const updates = reordered.map((item, index) => ({
      id: item.id,
      position: index,
    }));

    reorderItems.mutate(updates);
  };

  const handleFilterKeyChange = (key: string) => {
    const filter = AVAILABLE_FILTERS.find(f => f.key === key);
    setForm(prev => ({
      ...prev,
      filter_key: key,
      label: prev.label || filter?.defaultLabel || '',
    }));
  };

  return (
    <Card className="app-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Search className="w-5 h-5" />
              Filtros da Barra de Pesquisa
            </CardTitle>
            <CardDescription>Configure quais filtros aparecem na barra de pesquisa da home page</CardDescription>
          </div>
          <Button onClick={openAdd} size="sm" disabled={availableToAdd.length === 0}>
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Filtro
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="mb-2">Nenhum filtro configurado</p>
            <p className="text-sm mb-4">Os filtros padrão (Busca, Tipo, Finalidade) serão exibidos.</p>
            <Button variant="outline" onClick={handleLoadDefaults} disabled={createItem.isPending}>
              Carregar Filtros Padrão
            </Button>
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="search-filters">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
                  {items.map((item, index) => {
                    const filterMeta = AVAILABLE_FILTERS.find(f => f.key === item.filter_key);
                    return (
                      <Draggable key={item.id} draggableId={item.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...(provided.draggableProps as HTMLAttributes<HTMLDivElement>)}
                            className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                              snapshot.isDragging ? "bg-accent shadow-lg" : "bg-background hover:bg-accent/50"
                            } ${!item.is_active ? "opacity-50" : ""}`}
                          >
                            <div {...provided.dragHandleProps} className="cursor-grab">
                              <GripVertical className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm truncate">{item.label}</span>
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                  {filterMeta?.label || item.filter_key}
                                </Badge>
                                {!item.is_active && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">Inativo</Badge>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(item)}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(item.id)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}
      </CardContent>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Filtro" : "Adicionar Filtro à Barra de Pesquisa"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {!editingId && (
              <div className="space-y-2">
                <Label>Filtro</Label>
                <Select value={form.filter_key} onValueChange={handleFilterKeyChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o filtro" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableToAdd.map(f => (
                      <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Label (rótulo exibido)</Label>
              <Input
                placeholder="Ex: Buscar, Tipo de Imóvel..."
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!form.filter_key || !form.label.trim() || createItem.isPending || updateItem.isPending}>
              {editingId ? "Salvar" : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
