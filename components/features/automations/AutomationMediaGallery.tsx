import { useEffect, useRef, useState } from 'react';
import NextImage from 'next/image';
import { useAuth } from '@/contexts/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Check, Image as ImageIcon, Loader2, Search, Trash2, Upload } from 'lucide-react';
import {
  automationsAPI,
  type AutomationMediaFile,
  type AutomationMediaType,
} from '@/lib/api/automations';
import { VimobAPIError } from '@/lib/api/vimob-client';
import { useAutomationMedia } from '@/hooks/use-automations';

interface AutomationMediaGalleryProps {
  onSelect: (file: AutomationMediaFile) => void;
  onClearSelection?: () => void;
  selectedPath?: string;
  accept?: string;
  mediaType?: AutomationMediaType;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Erro desconhecido';
}

export function AutomationMediaGallery({
  onSelect,
  onClearSelection,
  selectedPath,
  accept = 'image/*',
  mediaType = 'image',
}: AutomationMediaGalleryProps) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onSelectRef = useRef(onSelect);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');

  const orgId = profile?.organization_id;
  const mediaQueryKey = ['automation-media', orgId, mediaType] as const;

  const {
    data: files = [],
    isLoading,
    error,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useAutomationMedia(mediaType);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!selectedPath) return;
    const selectedFile = files.find((file) => file.path === selectedPath);
    if (selectedFile) onSelectRef.current(selectedFile);
  }, [files, selectedPath]);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !orgId) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error('Arquivo muito grande (max 10MB)');
      return;
    }

    setUploading(true);
    try {
      const uploaded = await automationsAPI.uploadMedia(
        {
          mediaType,
          file,
          fileName: file.name,
        },
        orgId,
      );

      queryClient.invalidateQueries({ queryKey: mediaQueryKey });
      onSelect(uploaded);
      toast.success('Arquivo enviado!');
    } catch (err: unknown) {
      toast.error('Erro ao enviar: ' + getErrorMessage(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (file: AutomationMediaFile) => {
      if (!orgId) throw new Error('Organização indisponível');
      await automationsAPI.deleteMedia(mediaType, file.name, orgId);
    },
    onSuccess: (_, file) => {
      if (selectedPath === file.path) onClearSelection?.();
      queryClient.invalidateQueries({ queryKey: mediaQueryKey });
      toast.success('Arquivo removido');
    },
    onError: (err: unknown) => {
      if (err instanceof VimobAPIError && err.status === 409 && err.code === 'automation_media_in_use') {
        toast.error('Este arquivo está em uso por uma automação ativa e não pode ser removido.');
        return;
      }
      toast.error('Erro ao remover: ' + getErrorMessage(err));
    },
  });

  const requestDelete = (file: AutomationMediaFile) => {
    if (!window.confirm(`Remover o arquivo "${file.name}" da galeria?`)) return;
    deleteMutation.mutate(file);
  };

  const filteredFiles = files.filter((file: AutomationMediaFile) => {
    return !search || file.name.toLowerCase().includes(search.toLowerCase());
  });

  const typeLabels: Record<AutomationMediaType, string> = {
    image: 'imagem',
    audio: 'audio',
    video: 'video',
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs flex-1"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5 mr-1.5" />
          )}
          {uploading ? 'Enviando...' : `Enviar ${typeLabels[mediaType]}`}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={handleUpload}
        />
      </div>

      {files.length > 3 && (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar..."
            className="h-7 text-xs pl-7"
            aria-label="Buscar arquivo na galeria"
          />
        </div>
      )}

      <ScrollArea className="max-h-[180px]">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="py-4 text-center text-xs text-destructive" role="alert">
            <p>Não foi possível carregar a galeria.</p>
            <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            <ImageIcon className="h-6 w-6 mx-auto mb-1 opacity-40" />
            <p className="text-[11px]">Nenhum arquivo na galeria</p>
          </div>
        ) : (
          <div className={mediaType === 'image' ? 'grid grid-cols-3 gap-1.5' : 'space-y-1'}>
            {filteredFiles.map((file) => {
              const isSelected = selectedPath === file.path;

              if (mediaType === 'image') {
                return (
                  <div key={file.path} className="group relative aspect-square">
                    <button
                      type="button"
                      className={`relative h-full w-full overflow-hidden rounded-lg border-2 transition-all ${
                      isSelected ? 'border-primary ring-1 ring-primary' : 'border-transparent hover:border-primary/30'
                    }`}
                      onClick={() => onSelect(file)}
                      aria-label={`Selecionar ${file.name}`}
                    >
                      <NextImage
                        src={file.publicUrl}
                        alt=""
                        fill
                        sizes="120px"
                        className="object-cover"
                        unoptimized
                      />
                      {isSelected && (
                        <div className="absolute inset-0 flex items-center justify-center bg-primary/20">
                          <Check className="h-5 w-5 text-primary-foreground drop-shadow-md" aria-hidden="true" />
                        </div>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => requestDelete(file)}
                      className="absolute right-0.5 top-0.5 rounded-full bg-destructive p-0.5 text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                      aria-label={`Remover ${file.name}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              }

              return (
                <div key={file.path} className="group flex items-center gap-1">
                  <button
                    type="button"
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg border p-1.5 text-left transition-all ${
                      isSelected ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-accent/50'
                    }`}
                    onClick={() => onSelect(file)}
                    aria-label={`Selecionar ${file.name}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px]">{file.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {file.size ? `${(file.size / 1024).toFixed(0)}KB` : ''}
                      </p>
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => requestDelete(file)}
                    className="shrink-0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
                    aria-label={`Remover ${file.name}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
      {hasNextPage && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-full text-xs"
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Carregar mais arquivos
        </Button>
      )}
    </div>
  );
}
