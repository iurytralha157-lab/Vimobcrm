import { useCallback, useState, type ChangeEvent, type CSSProperties, type ReactNode } from 'react';
import Image from 'next/image';
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from '@hello-pangea/dnd';
import { Eye, EyeOff, GripVertical, Image as ImageIcon, Loader2, Maximize2, Star, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { uploadPropertyImage } from '@/lib/api/property-images';
import { cn } from '@/lib/utils';

interface ImageUploaderProps {
  images: string[];
  mainImage: string;
  onImagesChange: (images: string[], mainImage: string) => void;
  hiddenSiteImages?: string[];
  onHiddenSiteImagesChange?: (images: string[]) => void;
  organizationId?: string;
  propertyId?: string;
}

const MAX_IMAGE_SIZE_MB = 10;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

interface MediaActionButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}

function MediaActionButton({ label, onClick, children, className }: MediaActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={label}
          className={cn(
            'h-8 w-8 rounded-[6px] border-0 bg-white/95 text-zinc-900 shadow-sm hover:bg-white',
            'dark:bg-zinc-950/90 dark:text-zinc-50 dark:hover:bg-zinc-900',
            className,
          )}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ImageUploader({
  images,
  mainImage,
  onImagesChange,
  hiddenSiteImages = [],
  onHiddenSiteImagesChange,
  organizationId,
  propertyId,
}: ImageUploaderProps) {
  const [uploadingMain, setUploadingMain] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);

  const uploadFile = useCallback(
    async (file: File): Promise<string | null> => {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        toast.error(`${file.name}: tipo de arquivo nao permitido.`);
        return null;
      }

      if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
        toast.error(`${file.name}: arquivo muito grande (limite 10MB).`);
        return null;
      }

      try {
        const uploaded = await uploadPropertyImage(file, {
          organizationId,
          propertyId,
        });

        return uploaded.url;
      } catch (error: unknown) {
        console.error('Upload error:', error);
        toast.error(`Falha no upload de ${file.name}: ${getErrorMessage(error)}`);
        return null;
      }
    },
    [organizationId, propertyId],
  );

  const handleMainImageUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        toast.error('Arquivo nao e uma imagem valida');
        return;
      }

      setUploadingMain(true);
      try {
        const url = await uploadFile(file);
        if (url) {
          onImagesChange(images, url);
          toast.success('Imagem principal enviada!');
        }
      } catch (error: unknown) {
        toast.error('Erro ao enviar imagem: ' + getErrorMessage(error));
      } finally {
        setUploadingMain(false);
        event.target.value = '';
      }
    },
    [images, onImagesChange, uploadFile],
  );

  const handleGalleryUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      const validFiles = Array.from(files).filter((file) => {
        if (!file.type.startsWith('image/')) {
          toast.error(`${file.name} nao e uma imagem valida`);
          return false;
        }

        return true;
      });

      if (validFiles.length === 0) {
        event.target.value = '';
        return;
      }

      setUploadingGallery(true);
      try {
        const results = await Promise.all(validFiles.map((file) => uploadFile(file)));
        const newUrls = results.filter((url): url is string => url !== null);

        if (newUrls.length > 0) {
          onImagesChange([...images, ...newUrls], mainImage);
          toast.success(`${newUrls.length} imagem(s) adicionada(s) a galeria!`);
        }
      } catch (error: unknown) {
        toast.error('Erro ao enviar imagens: ' + getErrorMessage(error));
      } finally {
        setUploadingGallery(false);
        event.target.value = '';
      }
    },
    [images, mainImage, onImagesChange, uploadFile],
  );

  const removeFromGallery = (url: string) => {
    onImagesChange(
      images.filter((image) => image !== url),
      mainImage,
    );
    onHiddenSiteImagesChange?.(hiddenSiteImages.filter((image) => image !== url));
  };

  const removeMainImage = () => {
    onImagesChange(images, '');
  };

  const promoteToMain = (url: string) => {
    const nextImages = images.filter((image) => image !== url);
    if (mainImage) {
      nextImages.unshift(mainImage);
    }

    onImagesChange(nextImages, url);
    toast.success('Imagem promovida para principal!');
  };

  const toggleSiteVisibility = (url: string) => {
    if (!onHiddenSiteImagesChange) return;

    const isHidden = hiddenSiteImages.includes(url);
    onHiddenSiteImagesChange(
      isHidden
        ? hiddenSiteImages.filter((image) => image !== url)
        : [...hiddenSiteImages, url],
    );
    toast.success(isHidden ? 'Foto marcada para aparecer no site.' : 'Foto marcada apenas como interna.');
  };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const sourceIndex = result.source.index;
    const destinationIndex = result.destination.index;
    if (sourceIndex === destinationIndex) return;

    const reorderedImages = Array.from(images);
    const [movedImage] = reorderedImages.splice(sourceIndex, 1);
    reorderedImages.splice(destinationIndex, 0, movedImage);

    onImagesChange(reorderedImages, mainImage);
    toast.success('Ordem das imagens atualizada!');
  };

  return (
    <TooltipProvider delayDuration={100}>
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <Label className="text-base font-medium">Imagem Principal</Label>
        <p className="text-sm text-muted-foreground">
          Esta imagem sera exibida em destaque nos anuncios
        </p>

        {mainImage ? (
          <div className="group relative h-[220px] w-full overflow-hidden rounded-[8px] border border-primary/55 bg-[var(--app-surface-soft)]">
            <Image
              src={mainImage}
              alt="Imagem principal"
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
              unoptimized
            />
            <div className="absolute left-2 top-2 flex items-center gap-1 rounded-[6px] bg-primary px-2 py-1 text-xs font-medium text-primary-foreground shadow-sm">
              <Star className="h-3 w-3 fill-current" />
              Principal
            </div>
            <div className="absolute right-2 top-2 flex items-center gap-1.5">
              <MediaActionButton label="Ver imagem inteira" onClick={() => setPreviewImage({ url: mainImage, title: 'Imagem principal' })}>
                <Maximize2 className="h-4 w-4" />
              </MediaActionButton>
              <label
                className={cn(
                  'inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[6px] bg-white/95 px-2 text-xs font-medium text-zinc-900 shadow-sm hover:bg-white',
                  'dark:bg-zinc-950/90 dark:text-zinc-50 dark:hover:bg-zinc-900',
                )}
                title="Trocar imagem principal"
              >
                <Upload className="h-3.5 w-3.5" />
                Trocar
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={handleMainImageUpload}
                  disabled={uploadingMain}
                />
              </label>
              <MediaActionButton label="Remover imagem principal" onClick={removeMainImage} className="text-primary hover:text-primary">
                <X className="h-4 w-4" />
              </MediaActionButton>
            </div>
          </div>
        ) : (
          <label
            className={cn(
              'flex flex-col items-center justify-center w-full min-h-[200px] border-2 border-dashed rounded-lg cursor-pointer',
              'border-primary/35 bg-primary/5 transition-colors hover:border-primary/45 hover:bg-primary/10',
              uploadingMain && 'opacity-50 cursor-not-allowed',
            )}
          >
            <div className="flex flex-col items-center justify-center py-6">
              {uploadingMain ? (
                <Loader2 className="h-10 w-10 text-primary animate-spin" />
              ) : (
                <>
                  <Star className="h-10 w-10 text-primary/60 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-primary">Clique para enviar</span> a imagem
                    principal
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">PNG, JPG ate 10MB</p>
                </>
              )}
            </div>
            <input
              type="file"
              className="hidden"
              accept="image/*"
              onChange={handleMainImageUpload}
              disabled={uploadingMain}
            />
          </label>
        )}
      </div>

      <div className="space-y-3">
        <Label className="text-base font-medium">Galeria de Fotos</Label>
        <p className="text-sm text-muted-foreground">
          Adicione mais fotos do imovel. Arraste para reordenar.
        </p>

        <label
          className={cn(
            'flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-lg cursor-pointer',
            'border-[var(--app-border)] bg-[var(--app-surface-soft)] transition-colors hover:border-primary/35 hover:bg-[var(--app-surface-hover)]',
            uploadingGallery && 'opacity-50 cursor-not-allowed',
          )}
        >
          <div className="flex flex-col items-center justify-center py-4">
            {uploadingGallery ? (
              <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
            ) : (
              <>
                <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-primary">Clique para enviar</span> ou arraste
                  arquivos
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Multiplas imagens permitidas
                </p>
              </>
            )}
          </div>
          <input
            type="file"
            className="hidden"
            accept="image/*"
            multiple
            onChange={handleGalleryUpload}
            disabled={uploadingGallery}
          />
        </label>

        {images.length > 0 ? (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="gallery" direction="horizontal">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3"
                >
                  {images.map((url, index) => {
                    const isHiddenFromSite = hiddenSiteImages.includes(url);

                    return (
                      <Draggable key={url} draggableId={url} index={index}>
                        {(draggableProvided, snapshot) => {
                          const { style, ...draggableProps } = draggableProvided.draggableProps;

                          return (
                          <div
                            ref={draggableProvided.innerRef}
                            {...draggableProps}
                            style={style as CSSProperties}
                            className={cn(
                              'relative aspect-square overflow-hidden rounded-lg border-0 bg-[var(--app-surface-soft)] group',
                              snapshot.isDragging && 'ring-2 ring-primary shadow-lg',
                            )}
                          >
                            <div
                              {...draggableProvided.dragHandleProps}
                              className="absolute left-1.5 top-1.5 z-10 rounded-[6px] bg-zinc-950/75 p-1 text-white shadow-sm cursor-grab active:cursor-grabbing"
                              title="Arrastar foto"
                            >
                              <GripVertical className="h-4 w-4 text-white" />
                            </div>
                            <div className="absolute right-1.5 top-1.5 z-10 rounded-[6px] bg-zinc-950/75 px-1.5 py-0.5 text-xs font-medium text-white shadow-sm">
                              {index + 1}
                            </div>
                            {isHiddenFromSite && (
                              <div className="absolute left-1.5 top-8 z-10 rounded-[6px] bg-white/95 px-1.5 py-0.5 text-[10px] font-medium uppercase text-zinc-900 shadow-sm dark:bg-zinc-950/90 dark:text-zinc-50">
                                Interna
                              </div>
                            )}
                            <Image
                              src={url}
                              alt={`Foto ${index + 1}`}
                              fill
                              sizes="(max-width: 768px) 50vw, 25vw"
                              className="object-cover"
                              unoptimized
                            />
                            <div className="absolute inset-x-1.5 bottom-1.5 flex justify-end gap-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                              <MediaActionButton label="Ver foto" onClick={() => setPreviewImage({ url, title: `Foto ${index + 1}` })}>
                                <Maximize2 className="h-4 w-4" />
                              </MediaActionButton>
                              <MediaActionButton label="Definir como principal" onClick={() => promoteToMain(url)}>
                                <Star className="h-4 w-4" />
                              </MediaActionButton>
                              {onHiddenSiteImagesChange && (
                                <MediaActionButton label={isHiddenFromSite ? 'Publicar no site' : 'Ocultar do site'} onClick={() => toggleSiteVisibility(url)}>
                                  {isHiddenFromSite ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                                </MediaActionButton>
                              )}
                              <MediaActionButton label="Remover foto" onClick={() => removeFromGallery(url)} className="text-primary hover:text-primary">
                                <X className="h-4 w-4" />
                              </MediaActionButton>
                            </div>
                          </div>
                          );
                        }}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        ) : (
          <div className="flex items-center gap-3 rounded-lg bg-[var(--app-surface-soft)] p-4">
            <ImageIcon className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Nenhuma foto na galeria</p>
              <p className="text-xs text-muted-foreground">Adicione mais fotos do imovel</p>
            </div>
          </div>
        )}
      </div>
    </div>

    <Dialog open={Boolean(previewImage)} onOpenChange={(open) => !open && setPreviewImage(null)}>
      <DialogContent className="flex h-[85vh] w-[min(960px,calc(100vw-2rem))] max-w-[960px] flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle className="text-base font-medium">{previewImage?.title || 'Visualizar foto'}</DialogTitle>
        </DialogHeader>
        <div className="relative min-h-0 flex-1 bg-zinc-950">
          {previewImage && (
            <Image
              src={previewImage.url}
              alt={previewImage.title}
              fill
              sizes="min(960px, 100vw)"
              className="object-contain"
              unoptimized
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
    </TooltipProvider>
  );
}
