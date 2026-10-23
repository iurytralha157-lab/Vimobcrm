type UploadScope = { organizationId: string; leadId: string; userId: string; sessionId: string }
type UploadReceipt = UploadScope & { uploadRequestKey: string }

const receipts = new WeakMap<File, Map<string, UploadReceipt>>()

/** The same selected File keeps its key and gesture identity across retries. */
export function getLeadAttachmentUploadReceipt(file: File, scope: UploadScope): UploadReceipt {
  const destination = JSON.stringify([scope.organizationId, scope.leadId])
  const byDestination = receipts.get(file) ?? new Map<string, UploadReceipt>()
  const previous = byDestination.get(destination)
  if (previous) {
    if (previous.userId !== scope.userId || previous.sessionId !== scope.sessionId) {
      throw Object.assign(new Error('A sessão mudou durante o envio. Escolha o arquivo novamente para iniciar outra operação.'), { code: 'request_identity_changed' })
    }
    return previous
  }
  const receipt = { ...scope, uploadRequestKey: crypto.randomUUID() }
  byDestination.set(destination, receipt)
  receipts.set(file, byDestination)
  return receipt
}
