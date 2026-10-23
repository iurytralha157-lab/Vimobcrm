export const PIPELINE_LAYOUT = {
  minColumnWidthPx: 240,
  maxColumnWidthPx: 288,
  maxVisibleColumns: 4,
  boardPaddingPx: 8,
  compactWidthPx: 1200,
  compactHeightPx: 620,
  shortHeightPx: 500,
  regularGapPx: 12,
  compactGapPx: 8,
  mobileNavigationTouchSizePx: 44,
  mobileNavigationSurfaceSizePx: 36,
  mobileNavigationEdgeInsetPx: 8,
  mobileNavigationStackLevel: 40,
} as const;

export function getPipelineBoardLayout(width: number, height: number, isMobile: boolean, stageCount: number = PIPELINE_LAYOUT.maxVisibleColumns) {
  const measuredWidth = Number.isFinite(width) && width > 0 ? width : 0;
  const measuredHeight = Number.isFinite(height) && height > 0 ? height : 0;
  const compact = !isMobile && (
    (measuredWidth > 0 && measuredWidth < PIPELINE_LAYOUT.compactWidthPx) ||
    (measuredHeight > 0 && measuredHeight < PIPELINE_LAYOUT.compactHeightPx)
  );
  const short = !isMobile && measuredHeight > 0 && measuredHeight < PIPELINE_LAYOUT.shortHeightPx;
  const gap = compact ? PIPELINE_LAYOUT.compactGapPx : PIPELINE_LAYOUT.regularGapPx;
  const usableWidth = Math.max(0, measuredWidth - PIPELINE_LAYOUT.boardPaddingPx * 2);
  const maxVisibleColumns = Math.min(PIPELINE_LAYOUT.maxVisibleColumns, Math.max(1, stageCount));
  const visibleColumns = Math.max(1, Math.min(
    maxVisibleColumns,
    Math.floor((usableWidth + gap) / (PIPELINE_LAYOUT.minColumnWidthPx + gap)),
  ));
  const columnWidth = measuredWidth > 0 && !isMobile
    ? Math.max(PIPELINE_LAYOUT.minColumnWidthPx, Math.min(
      PIPELINE_LAYOUT.maxColumnWidthPx,
      Math.floor((usableWidth - gap * (visibleColumns - 1)) / visibleColumns),
    ))
    : PIPELINE_LAYOUT.maxColumnWidthPx;

  return {
    columnWidth,
    columnGap: isMobile ? PIPELINE_LAYOUT.regularGapPx : gap,
    cardPadding: short ? 8 : compact ? 10 : 12,
    cardGap: short ? 4 : 6,
    listPadding: compact ? 6 : 8,
    headerPadding: compact ? 3 : 5,
    compact,
    short,
  };
}
