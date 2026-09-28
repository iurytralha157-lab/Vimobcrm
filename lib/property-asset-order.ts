type OrderedPropertyAsset = {
  asset_type: string
  sort_order: number
}

export function reserveNextPropertyAssetSortOrder(
  assets: readonly OrderedPropertyAsset[],
  assetType: string,
  nextByType: Map<string, number>,
) {
  const nextFromAssets = assets.reduce(
    (highest, asset) => asset.asset_type === assetType
      ? Math.max(highest, asset.sort_order)
      : highest,
    -1,
  ) + 1
  const next = Math.max(nextFromAssets, nextByType.get(assetType) ?? 0)
  nextByType.set(assetType, next + 1)
  return next
}

export function releaseConfirmedPropertyAssetSortOrders(
  assets: readonly OrderedPropertyAsset[],
  nextByType: Map<string, number>,
) {
  for (const [assetType, next] of nextByType) {
    if (assets.some((asset) => asset.asset_type === assetType && asset.sort_order >= next - 1)) {
      nextByType.delete(assetType)
    }
  }
}
