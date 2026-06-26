import { useState } from "react";
import type { HTMLAttributes } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { Plus, GripVertical, Pencil, Trash2, Globe, Filter, ExternalLink } from "lucide-react";
import { useSiteMenuItems, useCreateMenuItem, useUpdateMenuItem, useDeleteMenuItem, useReorderMenuItems, SiteMenuItem } from "@/hooks/use-site-menu";
import { usePropertyTypes } from "@/hooks/use-property-types";

const PAGE_OPTIONS = [
  { value: "", label: "Home" },
  { value: "imoveis", label: "Imóveis" },
  { value: "sobre", label: "Sobre" },
  { value: "contato", label: "Contato" },
  { value: "favoritos", label: "Favoritos" },
];

const TYPE_CONFIG = {
  page: { label: "Página", color: "bg-blue-100 text-blue-800", icon: Globe },
  filter: { label: "Filtro", color: "bg-green-100 text-green-800", icon: Filter },
  external: { label: "Externo", color: "bg-orange-100 text-orange-800", icon: ExternalLink },
};

interface MenuItemFormData {
  label: string;
  link_type: "page" | "filter" | "external";
  href: string;
  open_in_new_tab: boolean;
  is_active: boolean;
}

const defaultForm: MenuItemFormData = {
  label: "",
  link_type: "page",
  href: "",
  open_in_new_tab: false,
  is_active: true,
};

export function MenuTab() {
  const { data: items = [], isLoading } = useSiteMenuItems();
  const { data: propertyTypes = [] } = usePropertyTypes();
  const createItem = useCreateMenuItem();
  const updateItem = useUpdateMenuItem();
  const deleteItem = useDeleteMenuItem();
  const reorderItems = useReorderMenuItems();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MenuItemFormData>(defaultForm);

  const handleLoadDefaults = async () => {
    const defaults = [
      { label: 'HOME', link_type: 'page' as const, href: '', position: 0, open_in_new_tab: false, is_active: true },
      { label: 'IMÓVEIS', link_type: 'page' as const, href: 'imoveis', position: 1, open_in_new_tab: false, is_active: true },
      { label: 'APARTAMENTO', link_type: 'filter' as const, href: 'imoveis?tipo=Apartamento', position: 2, open_in_new_tab: false, is_active: true },
      { label: 'CASA', link_type: 'filter' as const, href: 'imoveis?tipo=Casa', position: 3, open_in_new_tab: false, is_active: true },
      { label: 'SOBRE', link_type: 'page' as const, href: 'sobre', position: 4, open_in_new_tab: false, is_active: true },
      { label: 'CONTATO', link_type: 'page' as const, href: 'contato', position: 5, open_in_new_tab: false, is_active: true },
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

  const openEdit = (item: SiteMenuItem) => {
    setEditingId(item.id);
    setForm({
      label: item.label,
      link_type: item.link_type,
      href: item.href,
      open_in_new_tab: item.open_in_new_tab,
      is_active: item.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.label.trim()) return;

    if (editingId) {
      await updateItem.mutateAsync({ id: editingId, ...form });
    } else {
      await createItem.mutateAsync({
        ...form,
        position: items.length,
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

  // Auto-set label and href when selecting a page
  const handlePageSelect = (value: string) => {
    const actualValue = value === "__home__" ? "" : value;
    const page = PAGE_OPTIONS.find(p => p.value === actualValue);
    setForm(prev => ({
      ...prev,
      href: actualValue,
      label: prev.label || (page?.label.toUpperCase() ?? ""),
    }));
  };

  // Auto-set label and href when selecting a filter
  const handleFilterSelect = (value: string) => {
    if (value === "aluguel") {
      setForm(prev => ({
        ...prev,
        href: "imoveis?finalidade=aluguel",
        label: prev.label || "ALUGUEL",
      }));
    } else {
      setForm(prev => ({
        ...prev,
        href: `imoveis?tipo=${value}`,
        label: prev.label || value.toUpperCase(),
      }));
    }
  };

  const filterOptions = [
    ...propertyTypes.map(t => ({ value: t, label: t })),
    { value: "aluguel", label: "Aluguel" },
  ];

  return (
    <div className="space-y-6">
      <Card className="app-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Itens do Menu</CardTitle>
              <CardDescription>Configure os links que aparecem no menu do site público</CardDescription>
            </div>
            <Button onClick={openAdd} size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Item
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="mb-2">Nenhum item configurado</p>
              <p className="text-sm mb-4">O menu padrão será exibido enquanto nenhum item for adicionado.</p>
              <Button variant="outline" onClick={handleLoadDefaults} disabled={createItem.isPending}>
                Carregar Menu Padrão
              </Button>
            </div>
          ) : (
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="menu-items">
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
                    {items.map((item, index) => (
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
                                <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${TYPE_CONFIG[item.link_type].color}`}>
                                  {TYPE_CONFIG[item.link_type].label}
                                </Badge>
                                {!item.is_active && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">Inativo</Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {item.link_type === 'external' ? item.href : `/${item.href}`}
                              </p>
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
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Item" : "Adicionar Item ao Menu"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={form.link_type}
                onValueChange={(v: "page" | "filter" | "external") => setForm({ ...form, link_type: v, href: "", label: editingId ? form.label : "" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="page">Página Interna</SelectItem>
                  <SelectItem value="filter">Filtro de Categoria</SelectItem>
                  <SelectItem value="external">Link Externo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.link_type === "page" && (
              <div className="space-y-2">
                <Label>Página</Label>
                <Select value={form.href === "" ? "__home__" : form.href} onValueChange={handlePageSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a página" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_OPTIONS.map(p => (
                      <SelectItem key={p.value} value={p.value || "__home__"}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {form.link_type === "filter" && (
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={form.href.includes('finalidade') ? 'aluguel' : form.href.replace('imoveis?tipo=', '')} onValueChange={handleFilterSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    {filterOptions.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {form.link_type === "external" && (
              <div className="space-y-2">
                <Label>URL</Label>
                <Input
                  placeholder="https://..."
                  value={form.href}
                  onChange={(e) => setForm({ ...form, href: e.target.value })}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Label do Menu</Label>
              <Input
                placeholder="Ex: HOME, APARTAMENTOS, BLOG"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </div>

            {form.link_type === "external" && (
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={form.open_in_new_tab}
                  onCheckedChange={(checked) => setForm({ ...form, open_in_new_tab: !!checked })}
                />
                <Label className="cursor-pointer">Abrir em nova aba</Label>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!form.label.trim() || createItem.isPending || updateItem.isPending}>
              {editingId ? "Salvar" : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
