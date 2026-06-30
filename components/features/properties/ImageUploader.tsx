import { useCallback, useState, type ChangeEvent, type CSSProperties } from 'react';
import Image from 'next/image';
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from '@hello-pangea/dnd';
import { GripVertical, Image as ImageIcon, Loader2, Star, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { uploadPropertyImage } from '@/lib/api/property-images';
import { cn } from '@/lib/utils';

interface ImageUploaderProps {
  images: string[];
  mainImage: string;
  onImagesChange: (images: string[], mainImage: string) => void;
  organizationId?: string;
  propertyId?: string;
}

const MAX_IMAGE_SIZE_MB = 10;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ImageUploader({
  images,
  mainImage,
  onImagesChange,
  organizationId,
  propertyId,
}: ImageUploaderProps) {
  const [uploadingMain, setUploadingMain] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);

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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-3">
        <Label className="text-base font-medium">Imagem Principal</Label>
        <p className="text-sm text-muted-foreground">
          Esta imagem sera exibida em destaque nos anuncios
        </p>

        {mainImage ? (
          <div className="relative w-full min-h-[200px] rounded-lg overflow-hidden border-2 border-primary group">
            <Image
              src={mainImage}
              alt="Imagem principal"
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
              unoptimized
            />
            <div className="absolute top-2 left-2 bg-primary text-primary-foreground text-xs px-2 py-1 rounded font-medium flex items-center gap-1">
              <Star className="h-3 w-3 fill-current" />
              Principal
            </div>
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <label className="cursor-pointer">
                <Button type="button" variant="secondary" size="sm" asChild>
                  <span>Trocar imagem</span>
                </Button>
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={handleMainImageUpload}
                  disabled={uploadingMain}
                />
              </label>
              <Button type="button" variant="destructive" size="sm" onClick={removeMainImage}>
                Remover
              </Button>
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
                  {images.map((url, index) => (
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
                              className="absolute top-1 left-1 z-10 p-1 rounded bg-black/50 cursor-grab active:cursor-grabbing"
                            >
                              <GripVertical className="h-4 w-4 text-white" />
                            </div>
                            <div className="absolute top-1 right-1 z-10 px-1.5 py-0.5 rounded bg-black/60 text-white text-xs font-medium">
                              {index + 1}
                            </div>
                            <Image
                              src={url}
                              alt={`Foto ${index + 1}`}
                              fill
                              sizes="(max-width: 768px) 50vw, 25vw"
                              className="object-cover"
                              unoptimized
                            />
                            <div className="absolute inset-0 bg-black/50 sm:opacity-0 sm:group-hover:opacity-100 opacity-100 transition-opacity flex items-end justify-center gap-1 p-2">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => promoteToMain(url)}
                                title="Promover para principal"
                              >
                                <Star className="h-3 w-3 mr-1" />
                                Principal
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => removeFromGallery(url)}
                                title="Remover"
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      }}
                    </Draggable>
                  ))}
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
  );
}
