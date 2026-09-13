import type { PropertyWorkspaceAsset } from './validation/property-workspace'

type PropertyAssetCommonInput = {
  asset_type: PropertyWorkspaceAsset['asset_type']
  visibility: PropertyWorkspaceAsset['visibility']
  title: string | null
  description: string | null
  document_category: string | null
  expires_at: string | null
  metadata: Record<string, unknown>
}

export type PropertyAssetFormValues = {
  assetType: PropertyWorkspaceAsset['asset_type']
  visibility: PropertyWorkspaceAsset['visibility']
  title: string
  description: string
  documentCategory: string
  expiresAt: string
  metadata?: Record<string, unknown>
}

function valueOrNull(value: string) {
  return value.trim() || null
}

export function buildPropertyAssetCommonInput(
  values: PropertyAssetFormValues,
): PropertyAssetCommonInput {
  return {
    asset_type: values.assetType,
    visibility: values.visibility,
    title: valueOrNull(values.title),
    description: valueOrNull(values.description),
    document_category:
      values.assetType === 'document'
        ? valueOrNull(values.documentCategory)
        : null,
    expires_at:
      values.assetType === 'document'
        ? valueOrNull(values.expiresAt)
        : null,
    metadata: values.metadata ?? {},
  }
}
