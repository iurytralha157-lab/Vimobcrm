import { z } from 'zod';
import { filterTextSchema, MAX_LEAD_SOURCE_FILTER_LENGTH } from '@/lib/validation/filter-text';

const optionalText = (max: number) => filterTextSchema(max, 1).optional();
const instant = z.string().datetime({ offset: true }).optional();
const uuid = z.string().uuid();
const user = z.union([uuid, z.literal('unassigned')]).optional();

export const whatsAppConversationListQuerySchema = z.object({
  sessionId: uuid.optional(),
  sessionIds: z.string().max(100_000).refine((value) => !value || value.split(',').every((id) => uuid.safeParse(id).success)).optional(),
  pipelineId: uuid.optional(), teamId: uuid.optional(), userId: user,
  leadSource: optionalText(MAX_LEAD_SOURCE_FILTER_LENGTH), tagIds: z.array(uuid).max(50).optional(),
  dealStatus: z.enum(['open', 'won', 'lost']).optional(), pageId: optionalText(255),
  campaignIds: z.array(filterTextSchema(255, 1)).max(50).optional(),
  adSetId: optionalText(255), adId: optionalText(255),
  hideGroups: z.boolean().optional(), showArchived: z.boolean().optional(),
  onlyLeads: z.boolean().optional(), withoutLead: z.boolean().optional(), pendingReply: z.boolean().optional(),
  search: filterTextSchema(180).optional(),
  lastMessageFrom: instant, lastMessageTo: instant, leadCreatedFrom: instant, leadCreatedTo: instant,
  limit: z.number().int().min(1).max(120).optional(), cursor: z.string().max(255).nullable().optional(),
}).strict().superRefine((query, ctx) => {
  for (const [from, to] of [['lastMessageFrom', 'lastMessageTo'], ['leadCreatedFrom', 'leadCreatedTo']] as const) {
    if (query[from] && query[to] && Date.parse(query[from]) > Date.parse(query[to])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [to], message: 'A data final deve ser igual ou posterior à inicial.' });
    }
  }
  const hasLeadFilters = Boolean(query.pipelineId || query.teamId || query.userId || query.leadSource || query.tagIds?.length ||
    query.dealStatus || query.pageId || query.campaignIds?.length || query.adSetId || query.adId || query.leadCreatedFrom || query.leadCreatedTo);
  if (query.withoutLead && (query.onlyLeads || hasLeadFilters)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['withoutLead'], message: 'A consulta sem lead deve pausar os critérios do lead.' });
  }
});

export const whatsAppConversationOptionsQuerySchema = z.object({
  sessionId: uuid.optional(),
  sessionIds: z.string().max(100_000).refine((value) => !value || value.split(',').every((id) => uuid.safeParse(id).success)).optional(),
  hideGroups: z.boolean(), showArchived: z.boolean().optional(),
  lastMessageFrom: instant, lastMessageTo: instant, leadCreatedFrom: instant, leadCreatedTo: instant,
  pageId: optionalText(255), campaignIds: z.array(filterTextSchema(255, 1)).max(50).optional(), adSetId: optionalText(255),
  expandedOptions: z.boolean(), optionsSearch: filterTextSchema(120).optional(),
  optionsOffset: z.number().int().min(0).max(1_000_000).optional(), optionsLimit: z.number().int().min(1).max(200).optional(),
}).strict().superRefine((query, ctx) => {
  for (const [from, to] of [['lastMessageFrom', 'lastMessageTo'], ['leadCreatedFrom', 'leadCreatedTo']] as const) {
    if (query[from] && query[to] && Date.parse(query[from]) > Date.parse(query[to])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [to], message: 'Período inválido.' });
    }
  }
});
