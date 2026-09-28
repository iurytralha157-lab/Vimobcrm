import type { PropertyWorkspaceAsset } from '@/lib/validation'

type PreviewAsset = Pick<
  PropertyWorkspaceAsset,
  'id' | 'asset_type' | 'visibility' | 'storage_path' | 'access_url' | 'external_url' | 'is_primary' | 'sort_order'
>

function safePreviewImageURL(value: string | null | undefined): string | null {
  if (!value) return null
  const candidate = value.trim()
  try {
    const parsed = new URL(candidate)
    if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password) {
      return candidate
    }
  } catch {
    // A missing or expired URL must never fall back to a private Storage path.
  }
  return null
}

// undefined keeps the server's versioned/legacy preview. An empty array means
// canonical photos exist, but none have a safe preview URL at this moment.
export function firstPublicationPreviewImages(
  assets: PreviewAsset[],
  hasAssetPhotos: boolean,
  publishedVersion: number | null,
): string[] | undefined {
  if (publishedVersion != null || !hasAssetPhotos) return undefined

  const orderedPublicPhotos = assets
    .filter((asset) => asset.asset_type === 'photo' && asset.visibility === 'public')
    .sort((left, right) =>
      Number(right.is_primary) - Number(left.is_primary)
      || left.sort_order - right.sort_order
      || left.id.localeCompare(right.id),
    )

  const urls = orderedPublicPhotos
    .map((asset) => safePreviewImageURL(
      asset.storage_path ? asset.access_url : (asset.access_url || asset.external_url),
    ))
    .filter((value): value is string => Boolean(value))

  return Array.from(new Set(urls))
}
