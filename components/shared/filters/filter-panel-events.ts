export type { FilterPanelCloseReason } from "@/lib/filters/filter-panel-layout";

export function isFilterPanelLayer(target: EventTarget | null, layerScope: string) {
  return target instanceof Element && Boolean(target.closest(`[data-filter-layer="${layerScope}"]`));
}

export function isComposingFilterKey(event: Pick<KeyboardEvent, "isComposing" | "keyCode">) {
  return event.isComposing || event.keyCode === 229;
}
