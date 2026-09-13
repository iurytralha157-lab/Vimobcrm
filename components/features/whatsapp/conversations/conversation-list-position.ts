const RADIX_SCROLL_VIEWPORT_SELECTOR = "[data-radix-scroll-area-viewport]";

export type ConversationListReturnPosition = {
  key: string;
  scrollTop: number;
  anchorConversationId: string;
  anchorOffset: number;
};

function findConversationRow(viewport: HTMLElement, conversationId: string) {
  return Array.from(viewport.querySelectorAll<HTMLElement>("[data-conversation-id]"))
    .find((element) => element.dataset.conversationId === conversationId) ?? null;
}

export function getConversationListViewport(root: HTMLElement | null) {
  return root?.querySelector<HTMLElement>(RADIX_SCROLL_VIEWPORT_SELECTOR) ?? null;
}

export function captureConversationListReturnPosition(
  root: HTMLElement | null,
  key: string,
  conversationId: string,
): ConversationListReturnPosition | null {
  const viewport = getConversationListViewport(root);
  if (!viewport) return null;

  const anchor = findConversationRow(viewport, conversationId);
  return {
    key,
    scrollTop: viewport.scrollTop,
    anchorConversationId: conversationId,
    anchorOffset: anchor
      ? anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top
      : 0,
  };
}

export function restoreConversationListReturnPosition(
  root: HTMLElement | null,
  key: string,
  position: ConversationListReturnPosition | null,
) {
  if (!position || position.key !== key) return false;

  const viewport = getConversationListViewport(root);
  if (!viewport) return false;

  viewport.scrollTop = position.scrollTop;
  const anchor = findConversationRow(viewport, position.anchorConversationId);
  if (anchor) {
    const currentOffset = anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    viewport.scrollTop += currentOffset - position.anchorOffset;
  }
  return true;
}
