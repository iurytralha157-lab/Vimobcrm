import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  MoreHorizontal,
  Users,
  Pencil,
  Trash2,
  Loader2,
  Tags as TagsIcon,
  Search,
  TrendingUp,
  Hash
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
  const [editingTag, setEditingTag] = useState<{ id: string; name: string; color: string; description?: string } | null>(null);
  const [formData, setFormData] = useState({ name: '', color: '#3b82f6', description: '' });
  const [searchTerm, setSearchTerm] = useState('');

  const filteredTags = useMemo(() => {
    if (!searchTerm) return tags;
    const lower = searchTerm.toLowerCase();
    return tags.filter(tag =>
      tag.name.toLowerCase().includes(lower) ||
      tag.description?.toLowerCase().includes(lower)
    );
  }, [tags, searchTerm]);

  // Stats
  const totalLeadsTagged = useMemo(() =>
    tags.reduce((acc, tag) => acc + (tag.lead_count || 0), 0)
  , [tags]);

  const topTag = useMemo(() => {
    if (tags.length === 0) return null;
    return [...tags].sort((a, b) => (b.lead_count || 0) - (a.lead_count || 0))[0];
  }, [tags]);

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
    setFormData({ name: '', color: '#3b82f6', description: '' });
  };

  const openEdit = (tag: { id: string; name: string; color: string; description?: string | null }) => {
    setEditingTag({ id: tag.id, name: tag.name, color: tag.color, description: tag.description || '' });
    setFormData({ name: tag.name, color: tag.color, description: tag.description || '' });
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    await deleteTag.mutateAsync(id);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <TagsIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{tags.length}</p>
              <p className="text-xs text-muted-foreground">Tags criadas</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Users className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalLeadsTagged}</p>
              <p className="text-xs text-muted-foreground">Leads tagueados</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{topTag?.lead_count || 0}</p>
              <p className="text-xs text-muted-foreground truncate" title={topTag?.name}>
                {topTag?.name || 'Tag mais usada'}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Hash className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {tags.length > 0 ? Math.round(totalLeadsTagged / tags.length) : 0}
              </p>
              <p className="text-xs text-muted-foreground">Média por tag</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Header with Search and Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex-1 w-full sm:max-w-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar tags..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingTag(null);
            setFormData({ name: '', color: '#3b82f6', description: '' });
          }
        }}>
          <DialogTrigger asChild>
            <Button className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-2" />
              Nova Tag
            </Button>
          </DialogTrigger>
          <DialogContent className="w-[90%] sm:max-w-md sm:w-full rounded-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingTag ? 'Editar Tag' : 'Nova Tag'}</DialogTitle>
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
                      className={`w-10 h-10 rounded-lg transition-all flex items-center justify-center ${
                        formData.color === color
                          ? 'scale-110 ring-2 ring-offset-2 ring-primary shadow-lg'
                          : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => setFormData({ ...formData, color })}
                    >
                      {formData.color === color && (
                        <span className="text-white text-lg">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Descrição (opcional)</Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Descrição da tag..."
                />
              </div>

              <div className="flex gap-2 pt-4">
                <Button type="button" variant="outline" className="w-[40%] rounded-xl" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" className="w-[60%] rounded-xl" disabled={createTag.isPending || updateTag.isPending}>
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
        <Card className="app-card">
          <CardContent className="py-12 text-center">
            <div className="h-16 w-16 rounded-full bg-white/[0.06] flex items-center justify-center mx-auto mb-4">
              <TagsIcon className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-medium text-lg mb-2">Nenhuma tag criada</h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
              Crie tags para categorizar e organizar seus leads de forma eficiente
            </p>
            <Button onClick={() => setDialogOpen(true)} size="lg">
              <Plus className="h-4 w-4 mr-2" />
              Criar primeira tag
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Tags Grid */}
      {filteredTags.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredTags.map((tag) => {
            const percentage = maxLeadCount > 0 ? ((tag.lead_count || 0) / maxLeadCount) * 100 : 0;

            return (
              <Card key={tag.id} className="group hover:shadow-md transition-all">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center shadow-sm"
                        style={{ backgroundColor: `${tag.color}20` }}
                      >
                        <TagsIcon className="h-6 w-6" style={{ color: tag.color }} />
                      </div>
                      <div>
                        <Badge
                          variant="secondary"
                          style={{ backgroundColor: tag.color, color: '#FFFFFF' }}
                          className="text-sm font-semibold border-0"
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
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
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
                          onClick={() => handleDelete(tag.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {tag.description && (
                    <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                      {tag.description}
                    </p>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Leads</span>
                      <span className="font-semibold">{tag.lead_count || 0}</span>
                    </div>
                    <Progress
                      value={percentage}
                      className="h-2"
                      style={{
                        '--progress-color': tag.color
                      } as React.CSSProperties}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* No Results */}
      {tags.length > 0 && filteredTags.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <Search className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">
              Nenhuma tag encontrada para &quot;{searchTerm}&quot;
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
