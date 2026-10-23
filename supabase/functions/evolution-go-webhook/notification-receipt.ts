type ReceiptClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

type ReceiptScope = { organizationId: string; sessionId: string };

/** Only call after authenticating the callback and resolving its bound session. */
export async function reconcileUnmatchedNotificationReceipts(
  client: ReceiptClient,
  scope: ReceiptScope,
  messageIds: readonly string[],
  status: string,
  occurredAt: string,
): Promise<Set<string>> {
  const matched = new Set<string>();
  if (!["delivered", "read", "failed"].includes(status)) return matched;
  if (!scope.organizationId || !scope.sessionId) throw new Error("notification_receipt_scope_missing");

  for (const messageId of new Set(messageIds)) {
    if (!messageId.trim()) continue;
    const { data, error } = await client.rpc("evolution_go_reconcile_notification_receipt", {
      p_organization_id: scope.organizationId,
      p_session_id: scope.sessionId,
      p_provider_message_id: messageId,
      p_status: status,
      p_occurred_at: occurredAt,
    });
    if (error) throw error;
    const outcome = data && typeof data === "object" ? (data as Record<string, unknown>).outcome : null;
    if (outcome === "not_found") continue;
    if (outcome !== "applied" && outcome !== "already_applied" && outcome !== "stale") {
      throw new Error("notification_receipt_reconciliation_rejected");
    }
    matched.add(messageId);
  }
  return matched;
}
