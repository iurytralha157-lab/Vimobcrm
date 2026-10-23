import { tagsAPI } from '@/lib/api/tags';
import { DEFAULT_TAG_COLOR } from '@/config/tag-colors';
import { vimobAPIRequest } from '@/lib/api/vimob-client';
import { apiTagResponseSchema, createTagInputSchema } from '@/lib/validation/crm-support';
import { parseDomainInput, validateDomainResponse } from '@/lib/validation/common';

/** Batch adapter keeps ordinary tag-management notifications out of the import flow. */
export function contactImportTagAdapter(organizationId: string, expectedUserId: string, expectedSessionId?: string | null) {
  return {
    load: () => tagsAPI.list(organizationId),
    create: async (name: string) => {
      const body = parseDomainInput(createTagInputSchema, { name, color: DEFAULT_TAG_COLOR }, 'tags.create');
      const response = await vimobAPIRequest<unknown>('/v1/tags', { method: 'POST', organizationId, expectedUserId, expectedSessionId, body });
      return validateDomainResponse(apiTagResponseSchema, response, 'tags.create').data;
    },
  };
}
