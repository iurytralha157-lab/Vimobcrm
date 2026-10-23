export type MessageMediaGalleryItem = {
  id: string;
  url: string;
  type: "image" | "video";
  filename?: string;
  refresh?: (options?: { signal?: AbortSignal }) => Promise<string | null>;
};

/** Only already authorized items supplied by the current conversation owner. */
export function getMessageMediaGallery(items: readonly MessageMediaGalleryItem[], current: MessageMediaGalleryItem) {
  const unique = new Map<string, MessageMediaGalleryItem>();
  for (const item of items) {
    if (item.id && (item.url || typeof item.refresh === "function") && (item.type === "image" || item.type === "video") && !unique.has(item.id)) unique.set(item.id, item);
  }
  if (!unique.has(current.id)) return [current];
  const previous = unique.get(current.id)!;
  unique.set(current.id, { ...previous, ...current, filename: current.filename ?? previous.filename, refresh: current.refresh ?? previous.refresh });
  return [...unique.values()];
}

export function getMessageMediaGalleryNeighbor(items: readonly MessageMediaGalleryItem[], id: string, delta: -1 | 1) {
  const index = items.findIndex((item) => item.id === id);
  return index < 0 ? null : items[index + delta] || null;
}
