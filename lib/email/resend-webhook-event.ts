export type WebhookJson =
  | string
  | number
  | boolean
  | null
  | { [key: string]: WebhookJson }
  | WebhookJson[]

export type ResendEmailWebhookEventInput = {
  type: string
  created_at: string
  data: Record<string, unknown>
}

export type RecordResendEmailEventArgs = {
  p_provider_event_id: string
  p_provider_message_id: string
  p_event_type: string
  p_occurred_at: string
  p_payload: { [key: string]: WebhookJson }
}

export type ResendWebhookPersistenceResult =
  | {
      ok: true
      status: 200
      duplicate: boolean
    }
  | {
      ok: false
      status: 500
      error: unknown
    }

type ResendEventRPCResponse = {
  data: boolean | null
  error: unknown | null
}

function requiredTrimmedText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string') {
    throw new Error(`${field} is required.`)
  }

  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} is invalid.`)
  }

  return normalized
}

export function buildRecordResendEmailEventArgs(
  event: ResendEmailWebhookEventInput,
  svixId: string,
): RecordResendEmailEventArgs {
  const providerEventId = requiredTrimmedText(svixId, 'svix-id', 255)
  const providerMessageId = requiredTrimmedText(
    event.data.email_id,
    'data.email_id',
    255,
  )
  const eventType = requiredTrimmedText(event.type, 'type', 80)
  const occurredAt = requiredTrimmedText(event.created_at, 'created_at', 80)

  if (!eventType.startsWith('email.')) {
    throw new Error('Only Resend email events are supported.')
  }

  if (Number.isNaN(Date.parse(occurredAt))) {
    throw new Error('created_at must be a valid date.')
  }

  // The payload originates from a verified JSON request. Keeping only `data`
  // matches the database contract used to extract bounce/failure details.
  const payload = event.data as { [key: string]: WebhookJson }

  return {
    p_provider_event_id: providerEventId,
    p_provider_message_id: providerMessageId,
    p_event_type: eventType,
    p_occurred_at: occurredAt,
    p_payload: payload,
  }
}

export async function persistResendEmailEvent(
  args: RecordResendEmailEventArgs,
  executeRPC: (
    rpcArgs: RecordResendEmailEventArgs,
  ) => PromiseLike<ResendEventRPCResponse>,
): Promise<ResendWebhookPersistenceResult> {
  try {
    const result = await executeRPC(args)

    if (result.error || typeof result.data !== 'boolean') {
      return {
        ok: false,
        status: 500,
        error: result.error ?? new Error('Unexpected Resend event RPC response.'),
      }
    }

    return {
      ok: true,
      status: 200,
      duplicate: result.data === false,
    }
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error,
    }
  }
}
