import {
  useMemo,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import {
  CircleAlert,
  Check,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Tags as TagsIcon,
  Trash2,
} from "lucide-react";

import { ManagementToolbarPortal } from "@/components/features/crm-management/ManagementToolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useTags,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
} from "@/hooks/use-tags";
import { searchTextIncludes } from "@/lib/search-text";
import { DEFAULT_TAG_COLOR, TAG_COLOR_OPTIONS } from "@/config/tag-colors";
import { getTagColorStyle } from "@/lib/tag-color";

type EditableTag = {
  id: string;
  name: string;
  color: string;
  description?: string | null;
};

export function TagsTab() {
  const {
    data: tags = [],
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useTags();
  const createTag = useCreateTag();
  const updateTag = useUpdateTag();
  const deleteTag = useDeleteTag();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<EditableTag | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    color: string;
    description?: string;
  }>({ name: "", color: DEFAULT_TAG_COLOR });
  const [searchTerm, setSearchTerm] = useState("");
  const [tagToDelete, setTagToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const filteredTags = useMemo(() => {
    if (!searchTerm) return tags;
    return tags.filter((tag) => searchTextIncludes(tag.name, searchTerm));
  }, [tags, searchTerm]);

  const resetForm = () => {
    setEditingTag(null);
    setFormData({ name: "", color: DEFAULT_TAG_COLOR });
  };

  const handleDialogChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) resetForm();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    try {
      if (editingTag) {
        await updateTag.mutateAsync({ id: editingTag.id, ...formData });
      } else {
        await createTag.mutateAsync(formData);
      }

      setDialogOpen(false);
      resetForm();
    } catch {
      // The mutation owns the toast. Keep the form open so the user can retry.
    }
  };

  const openEdit = (tag: EditableTag) => {
    setEditingTag(tag);
    setFormData({
      name: tag.name,
      color: tag.color,
      description: tag.description ?? undefined,
    });
    setDialogOpen(true);
  };

  const handleDelete = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!tagToDelete) return;
    try {
      await deleteTag.mutateAsync(tagToDelete.id);
      setTagToDelete(null);
    } catch {
      // The mutation owns the toast. Keep confirmation open so deletion can be retried.
    }
  };

  const toolbar = (
    <ManagementToolbarPortal>
      <div className="flex w-auto min-w-0 items-center gap-2">
        <div className="relative h-8 w-8 flex-none transition-[width] duration-200 focus-within:w-24 sm:w-[180px] sm:focus-within:w-[180px] lg:w-[220px] xl:w-[280px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--app-text-tertiary)]" />
          <Input
            aria-label="Buscar tags"
            placeholder="Buscar tags..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-solid)] pl-8 pr-2.5 text-[12px] font-light shadow-none placeholder:text-[var(--app-text-tertiary)] focus-visible:ring-1 focus-visible:ring-primary/30"
          />
        </div>

        <Dialog open={dialogOpen} onOpenChange={handleDialogChange}>
          <DialogTrigger asChild>
            <Button
              aria-label="Nova tag"
              title="Nova tag"
              className="h-8 w-8 shrink-0 gap-1.5 rounded-[6px] bg-primary/50 p-0 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary sm:w-auto sm:px-2.5"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Nova tag</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90dvh] w-[calc(100vw-24px)] overflow-y-auto rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-[14px] font-normal">
                {editingTag ? "Editar tag" : "Nova tag"}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {editingTag
                  ? "Altere o nome e a cor da tag."
                  : "Defina o nome e a cor da nova tag."}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="mt-3 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="tag-name" className="text-[12px] font-light">
                  Nome
                </Label>
                <Input
                  id="tag-name"
                  value={formData.name}
                  onChange={(event) =>
                    setFormData({ ...formData, name: event.target.value })
                  }
                  placeholder="Ex: Quente, Investidor..."
                  maxLength={80}
                  required
                  className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[12px] font-light">Cor</Label>
                <div className="flex flex-wrap gap-2">
                  {TAG_COLOR_OPTIONS.map(({ color, name }) => (
                    <button
                      key={color}
                      type="button"
                      title={name}
                      aria-label={`Usar a cor ${name}`}
                      aria-pressed={formData.color === color}
                      className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-[var(--app-border)] shadow-none transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-text-primary)]"
                      style={getTagColorStyle(color)}
                      onClick={() => setFormData({ ...formData, color })}
                    >
                      {formData.color === color && (
                        <Check className="h-3.5 w-3.5 text-current" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 w-[40%] rounded-[6px] border-0 text-[12px] font-light shadow-none"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="h-9 w-[60%] rounded-[6px] bg-primary/50 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
                  disabled={createTag.isPending || updateTag.isPending}
                >
                  {(createTag.isPending || updateTag.isPending) && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  )}
                  {editingTag ? "Salvar" : "Criar"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </ManagementToolbarPortal>
  );

  if (isLoading) {
    return (
      <>
        {toolbar}
        <div className="flex h-64 items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)]">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--app-text-tertiary)]" />
        </div>
      </>
    );
  }

  if (isError) {
    return (
      <>
        {toolbar}
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)] px-4 py-10 text-center shadow-none">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[6px] bg-destructive/10 text-destructive">
            <CircleAlert className="h-5 w-5" aria-hidden="true" />
          </div>
          <h3 className="mb-1 text-[14px] font-normal text-[var(--app-text-primary)]">
            Não foi possível carregar as tags
          </h3>
          <p className="mb-4 max-w-sm text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
            Verifique sua conexão e tente novamente.
          </p>
          <Button
            type="button"
            className="h-9 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Tentar novamente
          </Button>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-3">
      {toolbar}

      {tags.length === 0 ? (
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)] px-4 py-10 text-center shadow-none">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
            <TagsIcon className="h-5 w-5" />
          </div>
          <h3 className="mb-1 text-[14px] font-normal text-[var(--app-text-primary)]">
            Nenhuma tag criada
          </h3>
          <p className="mb-4 max-w-sm text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
            Crie tags para categorizar e organizar seus leads.
          </p>
        </div>
      ) : filteredTags.length > 0 ? (
        <div className="overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] shadow-none">
          <Table className="crm-management-table table-fixed">
            <TableHeader>
              <TableRow className="border-b border-[var(--app-border)] bg-[var(--app-surface-soft)] hover:bg-[var(--app-surface-soft)]">
                <TableHead>Tag</TableHead>
                <TableHead className="w-[64px] text-right sm:w-[96px]">
                  Leads
                </TableHead>
                <TableHead className="w-[84px] px-2 text-right sm:w-[104px] sm:px-4">
                  Ações
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTags.map((tag) => (
                <TableRow
                  key={tag.id}
                  className="border-b border-[var(--app-border)] bg-[var(--app-surface-solid)] hover:bg-[var(--app-surface-hover)] last:border-b-0"
                >
                  <TableCell className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="h-3 w-3 shrink-0 rounded-[3px]"
                        style={getTagColorStyle(tag.color)}
                      />
                      <span className="sr-only">Cor {tag.color}</span>
                      <span className="truncate text-[13px] font-light text-[var(--app-text-primary)]">
                        {tag.name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-[12px] font-light tabular-nums text-[var(--app-text-secondary)]">
                    {tag.lead_count || 0}
                  </TableCell>
                  <TableCell className="px-2 sm:px-4">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
                        aria-label={`Editar tag ${tag.name}`}
                        onClick={() => openEdit(tag)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)] shadow-none hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
                        aria-label={`Excluir tag ${tag.name}`}
                        onClick={() =>
                          setTagToDelete({ id: tag.id, name: tag.name })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)] px-4 py-8 text-center shadow-none">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)]">
            <Search className="h-5 w-5" />
          </div>
          <p className="text-[12px] font-light text-[var(--app-text-secondary)]">
            Nenhuma tag encontrada para &quot;{searchTerm}&quot;.
          </p>
        </div>
      )}

      <AlertDialog
        open={!!tagToDelete}
        onOpenChange={(open) => !open && setTagToDelete(null)}
      >
        <AlertDialogContent className="w-[calc(100vw-24px)] rounded-[8px] border-0 sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[14px] font-normal">
              Excluir tag?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12px] font-light leading-[18px]">
              A tag &quot;{tagToDelete?.name}&quot; será removida. Os leads
              permanecem cadastrados, mas perdem essa classificação.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9 rounded-[6px] text-[12px] font-light">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-9 rounded-[6px] bg-destructive text-[12px] font-light text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteTag.isPending}
              onClick={(event) => void handleDelete(event)}
            >
              {deleteTag.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
