
import { toast } from "sonner";
import { siteAPI, type SiteAssetType } from "@/lib/api/site";

export interface UploadOptions {
  bucket: string;
  path: string;
  assetType?: SiteAssetType;
  maxSizeInMB?: number;
  allowedTypes?: string[];
}

export async function validateFile(file: File, options: UploadOptions): Promise<boolean> {
  const { maxSizeInMB = 10, allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } = options;

  // Validate type
  if (!allowedTypes.includes(file.type)) {
    toast.error(`Tipo de arquivo não permitido: ${file.type}. Use ${allowedTypes.join(', ')}`);
    return false;
  }

  // Validate size
  if (file.size > maxSizeInMB * 1024 * 1024) {
    toast.error(`Arquivo muito grande: ${(file.size / (1024 * 1024)).toFixed(2)}MB. O limite é ${maxSizeInMB}MB`);
    return false;
  }

  return true;
}

export async function uploadFile(file: File, options: UploadOptions): Promise<string | null> {
  const isValid = await validateFile(file, options);
  if (!isValid) return null;

  try {
    return await siteAPI.uploadAsset({
      file,
      type: options.assetType || 'banner',
    });
  } catch (error) {
    console.error('Upload failed:', error);
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    toast.error(`Falha no upload: ${message}`);
    return null;
  }
}
