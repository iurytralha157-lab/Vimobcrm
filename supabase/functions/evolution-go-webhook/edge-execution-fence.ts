/** A Go worker reservation is required before an internal Edge invocation acts. */
export type WhatsAppEdgeExecutionScope = {
  organizationId: string;
  sessionId: string;
  inboxId: string;
  executionId: string;
};

type EdgeExecutionRpcClient = {
  rpc: (
    name: string,
    parameters: Record<string, string>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readWhatsAppEdgeExecutionHeaders(
  headers: Headers,
): Pick<WhatsAppEdgeExecutionScope, "inboxId" | "executionId"> | null {
  const inboxId = headers.get("x-vimob-inbox-id")?.trim() || "";
  const executionId = headers.get("x-vimob-edge-execution-id")?.trim() || "";
  if (!UUID_PATTERN.test(inboxId) || !UUID_PATTERN.test(executionId)) return null;
  return { inboxId: inboxId.toLowerCase(), executionId: executionId.toLowerCase() };
}

/**
 * The Go HTTP timeout cannot cancel an already running Edge invocation.
 * This DB token keeps cutover fenced until every effect has been awaited.
 */
export async function runWhatsAppEdgeExecutionWithFence<T>(
  client: EdgeExecutionRpcClient,
  scope: WhatsAppEdgeExecutionScope,
  process: () => Promise<T>,
): Promise<T> {
  const parameters = {
    p_organization_id: scope.organizationId,
    p_session_id: scope.sessionId,
    p_inbox_id: scope.inboxId,
    p_execution_id: scope.executionId,
  };
  const started = await client.rpc("start_whatsapp_webhook_edge_execution", parameters);
  if (started.error || started.data !== true) {
    throw new Error("whatsapp_edge_execution_start_rejected");
  }

  try {
    return await process();
  } finally {
    const finished = await client.rpc("finish_whatsapp_webhook_edge_execution", parameters);
    if (finished.error || finished.data !== true) {
      // A failed finish leaves the DB token in place. Go must retry only after
      // reconciling that marker, never treat this response as completed work.
      throw new Error("whatsapp_edge_execution_finish_rejected");
    }
  }
}
