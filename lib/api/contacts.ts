import { vimobAPIRequest } from './vimob-client'
import type { Contact, ContactListFilters } from '@/hooks/use-contacts-list'

type Envelope<T> = {
  data: T
}

export const contactsAPI = {
  async list(filters: ContactListFilters) {
    const response = await vimobAPIRequest<Envelope<Contact[]>>('/v1/contacts', {
      query: {
        search: filters.search,
        teamId: filters.teamId,
        pipelineId: filters.pipelineId,
        stageId: filters.stageId,
        assigneeId: filters.assigneeId,
        unassigned: filters.unassigned,
        tagId: filters.tagId,
        source: filters.source,
        campaignId: filters.campaignId,
        adSetId: filters.adSetId,
        adId: filters.adId,
        dealStatus: filters.dealStatus,
        createdFrom: filters.createdFrom,
        createdTo: filters.createdTo,
        sortBy: filters.sortBy,
        sortDir: filters.sortDir,
        page: filters.page,
        limit: filters.limit,
      },
    })

    return response.data
  },
}
