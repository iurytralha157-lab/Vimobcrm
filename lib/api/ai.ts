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

export type AIRunInput = {
  message: string;
  agentId?: string;
  leadId?: string;
  conversationId?: string;
};

export type AIRunResponse = {
  mode: 'openai' | 'simulated';
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
  async listAgents() {
    const response = await vimobAPIRequest<Envelope<AIAgent[]>>('/v1/admin/ai-agents');
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

  async run(input: AIRunInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AIRunResponse>>('/v1/ai/run', {
      method: 'POST',
      organizationId,
      body: input,
    });
    return response.data;
  },
};
