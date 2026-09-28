import { getSafePropertyImageSource } from '@/lib/property-media'
import type { PropertyWorkspaceAsset } from '@/lib/validation'

type PreviewAsset = Pick<PropertyWorkspaceAsset, 'asset_type' | 'visibility' | 'access_url' | 'external_url'>

export function getAssetPreviewSource(asset: PreviewAsset) {
  if (asset.asset_type !== 'photo') return null

  // The workspace API signs private Storage objects for this authorized viewer.
  // An external URL cannot be protected, so never request one marked internal.
  return getSafePropertyImageSource(
    asset.access_url,
    asset.visibility === 'public' ? asset.external_url : null,
  )
}
