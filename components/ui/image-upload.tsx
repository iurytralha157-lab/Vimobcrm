
import React, { useState, useRef } from 'react';
import NextImage from 'next/image';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Upload, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { uploadFile, UploadOptions } from '@/lib/upload-utils';
import { toast } from 'sonner';
import type { SiteAssetType } from '@/lib/api/site';

interface ImageUploadProps {
  value?: string | null;
  onChange: (url: string | null) => void;
  label?: string;
  description?: string;
  bucket?: string;
  path?: string;
  assetType?: SiteAssetType;
  maxSizeInMB?: number;
  className?: string;
  disabled?: boolean;
  aspectRatio?: 'square' | 'video' | 'banner' | 'any';
}

export function ImageUpload({
  value,
  onChange,
  label,
  description,
  bucket = 'logos',
  path = 'general',
  assetType = 'banner',
  maxSizeInMB = 5,
  className,
  disabled = false,
  aspectRatio = 'any'
}: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const options: UploadOptions = {
        bucket,
        path,
        assetType,
        maxSizeInMB,
      };

      const url = await uploadFile(file, options);
      if (url) {
        onChange(url);
        toast.success('Imagem enviada com sucesso!');
      }
    } catch (error: unknown) {
      console.error('Error in handleFileChange:', error);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onChange(null);
  };

  const aspectClasses = {
    square: 'aspect-square',
    video: 'aspect-video',
    banner: 'aspect-[3/1]',
    any: 'min-h-[150px]'
  };

  return (
    <div className={cn("space-y-3", className)}>
      {label && <Label className="text-sm font-medium">{label}</Label>}

      <div
        className={cn(
          "relative border-2 border-dashed rounded-lg overflow-hidden transition-all",
          "flex flex-col items-center justify-center bg-muted/30",
          !disabled && "hover:bg-muted/50 hover:border-primary/50 cursor-pointer",
          disabled && "opacity-60 cursor-not-allowed",
          aspectClasses[aspectRatio],
          value ? "border-solid border-primary/20" : "border-muted-foreground/20"
        )}
        onClick={() => !disabled && !isUploading && fileInputRef.current?.click()}
      >
        {isUploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <p className="text-xs text-muted-foreground animate-pulse">Enviando...</p>
          </div>
        ) : value ? (
          <div className="relative w-full h-full group">
            <NextImage
              src={value}
              alt={label || "Preview"}
              fill
              sizes="320px"
              className="object-contain p-2"
              unoptimized
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-8 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                Trocar
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-8 text-xs"
                onClick={handleRemove}
              >
                Remover
              </Button>
            </div>
            <Button
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2 h-7 w-7 sm:hidden"
              onClick={handleRemove}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center p-6 text-center">
            <div className="p-3 rounded-full bg-primary/10 mb-3">
              <Upload className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm font-medium">
              Clique para fazer upload
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              PNG, JPG, WEBP até {maxSizeInMB}MB
            </p>
          </div>
        )}

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*"
          className="hidden"
          disabled={disabled || isUploading}
        />
      </div>

      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
