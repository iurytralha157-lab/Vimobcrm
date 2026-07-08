import { vimobAPIRequest } from './vimob-client';

type Envelope<T> = {
  data: T;
};
export type AIAgentConfig = {
  type: string;
  prompt: string;
  model: string;
  temperature: number;
  allowedTools: string[];
  handoffTargets: string[];
  routingKeywords: string[];
  isDefault: boolean;
};

export type AISettings = {
  organizationId: string;
  isEnabled: boolean;
  maxAgents: number;
  maxSessions: number;
  monthlyTokenLimit: number;
  defaultTriageAgentId?: string;
  triagePrompt: string;
  allowedTools: string[];
  guardrails: Record<string, unknown>;
  agentCount: number;
  activeSessionCount: number;
};

export type AISettingsInput = Partial<{
  isEnabled: boolean;
  maxAgents: number;
  maxSessions: number;
  monthlyTokenLimit: number;
  defaultTriageAgentId: string | null;
  triagePrompt: string;
  allowedTools: string[];
  guardrails: Record<string, unknown>;
}>;

export type AIAgent = {
  id: string;
  organizationId?: string;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'paused';
  config: AIAgentConfig;
  createdAt: string;
  updatedAt: string;
};

export type AIAgentInput = {
  organizationId?: string;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'paused';
  config: AIAgentConfig;
};

export type AIRoutingConditions = {
  sessionIds?: string[];
  pipelineIds?: string[];
  stageIds?: string[];
  pipelineNames?: string[];
  sources?: string[];
  messageContains?: string[];
};

export type AIRoutingRule = {
  id: string;
  organizationId: string;
  agentId: string;
  agentName?: string;
  agentType?: string;
  name: string;
  priority: number;
  isEnabled: boolean;
  action: 'route_to_agent' | 'handoff_to_agent' | 'require_human' | 'ignore';
  conditions: AIRoutingConditions;
  createdAt: string;
  updatedAt: string;
};

export type AIRoutingRuleInput = {
  agentId: string;
  name: string;
  priority: number;
  isEnabled?: boolean;
  action: AIRoutingRule['action'];
  conditions: AIRoutingConditions;
};

export type AIRunInput = {
  message: string;
  agentId?: string;
  leadId?: string;
  conversationId?: string;
  sessionId?: string;
  source?: string;
};

export type AIRunResponse = {
  mode: 'openai' | 'simulated' | 'routed';
  agent: {
    id: string;
    name: string;
    type: string;
  };
  previousAgent?: {
    id: string;
    name: string;
    type: string;
  };
  handoff?: {
    fromAgent: {
      id: string;
      name: string;
      type: string;
    };
    toAgent: {
      id: string;
      name: string;
      type: string;
    };
    reason: string;
  };
  output: string;
  toolsUsed: Array<{
    name: string;
    data: unknown;
  }>;
  requiresApproval?: Array<{
    type: string;
    label: string;
    description?: string;
    payload?: Record<string, unknown>;
  }>;
  memory?: Record<string, unknown>;
};

export type AIMetricPoint = {
  date: string;
  label: string;
  leadsReceived: number;
  leadsAttended: number;
  followUpsActive: number;
};

export type AIMetrics = {
  leadsReceived: number;
  leadsAttended: number;
  followUpsActive: number;
  series: AIMetricPoint[];
};

export type AIEvent = {
  id: string;
  eventType: string;
  status: string;
  payload: Record<string, unknown>;
  createdAt: string;
  processedAt?: string;
};

export const DEFAULT_AI_AGENT_CONFIG: AIAgentConfig = {
  type: 'triage',
  prompt: '',
  model: 'gpt-4.1-mini',
  temperature: 0.3,
  allowedTools: ['getLeadContext', 'searchProperties', 'classifyLeadIntent'],
  handoffTargets: ['mcmv', 'high_value', 'launch'],
  routingKeywords: [],
  isDefault: false,
};

export const aiAPI = {
  async settings(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AISettings>>('/v1/ai/settings', {
      organizationId,
    });
    return response.data;
  },

  async updateSettings(input: AISettingsInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AISettings>>('/v1/ai/settings', {
      method: 'PUT',
      organizationId,
      body: input,
    });
    return response.data;
  },

  async listAgents() {
    const response = await vimobAPIRequest<Envelope<AIAgent[]>>('/v1/admin/ai-agents');
    return response.data;
  },

  async listOrganizationAgents(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AIAgent[]>>('/v1/ai/agents', {
      organizationId,
    });
    return response.data;
  },

  async createAgent(input: AIAgentInput) {
    const response = await vimobAPIRequest<Envelope<AIAgent>>('/v1/admin/ai-agents', {
      method: 'POST',
      body: input,
    });
    return response.data;
  },

  async updateAgent(id: string, input: AIAgentInput) {
    const response = await vimobAPIRequest<Envelope<AIAgent>>(`/v1/admin/ai-agents/${id}`, {
      method: 'PATCH',
      body: input,
    });
    return response.data;
  },

  async deleteAgent(id: string) {
    return vimobAPIRequest<{ ok: boolean }>(`/v1/admin/ai-agents/${id}`, {
      method: 'DELETE',
    });
  },

  async createOrganizationAgent(input: AIAgentInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AIAgent>>('/v1/ai/agents', {
      method: 'POST',
      organizationId,
      body: input,
    });
    return response.data;
  },

  async updateOrganizationAgent(id: string, input: AIAgentInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AIAgent>>(`/v1/ai/agents/${id}`, {
      method: 'PATCH',
      organizationId,
      body: input,
    });
    return response.data;
  },

  async deleteOrganizationAgent(id: string, organizationId?: string | null) {
    return vimobAPIRequest<{ ok: boolean }>(`/v1/ai/agents/${id}`, {
      method: 'DELETE',
      organizationId,
    });
  },

  async listRoutingRules(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AIRoutingRule[]>>('/v1/ai/routing-rules', {
      organizationId,
    });
    return response.data;
  },

  async createRoutingRule(input: AIRoutingRuleInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AIRoutingRule>>('/v1/ai/routing-rules', {
      method: 'POST',
      organizationId,
      body: input,
    });
    return response.data;
  },

  async updateRoutingRule(id: string, input: AIRoutingRuleInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AIRoutingRule>>(`/v1/ai/routing-rules/${id}`, {
      method: 'PATCH',
      organizationId,
      body: input,
    });
    return response.data;
  },

  async deleteRoutingRule(id: string, organizationId?: string | null) {
    return vimobAPIRequest<{ ok: boolean }>(`/v1/ai/routing-rules/${id}`, {
      method: 'DELETE',
      organizationId,
    });
  },

  async run(input: AIRunInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AIRunResponse>>('/v1/ai/run', {
      method: 'POST',
      organizationId,
      body: input,
    });
    return response.data;
  },

  async metrics(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AIMetrics>>('/v1/ai/metrics', {
      organizationId,
    });
    return response.data;
  },

  async events(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AIEvent[]>>('/v1/ai/events', {
      organizationId,
    });
    return response.data;
  },
};
