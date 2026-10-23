import { getVimobAPIAccessTokenSessionId, getVimobAPIAccessTokenUserId, type VimobAPIRequestIntent } from '@/lib/api/vimob-client';
import { captureLeadRequestIntent } from '@/lib/lead-request-intent';

/** Pin legacy direct callers at API entry, before asynchronous token resolution. */
export function captureCurrentLeadRequestIntent(intent?: VimobAPIRequestIntent): VimobAPIRequestIntent {
  return Object.freeze({ ...intent, ...captureLeadRequestIntent(
    intent?.expectedUserId === undefined ? getVimobAPIAccessTokenUserId() : intent.expectedUserId,
    intent?.expectedSessionId === undefined ? getVimobAPIAccessTokenSessionId() : intent.expectedSessionId,
  ) });
}
