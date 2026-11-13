import type { Edge, Node } from 'reactflow'
import type { AutomationConnection } from '@/lib/api/automations'

type WaitSource = Pick<Node<{ stop_on_reply?: unknown }>, 'type' | 'data'>

export function automationEditorSourceHandle(
  connection: Pick<AutomationConnection, 'source_handle' | 'condition_branch'>,
  sourceNode?: WaitSource,
) {
  const storedHandle = connection.condition_branch || connection.source_handle
  const handle = storedHandle && storedHandle !== 'default' ? storedHandle : undefined
  // Older editors saved the single output of an ordinary wait as no_reply.
  if (sourceNode?.type === 'wait' && sourceNode.data.stop_on_reply !== true && handle === 'no_reply') return undefined
  return handle
}

export function updateAutomationWaitOutputs(edges: Edge[], nodeId: string, stopOnReply: boolean) {
  return edges
    .filter((edge) => stopOnReply || edge.source !== nodeId || edge.sourceHandle !== 'replied')
    .map((edge) => {
      if (edge.source !== nodeId) return edge
      if (stopOnReply && !edge.sourceHandle) return { ...edge, sourceHandle: 'no_reply' }
      if (!stopOnReply && edge.sourceHandle === 'no_reply') return { ...edge, sourceHandle: undefined }
      return edge
    })
}

export function automationEditorSession(config: Record<string, unknown>, defaultSessionId: string, replaceSessions: boolean) {
  const storedSessionId = typeof config.session_id === 'string' ? config.session_id : ''
  return replaceSessions ? defaultSessionId : storedSessionId || defaultSessionId
}

export function automationEditorReplyConfig(config: Record<string, unknown>) {
  return {
    on_reply_message: config.on_reply_message ?? null,
    on_reply_stage_id: config.on_reply_stage_id ?? config.on_reply_move_to_stage_id ?? null,
    on_reply_move_to_stage_id: config.on_reply_move_to_stage_id ?? config.on_reply_stage_id ?? null,
    reply_match_mode: config.reply_match_mode ?? 'any_text',
    expected_reply_keywords: config.expected_reply_keywords ?? [],
    handoff_on_unmatched_reply: config.handoff_on_unmatched_reply ?? false,
  }
}
