import {
  apiAutomationExecutionListResponseSchema,
  apiAutomationExecutionStepListResponseSchema,
  apiAutomationExecutionSummaryListResponseSchema,
  apiAutomationRuntimeIssuesResponseSchema,
  apiAutomationListResponseSchema,
  apiAutomationMediaListResponseSchema,
  apiAutomationMediaResponseSchema,
  apiAutomationNodesResponseSchema,
  apiAutomationResponseSchema,
  apiAutomationTemplateListResponseSchema,
  apiAutomationTemplateResponseSchema,
  apiAutomationWithNodesResponseSchema,
  apiStartAutomationResponseSchema,
  automationMediaTypeSchema,
  automationRuntimeIssueKindSchema,
  createAutomationInputSchema,
  createAutomationTemplateInputSchema,
  parseDomainInput,
  saveAutomationFlowInputSchema,
  startAutomationInputSchema,
  updateAutomationBodySchema,
  validateDomainResponse,
} from '@/lib/validation';
import { vimobAPIRequest } from './vimob-client';

type Envelope<T> = {
  data: T;
};

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type TriggerType =
  | "message_received"
  | "scheduled"
  | "lead_stage_changed"
  | "lead_created"
  | "tag_added"
  | "inactivity"
  | "manual";

export type NodeType = "trigger" | "action" | "condition" | "delay";

export type ActionType =
  | "send_whatsapp"
  | "send_image"
  | "send_audio"
  | "send_video"
  | "move_lead"
  | "add_tag"
  | "remove_tag"
  | "assign_user"
  | "webhook"
  | "set_variable";

