import type { WhatsAppConversationFilterOptions } from '@/lib/api/whatsapp';

function uniqueOptions<T extends { id: string; campaignId?: string; adsetId?: string }>(items: T[]) {
  return [...new Map(items.map((item) => [JSON.stringify([item.campaignId ?? '', item.adsetId ?? '', item.id]), item])).values()];
}

export function mergeWhatsAppFilterOptionPages(pages: WhatsAppConversationFilterOptions[]): WhatsAppConversationFilterOptions | undefined {
  if (!pages.length) return undefined;
  const last = pages[pages.length - 1];
  return {
    pipelines: uniqueOptions(pages.flatMap((page) => page.pipelines)),
    teams: uniqueOptions(pages.flatMap((page) => page.teams)),
    users: uniqueOptions(pages.flatMap((page) => page.users)),
    sources: [...new Set(pages.flatMap((page) => page.sources))],
    tags: uniqueOptions(pages.flatMap((page) => page.tags)),
    pages: uniqueOptions(pages.flatMap((page) => page.pages)),
    campaigns: uniqueOptions(pages.flatMap((page) => page.campaigns)),
    adSets: uniqueOptions(pages.flatMap((page) => page.adSets ?? [])),
    ads: uniqueOptions(pages.flatMap((page) => page.ads ?? [])),
    hasMore: last.hasMore,
    nextOffset: last.nextOffset,
  };
}
