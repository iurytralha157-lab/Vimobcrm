import type { PropertyWorkspaceAsset } from "@/lib/validation";

type LabelledAsset = Pick<PropertyWorkspaceAsset, "asset_type" | "title" | "file_name" | "document_category">;

export const ASSET_CATEGORY_LABELS: Record<PropertyWorkspaceAsset["asset_type"], string> = {
  photo: "Fotos",
  video: "Vídeo",
  virtual_tour: "Tour",
  floor_plan: "Plantas",
  document: "Documentos",
};

const ASSET_FALLBACK_LABELS: Record<PropertyWorkspaceAsset["asset_type"], string> = {
  photo: "Foto",
  video: "Vídeo",
  virtual_tour: "Tour",
  floor_plan: "Planta",
  document: "Documento",
};

const FILE_EXTENSION = /\.[a-z0-9]{2,5}$/i;
const LONG_HEX_OR_ID = /[0-9a-f]{8,}/i;

/** Uploaded names such as "9f3a1c2e7b.jpg" or "IMG_2041.jpeg" are not legends. */
function looksLikeFileName(value: string) {
  return FILE_EXTENSION.test(value) || LONG_HEX_OR_ID.test(value);
}

/** Human legend when one exists, otherwise "Foto N". Never the stored file name. */
export function assetDisplayLabel(asset: LabelledAsset, position: number) {
  const title = asset.title?.trim();
  if (title && title !== asset.file_name && !looksLikeFileName(title)) return title;
  if (asset.asset_type === "document" && asset.document_category?.trim()) return asset.document_category.trim();
  return `${ASSET_FALLBACK_LABELS[asset.asset_type]} ${position}`;
}

export function assetUsageLabel(asset: Pick<PropertyWorkspaceAsset, "visibility" | "is_primary" | "external_url" | "asset_type">) {
  const visibility = asset.external_url && asset.visibility !== "public"
    ? "Oculta dos canais, origem externa não protegida"
    : { public: "Publicável", internal: "Uso interno", confidential: "Confidencial" }[asset.visibility];
  return asset.is_primary && asset.asset_type === "photo" ? `Capa · ${visibility}` : visibility;
}
