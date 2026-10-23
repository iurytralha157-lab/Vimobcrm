export interface SharedLeadConversationScope {
  pipelineId: string | null;
  teamId: string | null;
  userId: string | null;
  source: string | null;
  pageId: string | null;
  campaignIds: string[];
  adSetId: string | null;
  adId: string | null;
  tagIds: string[];
  dealStatus: string | null;
  activeDateRange: { from: Date; to: Date } | null;
}

export function sharedLeadConversationFilterCount(scope: SharedLeadConversationScope, withoutLead: boolean) {
  if (withoutLead) return 0;
  return [scope.pipelineId, scope.teamId, scope.userId, scope.source, scope.pageId,
    scope.campaignIds.length > 0, scope.adSetId, scope.adId, scope.tagIds.length > 0,
    scope.dealStatus, scope.activeDateRange].filter(Boolean).length;
}

/** Unlinked inbox views pause lead criteria without destroying selections on other CRM screens. */
export function sharedLeadFiltersForConversations(scope: SharedLeadConversationScope, withoutLead: boolean) {
  if (withoutLead) return {};
  const dealStatus: 'open' | 'won' | 'lost' | undefined = scope.dealStatus === 'open' || scope.dealStatus === 'won' || scope.dealStatus === 'lost' ? scope.dealStatus : undefined;
  return {
    pipelineId: scope.pipelineId ?? undefined,
    teamId: scope.teamId ?? undefined,
    userId: scope.userId ?? undefined,
    leadSource: scope.source ?? undefined,
    pageId: scope.pageId ?? undefined,
    campaignIds: [...scope.campaignIds],
    adSetId: scope.adSetId ?? undefined,
    adId: scope.adId ?? undefined,
    tagIds: [...scope.tagIds],
    dealStatus,
    leadCreatedFrom: scope.activeDateRange?.from.toISOString(),
    leadCreatedTo: scope.activeDateRange?.to.toISOString(),
  };
}
