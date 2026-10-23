import {
  getVimobAPIAccessTokenSessionId,
  getVimobAPIAccessTokenUserId,
  type VimobAPIRequestIntent,
  vimobAPIRequest,
} from '@/lib/api/vimob-client'
import { VimobAPIError } from '@/lib/api/vimob-error'

type ManagementRequestOptions = NonNullable<Parameters<typeof vimobAPIRequest>[1]> & {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
}

export function captureManagementRequestIntent(signal?: AbortSignal): VimobAPIRequestIntent {
  return {
    expectedUserId: getVimobAPIAccessTokenUserId(),
    expectedSessionId: getVimobAPIAccessTokenSessionId(),
    signal,
  }
}

export function assertManagementRequestIntent(intent: VimobAPIRequestIntent) {
  if (!intent.expectedUserId || !intent.expectedSessionId ||
      intent.expectedUserId !== getVimobAPIAccessTokenUserId() ||
      intent.expectedSessionId !== getVimobAPIAccessTokenSessionId()) {
    throw new VimobAPIError('A sessão mudou. Reabra a tela antes de continuar.', {
      code: 'api_request_identity_changed', status: 409,
    })
  }
}

/** Pin the gesture before token resolution/retry; reads retain their own policy. */
export async function managementAPIRequest<T>(path: string, options: ManagementRequestOptions): Promise<T> {
  const expectedUserId = options.expectedUserId !== undefined
    ? options.expectedUserId : getVimobAPIAccessTokenUserId()
  const expectedSessionId = options.expectedSessionId !== undefined
    ? options.expectedSessionId : getVimobAPIAccessTokenSessionId()
  const result = await vimobAPIRequest<T>(path, { ...options, expectedUserId, expectedSessionId })
  // A completed old request must not be reported as success in the new actor's UI.
  assertManagementRequestIntent({ expectedUserId, expectedSessionId })
  return result
}