export interface FlowNode {
  id: string;
  type: NodeType;
  action_type?: ActionType | null;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface FlowConnection {
  source: string;
  target: string;
  source_handle?: string | null;
  condition_branch?: string | null;
}

export interface FlowDefinition {
  nodes: FlowNode[];
  connections: FlowConnection[];
  settings: Record<string, unknown>;
}

export interface Automation {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  trigger_type: TriggerType;
  trigger_config: Json;
  flow_definition?: FlowDefinition | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationNode {
  id: string;
  automation_id: string;
  node_type: NodeType;
  action_type: ActionType | null;
  config: Json;
  position_x: number;
  position_y: number;
  created_at: string;
}

export interface AutomationConnection {
  id: string;
  automation_id: string;
  source_node_id: string;
  target_node_id: string;
  source_handle: string | null;
  condition_branch: string | null;
}

export interface AutomationWithNodes extends Automation {
  nodes: AutomationNode[];
  connections: AutomationConnection[];
}

export interface AutomationTemplate {
  id: string;
  organization_id: string;
  name: string;
  content: string;
  media_url: string | null;
  media_type: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationExecution {
  id: string;
  automation_id: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  organization_id: string;
  status: string;
  current_node_id: string | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  execution_data: Json;
  next_execution_at: string | null;
  lead?: {
    id: string;
    name: string | null;
  } | null;
  automation?: {
    id: string;
    name: string | null;
  } | null;
}

export interface AutomationExecutionStep {
  id: string;
  execution_id: string;
  node_key: string;
  node_type: NodeType;
  action_type: ActionType | null;
  status: string;
  attempt: number;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface AutomationExecutionSummary {
  automationId: string;
  total: number;
  queued: number;
  running: number;
  waiting: number;
  completed: number;
  failed: number;
  cancelled: number;
  activeExecutionIds: string[];
  activeIdsTruncated: boolean;
  lastStartedAt: string | null;
}

export type AutomationRuntimeIssueKind =
  | 'dead_letter'
  | 'failed_event'
  | 'failed_effect'
  | 'circuit_decision'
  | 'duplicate_decision'
  | 'ambiguous_effect'
  | 'circuit_open';

export interface AutomationRuntimeIssue {
  id: string;
  kind: AutomationRuntimeIssueKind;
  severity: 'info' | 'warning' | 'error';
  status: string;
  automationId: string | null;
  automationName: string | null;
  executionId: string | null;
  leadId: string | null;
  message: string | null;
  details: unknown;
  retryable: boolean;
  occurredAt: string;
}

export interface AutomationRuntimeIssuesResult {
  summary: {
    deadLetters: number;
    failedEvents: number;
    failedEffects: number;
    openCircuits: number;
    duplicateDecisions: number;
    unknownEffects: number;
    staleSendingEffects: number;
  };
  issues: AutomationRuntimeIssue[];
}

export type CreateAutomationInput = {
  name: string;
  description?: string | null;
  trigger_type: TriggerType;
  trigger_config?: Record<string, unknown>;
  flow_definition?: FlowDefinition;
  is_active?: boolean;
};

export type UpdateAutomationInput = {
  id: string;
  name?: string;
  description?: string | null;
  is_active?: boolean;
};

export type StartAutomationResult = {
  executionId: string;
  automationId: string;
  automationName: string;
  executorStarted: boolean;
  status: 'queued' | 'running' | 'waiting' | 'completed' | 'cancelled' | 'canceled';
  dispatchPending: boolean;
};

export type AutomationMediaType = 'image' | 'audio' | 'video';

export type AutomationMediaFile = {
  name: string;
  path: string;
  bucket: string;
  publicUrl: string;
  contentType: string | null;
  size: number | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AutomationMediaPage = {
  files: AutomationMediaFile[];
  nextOffset: number | null;
};

export const automationsAPI = {
  async listAutomations(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<Automation[]>>('/v1/automations', {
      organizationId,
    });
    validateDomainResponse(apiAutomationListResponseSchema, response, 'automations.list');
    return response.data;
  },

  async getAutomation(automationId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AutomationWithNodes>>(`/v1/automations/${automationId}`, {
      organizationId,
    });
    validateDomainResponse(apiAutomationWithNodesResponseSchema, response, 'automations.get');
    return response.data;
  },

  async createAutomation(input: CreateAutomationInput, organizationId?: string | null) {
    const body = parseDomainInput(createAutomationInputSchema, input, 'automations.create');
    const response = await vimobAPIRequest<Envelope<Automation>>('/v1/automations', {
      method: 'POST',
      organizationId,
      body,
    });
    validateDomainResponse(apiAutomationResponseSchema, response, 'automations.create');
    return response.data;
  },

  async updateAutomation(input: UpdateAutomationInput, organizationId?: string | null) {
    const { id, ...body } = input;
    const validatedBody = parseDomainInput(updateAutomationBodySchema, body, 'automations.update');
    const response = await vimobAPIRequest<Envelope<Automation>>(`/v1/automations/${id}`, {
      method: 'PATCH',
      organizationId,
      body: validatedBody,
    });
    validateDomainResponse(apiAutomationResponseSchema, response, 'automations.update');
    return response.data;
  },

  async deleteAutomation(automationId: string, organizationId?: string | null) {
    await vimobAPIRequest<null>(`/v1/automations/${automationId}`, {
      method: 'DELETE',
      organizationId,
    });
  },

  async duplicateAutomation(automationId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<Automation>>(`/v1/automations/${automationId}/duplicate`, {
      method: 'POST',
      organizationId,
    });
    validateDomainResponse(apiAutomationResponseSchema, response, 'automations.duplicate');
    return response.data;
  },

  async saveAutomationFlow(
    automationId: string,
    input: {
      flowDefinition: FlowDefinition;
      name?: string;
      description?: string | null;
      isActive?: boolean;
    },
    organizationId?: string | null,
  ) {
    const body = parseDomainInput(saveAutomationFlowInputSchema, input, 'automations.flow.save');
    const response = await vimobAPIRequest<Envelope<{ nodes: AutomationNode[] }>>(
      `/v1/automations/${automationId}/flow`,
      {
        method: 'PUT',
        organizationId,
        body,
      },
    );
    validateDomainResponse(apiAutomationNodesResponseSchema, response, 'automations.flow.save');
    return response.data;
  },

  async startAutomation(
    automationId: string,
    input: { leadId: string; conversationId?: string | null },
    organizationId?: string | null,
  ) {
    const body = parseDomainInput(startAutomationInputSchema, input, 'automations.start');
    const response = await vimobAPIRequest<Envelope<StartAutomationResult>>(
      `/v1/automations/${automationId}/start`,
      {
        method: 'POST',
        organizationId,
        body,
      },
    );
    validateDomainResponse(apiStartAutomationResponseSchema, response, 'automations.start');

    return response.data;
  },

  async listTemplates(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AutomationTemplate[]>>('/v1/automation-templates', {
      organizationId,
    });
    validateDomainResponse(apiAutomationTemplateListResponseSchema, response, 'automations.templates.list');
    return response.data;
  },

  async createTemplate(
    input: { name: string; content: string; media_url?: string | null; media_type?: string | null },
    organizationId?: string | null,
  ) {
    const body = parseDomainInput(createAutomationTemplateInputSchema, input, 'automations.templates.create');
    const response = await vimobAPIRequest<Envelope<AutomationTemplate>>('/v1/automation-templates', {
      method: 'POST',
      organizationId,
      body,
    });
    validateDomainResponse(apiAutomationTemplateResponseSchema, response, 'automations.templates.create');
    return response.data;
  },

  async deleteTemplate(templateId: string, organizationId?: string | null) {
    await vimobAPIRequest<null>(`/v1/automation-templates/${templateId}`, {
      method: 'DELETE',
      organizationId,
    });
  },

  async listExecutions(params: {
    automationId?: string;
    limit?: number;
    organizationId?: string | null;
  }) {
    const response = await vimobAPIRequest<Envelope<AutomationExecution[]>>('/v1/automation-executions', {
      organizationId: params.organizationId,
      query: {
        automationId: params.automationId,
        limit: params.limit,
      },
    });
    validateDomainResponse(apiAutomationExecutionListResponseSchema, response, 'automations.executions.list');
    return response.data;
  },

  async listExecutionSummaries(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AutomationExecutionSummary[]>>('/v1/automation-executions/summary', {
      organizationId,
    });
    validateDomainResponse(apiAutomationExecutionSummaryListResponseSchema, response, 'automations.executions.summary');
    return response.data;
  },

  async cancelAutomationExecutions(automationId: string, organizationId?: string | null) {
    return vimobAPIRequest<{ ok: boolean; cancelled: number }>(
      `/v1/automations/${encodeURIComponent(automationId)}/executions/cancel`,
      { method: 'POST', organizationId },
    );
  },

  async cancelExecution(executionId: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/automation-executions/${executionId}/cancel`, {
      method: 'POST',
      organizationId,
    });
  },

  async listExecutionSteps(
    executionId: string,
    params: { limit?: number; offset?: number; organizationId?: string | null } = {},
  ) {
    const response = await vimobAPIRequest<Envelope<AutomationExecutionStep[]>>(
      `/v1/automation-executions/${encodeURIComponent(executionId)}/steps`,
      {
        organizationId: params.organizationId,
        query: { limit: params.limit, offset: params.offset },
      },
    );
    validateDomainResponse(apiAutomationExecutionStepListResponseSchema, response, 'automations.executions.steps');
    return response.data;
  },

  async listRuntimeIssues(params: { limit?: number; offset?: number; organizationId?: string | null } = {}) {
    const response = await vimobAPIRequest<Envelope<AutomationRuntimeIssuesResult>>('/v1/automation-runtime/issues', {
      organizationId: params.organizationId,
      query: { limit: params.limit, offset: params.offset },
    });
    validateDomainResponse(apiAutomationRuntimeIssuesResponseSchema, response, 'automations.runtime.issues');
    return response.data;
  },

  async retryRuntimeIssue(kind: AutomationRuntimeIssueKind, issueId: string, organizationId?: string | null) {
    const safeKind = parseDomainInput(automationRuntimeIssueKindSchema, kind, 'automations.runtime.retry');
    await vimobAPIRequest<{ ok: boolean }>(
      `/v1/automation-runtime/issues/${encodeURIComponent(safeKind)}/${encodeURIComponent(issueId)}/retry`,
      { method: 'POST', organizationId },
    );
  },

  async listMedia(
    mediaType: AutomationMediaType,
    params: { limit?: number; offset?: number; organizationId?: string | null } = {},
  ) {
    const validatedMediaType = parseDomainInput(automationMediaTypeSchema, mediaType, 'automations.media.list');
    const response = await vimobAPIRequest<Envelope<AutomationMediaPage>>('/v1/automation-media', {
      organizationId: params.organizationId,
      query: { mediaType: validatedMediaType, limit: params.limit, offset: params.offset },
    });
    validateDomainResponse(apiAutomationMediaListResponseSchema, response, 'automations.media.list');
    return response.data;
  },

  async uploadMedia(
    input: { mediaType: AutomationMediaType; file: File | Blob; fileName?: string },
    organizationId?: string | null,
  ) {
    const formData = new FormData();
    const fileName = input.fileName || (input.file instanceof File ? input.file.name : 'automation-media');
    formData.append('mediaType', input.mediaType);
    formData.append('file', input.file, fileName);

    const response = await vimobAPIRequest<Envelope<AutomationMediaFile>>('/v1/automation-media', {
      method: 'POST',
      organizationId,
      body: formData,
    });
    validateDomainResponse(apiAutomationMediaResponseSchema, response, 'automations.media.upload');
    return response.data;
  },

  async deleteMedia(mediaType: AutomationMediaType, fileName: string, organizationId?: string | null) {
    await vimobAPIRequest<null>('/v1/automation-media', {
      method: 'DELETE',
      organizationId,
      query: { mediaType, fileName },
    });
  },
};
