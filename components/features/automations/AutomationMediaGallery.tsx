import { useRef, useState } from 'react';
import NextImage from 'next/image';
import { useAuth } from '@/contexts/AuthContext';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

interface AutomationMediaGalleryProps {
  onSelect: (url: string) => void;
  selectedUrl?: string;
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
  selectedUrl,
  accept = 'image/*',
  mediaType = 'image',
}: AutomationMediaGalleryProps) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');

  const orgId = profile?.organization_id;
  const mediaQueryKey = ['automation-media', orgId, mediaType] as const;

  const { data: files = [], isLoading } = useQuery({
    queryKey: mediaQueryKey,
    queryFn: () => automationsAPI.listMedia(mediaType, orgId),
    enabled: !!orgId,
  });

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
      onSelect(uploaded.publicUrl);
      toast.success('Arquivo enviado!');
    } catch (err: unknown) {
      toast.error('Erro ao enviar: ' + getErrorMessage(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (fileName: string) => {
      if (!orgId) throw new Error('Organizacao indisponivel');
      await automationsAPI.deleteMedia(mediaType, fileName, orgId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mediaQueryKey });
      toast.success('Arquivo removido');
    },
    onError: (err: unknown) => toast.error('Erro ao remover: ' + getErrorMessage(err)),
  });

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
          />
        </div>
      )}

      <ScrollArea className="max-h-[180px]">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            <ImageIcon className="h-6 w-6 mx-auto mb-1 opacity-40" />
            <p className="text-[11px]">Nenhum arquivo na galeria</p>
          </div>
        ) : (
          <div className={mediaType === 'image' ? 'grid grid-cols-3 gap-1.5' : 'space-y-1'}>
            {filteredFiles.map((file) => {
              const isSelected = selectedUrl === file.publicUrl;

              if (mediaType === 'image') {
                return (
                  <div
                    key={file.path}
                    className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all aspect-square ${
                      isSelected ? 'border-primary ring-1 ring-primary' : 'border-transparent hover:border-primary/30'
                    }`}
                    onClick={() => onSelect(file.publicUrl)}
                  >
                    <NextImage
                      src={file.publicUrl}
                      alt={file.name}
                      fill
                      sizes="120px"
                      className="object-cover"
                      unoptimized
                    />
                    {isSelected && (
                      <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                        <Check className="h-5 w-5 text-primary-foreground drop-shadow-md" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteMutation.mutate(file.name);
                      }}
                      className="absolute top-0.5 right-0.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              }

              return (
                <div
                  key={file.path}
                  className={`group flex items-center gap-2 p-1.5 rounded-lg cursor-pointer border transition-all ${
                    isSelected ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-accent/50'
                  }`}
                  onClick={() => onSelect(file.publicUrl)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] truncate">{file.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {file.size ? `${(file.size / 1024).toFixed(0)}KB` : ''}
                    </p>
                  </div>
                  {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteMutation.mutate(file.name);
                    }}
                    className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity shrink-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
