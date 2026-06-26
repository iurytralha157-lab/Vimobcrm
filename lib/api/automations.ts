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
  | "send_whatsapp_template"
  | "send_email"
  | "send_image"
  | "send_audio"
  | "send_video"
  | "collect_input"
  | "move_lead"
  | "add_tag"
  | "remove_tag"
  | "create_task"
  | "assign_user"
  | "webhook"
  | "redirect"
  | "set_variable";

export interface FlowNode {
  id: string;
  type: string;
  action_type?: string | null;
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

export type CreateAutomationInput = {
  name: string;
  description?: string | null;
  trigger_type: TriggerType;
  trigger_config?: Record<string, unknown>;
  flow_definition?: FlowDefinition | null;
};

export type UpdateAutomationInput = Partial<Automation> & { id: string };

export type StartAutomationResult = {
  executionId: string;
  automationId: string;
  automationName: string;
  executorStarted: boolean;
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

export const automationsAPI = {
  async listAutomations(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<Automation[]>>('/v1/automations', {
      organizationId,
    });
    return response.data;
  },

  async getAutomation(automationId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AutomationWithNodes>>(`/v1/automations/${automationId}`, {
      organizationId,
    });
    return response.data;
  },

  async createAutomation(input: CreateAutomationInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<Automation>>('/v1/automations', {
      method: 'POST',
      organizationId,
      body: input,
    });
    return response.data;
  },

  async updateAutomation(input: UpdateAutomationInput, organizationId?: string | null) {
    const { id, ...body } = input;
    const response = await vimobAPIRequest<Envelope<Automation>>(`/v1/automations/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    });
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
    return response.data;
  },

  async saveAutomationFlow(
    automationId: string,
    flowDefinition: FlowDefinition,
    organizationId?: string | null,
  ) {
    const response = await vimobAPIRequest<Envelope<{ nodes: AutomationNode[] }>>(
      `/v1/automations/${automationId}/flow`,
      {
        method: 'PUT',
        organizationId,
        body: { flowDefinition },
      },
    );
    return response.data;
  },

  async startAutomation(
    automationId: string,
    input: { leadId: string; conversationId?: string | null },
    organizationId?: string | null,
  ) {
    const response = await vimobAPIRequest<Envelope<StartAutomationResult>>(
      `/v1/automations/${automationId}/start`,
      {
        method: 'POST',
        organizationId,
        body: input,
      },
    );

    return response.data;
  },

  async listTemplates(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AutomationTemplate[]>>('/v1/automation-templates', {
      organizationId,
    });
    return response.data;
  },

  async createTemplate(
    input: { name: string; content: string; media_url?: string | null; media_type?: string | null },
    organizationId?: string | null,
  ) {
    const response = await vimobAPIRequest<Envelope<AutomationTemplate>>('/v1/automation-templates', {
      method: 'POST',
      organizationId,
      body: input,
    });
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
    return response.data;
  },

  async cancelExecution(executionId: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/automation-executions/${executionId}/cancel`, {
      method: 'POST',
      organizationId,
    });
  },

  async listMedia(mediaType: AutomationMediaType, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<AutomationMediaFile[]>>('/v1/automation-media', {
      organizationId,
      query: { mediaType },
    });
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
