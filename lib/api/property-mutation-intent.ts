import {
  getVimobAPIAccessTokenSessionId,
  getVimobAPIAccessTokenUserId,
  type VimobAPIRequestIntent,
} from '@/lib/api/vimob-client'

/** Pin synchronously, before token resolution can resume under another actor. */
export function capturePropertyMutationIntent(intent?: VimobAPIRequestIntent): VimobAPIRequestIntent {
  return {
    ...intent,
    expectedUserId: intent?.expectedUserId !== undefined
      ? intent.expectedUserId : getVimobAPIAccessTokenUserId(),
    expectedSessionId: intent?.expectedSessionId !== undefined
      ? intent.expectedSessionId : getVimobAPIAccessTokenSessionId(),
  }
}
