import { useState, useMemo } from 'react';
import { searchTextIncludes } from '@/lib/search-text';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Check,
  Tags as TagsIcon,
  Search
} from 'lucide-react';
import { useTags, useCreateTag, useUpdateTag, useDeleteTag } from '@/hooks/use-tags';

const colorOptions = [
  { color: '#ef4444', name: 'Vermelho' },
  { color: '#f59e0b', name: 'Laranja' },
  { color: '#22c55e', name: 'Verde' },
  { color: '#3b82f6', name: 'Azul' },
  { color: '#8b5cf6', name: 'Roxo' },
  { color: '#ec4899', name: 'Rosa' },
  { color: '#06b6d4', name: 'Ciano' },
  { color: '#6b7280', name: 'Cinza' },
];

export function TagsTab() {
  const { data: tags = [], isLoading } = useTags();
  const createTag = useCreateTag();
  const updateTag = useUpdateTag();
  const deleteTag = useDeleteTag();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<{ id: string; name: string; color: string } | null>(null);
  const [formData, setFormData] = useState({ name: '', color: '#3b82f6' });
  const [searchTerm, setSearchTerm] = useState('');
  const [tagToDelete, setTagToDelete] = useState<{ id: string; name: string } | null>(null);

  const filteredTags = useMemo(() => {
    if (!searchTerm) return tags;
    return tags.filter(tag => searchTextIncludes(tag.name, searchTerm));
  }, [tags, searchTerm]);

  const maxLeadCount = useMemo(() =>
    Math.max(...tags.map(t => t.lead_count || 0), 1)
  , [tags]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (editingTag) {
      await updateTag.mutateAsync({ id: editingTag.id, ...formData });
    } else {
      await createTag.mutateAsync(formData);
    }

    setDialogOpen(false);
    setEditingTag(null);
    setFormData({ name: '', color: '#3b82f6' });
  };

  const openEdit = (tag: { id: string; name: string; color: string }) => {
    setEditingTag({ id: tag.id, name: tag.name, color: tag.color });
    setFormData({ name: tag.name, color: tag.color });
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!tagToDelete) return;
    await deleteTag.mutateAsync(tagToDelete.id);
    setTagToDelete(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex-1 w-full sm:max-w-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar tags..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 rounded-[8px] border-0 bg-[var(--app-surface)] pl-9 shadow-none"
            />
          </div>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingTag(null);
            setFormData({ name: '', color: '#3b82f6' });
          }
        }}>
          <DialogTrigger asChild>
            <Button className="h-9 w-full gap-2 rounded-[8px] px-3 shadow-none sm:w-auto">
              <Plus className="h-4 w-4 mr-2" />
              Nova Tag
            </Button>
          </DialogTrigger>
          <DialogContent className="w-[90%] sm:max-w-md sm:w-full rounded-lg border-0 shadow-none max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingTag ? 'Editar Tag' : 'Nova Tag'}</DialogTitle>
              <DialogDescription className="sr-only">
                {editingTag ? 'Altere o nome e a cor da tag.' : 'Defina o nome e a cor da nova tag.'}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: Quente, Investidor..."
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Cor</Label>
                <div className="flex flex-wrap gap-2">
                  {colorOptions.map(({ color, name }) => (
                    <button
                      key={color}
                      type="button"
                      title={name}
                      className={`w-9 h-9 rounded-lg transition-all flex items-center justify-center ${
                        formData.color === color
                          ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                          : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => setFormData({ ...formData, color })}
                    >
                      {formData.color === color && (
                        <Check className="h-4 w-4 text-white" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <Button type="button" variant="secondary" className="w-[40%] rounded-lg border-0 shadow-none" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" className="w-[60%] rounded-lg shadow-none" disabled={createTag.isPending || updateTag.isPending}>
                  {(createTag.isPending || updateTag.isPending) && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {editingTag ? 'Salvar' : 'Criar'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Empty State */}
      {tags.length === 0 && (
        <Card className="rounded-lg border-0 bg-[var(--app-surface)] shadow-none">
          <CardContent className="py-12 text-center">
            <div className="h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <TagsIcon className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-medium text-lg mb-2">Nenhuma tag criada</h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
              Crie tags para categorizar e organizar seus leads de forma eficiente
            </p>
            <Button onClick={() => setDialogOpen(true)} size="lg" className="gap-2 rounded-lg shadow-none">
              <Plus className="h-4 w-4 mr-2" />
              Criar primeira tag
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Tags Grid */}
      {filteredTags.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {filteredTags.map((tag) => {
            const percentage = maxLeadCount > 0 ? ((tag.lead_count || 0) / maxLeadCount) * 100 : 0;

            return (
              <Card key={tag.id} className="group rounded-[8px] border-0 bg-[var(--app-surface)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)]">
                <CardContent className="p-4">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div
                        className="h-10 w-10 rounded-[7px] flex items-center justify-center"
                        style={{ backgroundColor: `${tag.color}20` }}
                      >
                        <TagsIcon className="h-5 w-5" style={{ color: tag.color }} />
                      </div>
                      <div className="min-w-0">
                        <Badge
                          variant="secondary"
                          style={{ backgroundColor: tag.color, color: '#FFFFFF' }}
                          className="max-w-full truncate rounded-[5px] border-0 text-xs font-semibold"
                        >
                          {tag.name}
                        </Badge>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(tag)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setTagToDelete({ id: tag.id, name: tag.name })}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Leads</span>
                      <span className="font-semibold">{tag.lead_count || 0}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--app-surface-soft)]">
                      <div className="h-full rounded-full transition-[width]" style={{ width: `${percentage}%`, backgroundColor: tag.color }} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* No Results */}
      {tags.length > 0 && filteredTags.length === 0 && (
        <Card className="rounded-lg border-0 bg-[var(--app-surface)] shadow-none">
          <CardContent className="py-8 text-center">
            <Search className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">
              Nenhuma tag encontrada para &quot;{searchTerm}&quot;
            </p>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!tagToDelete} onOpenChange={(open) => !open && setTagToDelete(null)}>
        <AlertDialogContent className="w-[calc(100vw-24px)] rounded-[8px] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir tag?</AlertDialogTitle>
            <AlertDialogDescription>
              A tag &quot;{tagToDelete?.name}&quot; será removida. Os leads permanecem cadastrados, mas perdem essa classificação.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-[7px]">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="rounded-[7px] bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleteTag.isPending} onClick={handleDelete}>
              {deleteTag.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
