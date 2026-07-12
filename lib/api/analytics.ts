import {
  analyticsQuerySchema,
  apiUnknownEnvelopeSchema,
  apiUnknownListEnvelopeSchema,
  parseDomainInput,
  uuidSchema,
  validateDomainResponse,
} from '@/lib/validation';
import { vimobAPIRequest } from './vimob-client';

type Envelope<T> = {
  data: T;
};

type Query = Record<string, string | number | boolean | null | undefined>;

export const analyticsAPI = {
  async metaInsights<T = unknown>(query: Query) {
    const validatedQuery = parseDomainInput(analyticsQuerySchema, query, 'analytics.meta-insights');
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/analytics/meta-insights', { query: validatedQuery });
    validateDomainResponse(apiUnknownListEnvelopeSchema, response, 'analytics.meta-insights');
    return response.data;
  },

  async campaignInsights<T = unknown>(query: Query) {
    const validatedQuery = parseDomainInput(analyticsQuerySchema, query, 'analytics.campaign-insights');
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/campaign-insights', { query: validatedQuery });
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'analytics.campaign-insights');
    return response.data;
  },

  async leadAnalytics<T = unknown>(query: Query) {
    const validatedQuery = parseDomainInput(analyticsQuerySchema, query, 'analytics.lead');
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/lead', { query: validatedQuery });
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'analytics.lead');
    return response.data;
  },

  async siteSummary<T = unknown>(query: Query) {
    const validatedQuery = parseDomainInput(analyticsQuerySchema, query, 'analytics.site-summary');
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/site-summary', { query: validatedQuery });
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'analytics.site-summary');
    return response.data;
  },

  async siteDetailed<T = unknown>(query: Query) {
    const validatedQuery = parseDomainInput(analyticsQuerySchema, query, 'analytics.site-detailed');
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/site-detailed', { query: validatedQuery });
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'analytics.site-detailed');
    return response.data;
  },

  async enterpriseKPIs<T = unknown>(query: Query) {
    const validatedQuery = parseDomainInput(analyticsQuerySchema, query, 'analytics.enterprise-kpis');
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/enterprise-kpis', { query: validatedQuery });
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'analytics.enterprise-kpis');
    return response.data;
  },

  async dreExecutive<T = unknown>(query: Query) {
    const validatedQuery = parseDomainInput(analyticsQuerySchema, query, 'analytics.dre-executive');
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/dre-executive', { query: validatedQuery });
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'analytics.dre-executive');
    return response.data;
  },

  async slaSummary<T = unknown>(query: Query) {
    const validatedQuery = parseDomainInput(analyticsQuerySchema, query, 'analytics.sla-summary');
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/sla-summary', { query: validatedQuery });
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'analytics.sla-summary');
    return response.data;
  },

  async slaPerformanceByUser<T = unknown>(query: Query) {
    const validatedQuery = parseDomainInput(analyticsQuerySchema, query, 'analytics.sla-performance-by-user');
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/analytics/sla-performance-by-user', { query: validatedQuery });
    validateDomainResponse(apiUnknownListEnvelopeSchema, response, 'analytics.sla-performance-by-user');
    return response.data;
  },

  async teamRanking<T = unknown>(query: Query) {
    const validatedQuery = parseDomainInput(analyticsQuerySchema, query, 'analytics.team-ranking');
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/team-ranking', { query: validatedQuery });
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'analytics.team-ranking');
    return response.data;
  },

  async vgvStats<T = unknown>(query: Query) {
    const validatedQuery = parseDomainInput(analyticsQuerySchema, query, 'analytics.vgv-stats');
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/vgv-stats', { query: validatedQuery });
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'analytics.vgv-stats');
    return response.data;
  },

  async vgvByBroker<T = unknown>(query: Query) {
    const validatedQuery = parseDomainInput(analyticsQuerySchema, query, 'analytics.vgv-by-broker');
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/analytics/vgv-by-broker', { query: validatedQuery });
    validateDomainResponse(apiUnknownListEnvelopeSchema, response, 'analytics.vgv-by-broker');
    return response.data;
  },

  async stageVGV<T = unknown>(query: Query) {
    const validatedQuery = parseDomainInput(analyticsQuerySchema, query, 'analytics.stage-vgv');
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/analytics/stage-vgv', { query: validatedQuery });
    validateDomainResponse(apiUnknownListEnvelopeSchema, response, 'analytics.stage-vgv');
    return response.data;
  },

  async leaderStats<T = unknown>() {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/analytics/leader-stats');
    validateDomainResponse(apiUnknownListEnvelopeSchema, response, 'analytics.leader-stats');
    return response.data;
  },

  async teamLeaderStats<T = unknown>(teamId: string) {
    const validatedTeamId = parseDomainInput(uuidSchema, teamId, 'analytics.team-leader-stats.team-id');
    const response = await vimobAPIRequest<Envelope<T[]>>(`/v1/analytics/team-leader-stats/${validatedTeamId}`);
    validateDomainResponse(apiUnknownListEnvelopeSchema, response, 'analytics.team-leader-stats');
    return response.data;
  },
};
