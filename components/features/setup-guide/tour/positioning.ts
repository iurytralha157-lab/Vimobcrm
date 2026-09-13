import type { CSSProperties } from "react";

export type TourTooltipStyle = CSSProperties & {
  "--tour-arrow-position"?: "top" | "bottom";
};

export type TourTargetRect = Pick<
  DOMRect,
  "bottom" | "height" | "left" | "right" | "top" | "width"
>;

export type TourViewport = {
  width: number;
  height: number;
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getTourTooltipStyle(
  targetRect: TourTargetRect | null,
  viewport: TourViewport | null,
): TourTooltipStyle {
  if (!viewport || !targetRect) {
    return {
      width: "min(340px, calc(100vw - 32px))",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
    };
  }

  const viewportWidth = viewport.width;
  const viewportHeight = viewport.height;
  const cardWidth = Math.min(340, viewportWidth - 32);
  const estimatedHeight = 190;
  const placeAbove =
    targetRect.bottom + estimatedHeight + 18 > viewportHeight &&
    targetRect.top > estimatedHeight + 18;
  const left = clamp(
    targetRect.left + targetRect.width / 2 - cardWidth / 2,
    16,
    viewportWidth - cardWidth - 16,
  );
  const top = placeAbove
    ? clamp(
        targetRect.top - estimatedHeight - 14,
        16,
        viewportHeight - estimatedHeight - 16,
      )
    : clamp(
        targetRect.bottom + 14,
        16,
        viewportHeight - estimatedHeight - 16,
      );

  return {
    width: cardWidth,
    left,
    top,
    transform: "none",
    "--tour-arrow-position": placeAbove ? "bottom" : "top",
  };
}
