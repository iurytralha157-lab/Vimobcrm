import { vimobAPIRequest } from './vimob-client';

type Envelope<T> = {
  data: T;
};

type Query = Record<string, string | number | boolean | null | undefined>;

export const analyticsAPI = {
  async metaInsights<T = unknown>(query: Query) {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/analytics/meta-insights', { query });
    return response.data;
  },

  async campaignInsights<T = unknown>(query: Query) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/campaign-insights', { query });
    return response.data;
  },

  async leadAnalytics<T = unknown>(query: Query) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/lead', { query });
    return response.data;
  },

  async siteSummary<T = unknown>(query: Query) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/site-summary', { query });
    return response.data;
  },

  async siteDetailed<T = unknown>(query: Query) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/site-detailed', { query });
    return response.data;
  },

  async enterpriseKPIs<T = unknown>(query: Query) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/enterprise-kpis', { query });
    return response.data;
  },

  async dreExecutive<T = unknown>(query: Query) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/dre-executive', { query });
    return response.data;
  },

  async slaSummary<T = unknown>(query: Query) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/sla-summary', { query });
    return response.data;
  },

  async slaPerformanceByUser<T = unknown>(query: Query) {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/analytics/sla-performance-by-user', { query });
    return response.data;
  },

  async teamRanking<T = unknown>(query: Query) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/team-ranking', { query });
    return response.data;
  },

  async vgvStats<T = unknown>(query: Query) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/analytics/vgv-stats', { query });
    return response.data;
  },

  async vgvByBroker<T = unknown>(query: Query) {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/analytics/vgv-by-broker', { query });
    return response.data;
  },

  async stageVGV<T = unknown>(query: Query) {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/analytics/stage-vgv', { query });
    return response.data;
  },

  async leaderStats<T = unknown>() {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/analytics/leader-stats');
    return response.data;
  },

  async teamLeaderStats<T = unknown>(teamId: string) {
    const response = await vimobAPIRequest<Envelope<T[]>>(`/v1/analytics/team-leader-stats/${teamId}`);
    return response.data;
  },
};
