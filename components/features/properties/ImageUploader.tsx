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
import { stringifyErrorMessage as getErrorMessage } from '@/lib/api/vimob-error';
import { getSafePropertyImageSource } from '@/lib/property-media';
import {
  getRemainingPropertyPhotoSlots,
  isStagedPropertyPhoto,
  normalizePropertyPhotoSelection,
  PROPERTY_MEDIA_MAX_PHOTOS,
  releaseStagedPropertyPhoto,
  stagePropertyPhoto,
  validatePropertyMainPhotoCapacity,
  validatePropertyPhotoFile,
} from '@/lib/property-media-draft';
import { cn } from '@/lib/utils';

interface ImageUploaderProps {
  images: string[];
  mainImage: string;
  onImagesChange: (images: string[], mainImage: string) => void;
  hiddenSiteImages?: string[];
  onHiddenSiteImagesChange?: (images: string[]) => void;
}

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
            'h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-solid)]/95 text-[var(--app-text-primary)] shadow-none hover:bg-[var(--app-surface-hover)]',
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

export function ImageUploader({
  images,
  mainImage,
  onImagesChange,
  hiddenSiteImages = [],
  onHiddenSiteImagesChange,
}: ImageUploaderProps) {
  const [uploadingMain, setUploadingMain] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);
  const safeMainImage = isStagedPropertyPhoto(mainImage)
    ? mainImage
    : getSafePropertyImageSource(mainImage);

  const uploadFile = useCallback(
    (file: File): string | null => {
      const validationError = validatePropertyPhotoFile(file);
      if (validationError) {
        toast.error(validationError);
        return null;
      }

      try {
        return stagePropertyPhoto(file);
      } catch (error: unknown) {
        toast.error(`Falha ao preparar ${file.name}: ${getErrorMessage(error)}`);
        return null;
      }
    },
    [],
  );

  const handleMainImageUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        toast.error('Arquivo nao e uma imagem valida');
        return;
      }

      const capacityError = validatePropertyMainPhotoCapacity(images, mainImage);
      if (capacityError) {
        toast.error(capacityError);
        event.target.value = '';
        return;
      }

      setUploadingMain(true);
      try {
        const url = uploadFile(file);
        if (url) {
          if (isStagedPropertyPhoto(mainImage)) {
            releaseStagedPropertyPhoto(mainImage);
          }
          onImagesChange(images, url);
          toast.success('Imagem principal pronta para salvar!');
        }
      } catch (error: unknown) {
        toast.error('Erro ao enviar imagem: ' + getErrorMessage(error));
      } finally {
        setUploadingMain(false);
        event.target.value = '';
      }
    },
    [images, mainImage, onImagesChange, uploadFile],
  );

  const handleGalleryUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      const availableSlots = getRemainingPropertyPhotoSlots(images, mainImage);
      const selectedFiles = Array.from(files);
      if (selectedFiles.length > availableSlots) {
        toast.error(`Cada imóvel pode ter no máximo ${PROPERTY_MEDIA_MAX_PHOTOS} fotos.`);
      }
      const validFiles = selectedFiles.slice(0, availableSlots).filter((file) => {
        const validationError = validatePropertyPhotoFile(file);
        if (!validationError) return true;
        toast.error(validationError);
        return false;
      });

      if (validFiles.length === 0) {
        event.target.value = '';
        return;
      }

      setUploadingGallery(true);
      try {
        const results = validFiles.map((file) => uploadFile(file));
        const newUrls = results.filter((url): url is string => url !== null);

        if (newUrls.length > 0) {
          const normalized = normalizePropertyPhotoSelection(
            [...images, ...newUrls],
            mainImage,
          );
          onImagesChange(normalized.galleryImages, normalized.mainImage);
          if (
            normalized.mainImage &&
            hiddenSiteImages.includes(normalized.mainImage)
          ) {
            onHiddenSiteImagesChange?.(
              hiddenSiteImages.filter((image) => image !== normalized.mainImage),
            );
          }
          toast.success(`${newUrls.length} imagem(s) pronta(s) para salvar!`);
        }
      } catch (error: unknown) {
        toast.error('Erro ao enviar imagens: ' + getErrorMessage(error));
      } finally {
        setUploadingGallery(false);
        event.target.value = '';
      }
    },
    [
      hiddenSiteImages,
      images,
      mainImage,
      onHiddenSiteImagesChange,
      onImagesChange,
      uploadFile,
    ],
  );

  const removeFromGallery = (url: string) => {
    if (url !== mainImage && isStagedPropertyPhoto(url)) releaseStagedPropertyPhoto(url);
    onImagesChange(
      images.filter((image) => image !== url),
      mainImage,
    );
    onHiddenSiteImagesChange?.(hiddenSiteImages.filter((image) => image !== url));
  };

  const removeMainImage = () => {
    if (isStagedPropertyPhoto(mainImage)) releaseStagedPropertyPhoto(mainImage);
    const normalized = normalizePropertyPhotoSelection(
      images.filter((image) => image !== mainImage),
      '',
    );
    onImagesChange(normalized.galleryImages, normalized.mainImage);
    if (
      normalized.mainImage &&
      hiddenSiteImages.includes(normalized.mainImage)
    ) {
      onHiddenSiteImagesChange?.(
        hiddenSiteImages.filter((image) => image !== normalized.mainImage),
      );
    }
  };

  const promoteToMain = (url: string) => {
    const nextImages = images.filter((image) => image !== url);
    if (mainImage) {
      nextImages.unshift(mainImage);
    }

    onImagesChange(nextImages, url);
    if (hiddenSiteImages.includes(url)) {
      onHiddenSiteImagesChange?.(
        hiddenSiteImages.filter((image) => image !== url),
      );
    }
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
        <Label className="text-[14px] font-normal">Imagem Principal</Label>
        <p className="text-[12px] font-light text-muted-foreground">
          Esta imagem será exibida em destaque nos anúncios
        </p>

        {safeMainImage ? (
          <div className="group relative h-[220px] w-full overflow-hidden rounded-[8px] border border-primary/55 bg-[var(--app-surface-soft)]">
            <Image
              src={safeMainImage}
              alt="Imagem principal"
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
              unoptimized
            />
            <div className="absolute left-2 top-2 flex items-center gap-1 rounded-[6px] bg-primary/50 px-2 py-1 text-[12px] font-light text-primary-foreground shadow-none">
              <Star className="h-3 w-3 fill-current" />
              Principal
            </div>
            <div className="absolute right-2 top-2 flex items-center gap-1.5">
              <MediaActionButton label="Ver imagem inteira" onClick={() => setPreviewImage({ url: safeMainImage, title: 'Imagem principal' })}>
                <Maximize2 className="h-4 w-4" />
              </MediaActionButton>
              <label
                className={cn(
                  'inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[6px] bg-[var(--app-surface-solid)]/95 px-2 text-[12px] font-light text-[var(--app-text-primary)] shadow-none hover:bg-[var(--app-surface-hover)]',
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
              'flex min-h-[200px] w-full cursor-pointer flex-col items-center justify-center rounded-[8px] border border-dashed',
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
                    <span className="font-normal text-primary">Clique para enviar</span> a imagem
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
        <Label className="text-[14px] font-normal">Galeria de Fotos</Label>
        <p className="text-[12px] font-light text-muted-foreground">
          Adicione as fotos do imóvel. Sem destaque definido, a primeira vira principal. Arraste as demais para reordenar.
        </p>

        <label
          className={cn(
            'flex h-28 w-full cursor-pointer flex-col items-center justify-center rounded-[8px] border border-dashed',
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
                  <span className="font-normal text-primary">Clique para enviar</span> ou arraste
                  arquivos
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Até {PROPERTY_MEDIA_MAX_PHOTOS} fotos; o envio acontece ao salvar
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
                    const safeImageURL = isStagedPropertyPhoto(url)
                      ? url
                      : getSafePropertyImageSource(url);

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
                              'group relative aspect-square overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-soft)]',
                              snapshot.isDragging && 'ring-2 ring-primary',
                            )}
                          >
                            <div
                              {...draggableProvided.dragHandleProps}
                              className="absolute left-1.5 top-1.5 z-10 cursor-grab rounded-[6px] bg-[var(--app-surface-solid)]/90 p-1 text-[var(--app-text-primary)] shadow-none active:cursor-grabbing"
                              title="Arrastar foto"
                            >
                              <GripVertical className="h-4 w-4" />
                            </div>
                            <div className="absolute right-1.5 top-1.5 z-10 rounded-[6px] bg-[var(--app-surface-solid)]/90 px-1.5 py-0.5 text-[12px] font-light text-[var(--app-text-primary)] shadow-none">
                              {index + 1}
                            </div>
                            {isHiddenFromSite && (
                              <div className="absolute left-1.5 top-8 z-10 rounded-[6px] bg-[var(--app-surface-solid)]/95 px-1.5 py-0.5 text-[10px] font-light text-[var(--app-text-primary)] shadow-none">
                                Interna
                              </div>
                            )}
                            {safeImageURL ? (
                              <Image
                                src={safeImageURL}
                                alt={`Foto ${index + 1}`}
                                fill
                                sizes="(max-width: 768px) 50vw, 25vw"
                                className="object-cover"
                                unoptimized
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center" role="img" aria-label={`Foto ${index + 1} indisponível`}>
                                <ImageIcon className="h-8 w-8 text-[var(--app-text-tertiary)]" />
                              </div>
                            )}
                            <div className="absolute inset-x-1.5 bottom-1.5 flex justify-end gap-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                              {safeImageURL ? (
                                <MediaActionButton label="Ver foto" onClick={() => setPreviewImage({ url: safeImageURL, title: `Foto ${index + 1}` })}>
                                  <Maximize2 className="h-4 w-4" />
                                </MediaActionButton>
                              ) : null}
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
          <div className="flex items-center gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4">
            <ImageIcon className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-[14px] font-normal">Nenhuma foto na galeria</p>
              <p className="text-xs text-muted-foreground">Adicione fotos do imóvel</p>
            </div>
          </div>
        )}
      </div>
    </div>

    <Dialog open={Boolean(previewImage)} onOpenChange={(open) => !open && setPreviewImage(null)}>
      <DialogContent className="flex h-[85vh] w-[min(960px,calc(100vw-2rem))] max-w-[960px] flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-0 shadow-none">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle className="text-[14px] font-normal">{previewImage?.title || 'Visualizar foto'}</DialogTitle>
        </DialogHeader>
        <div className="relative min-h-0 flex-1 bg-[var(--app-surface-soft)]">
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
