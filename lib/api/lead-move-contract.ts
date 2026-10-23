import { getAPIBaseURL, vimobAPIRequest, type VimobAPIRequestIntent } from '@/lib/api/vimob-client';
import { VimobAPIError } from '@/lib/api/vimob-error';
import { captureCurrentLeadRequestIntent } from '@/lib/api/lead-request-intent';
import { LEAD_MOVE_STAGE_CONTRACT, leadMoveStageCapabilitiesSchema } from '@/lib/validation/lead-move-contract';

export const LEAD_MOVE_CONTRACT_FRESH_MS = 30_000;
const issuedContracts = new WeakSet<object>();

export type LeadMoveStageContract = Readonly<{
  contract: typeof LEAD_MOVE_STAGE_CONTRACT;
  organizationId: string;
  userId: string;
  sessionId: string;
  apiBaseURL: string;
  checkedAt: number;
}>;

export class LeadMoveContractError extends VimobAPIError {
  constructor(requestId?: string) {
    super('Não foi possível mover o lead agora. Tente novamente em instantes.', {
      code: 'lead_move_contract_unavailable', status: 409, requestId,
    });
    this.name = 'LeadMoveContractError';
  }
}

export async function getLeadMoveStageContract(organizationId: string, intent?: VimobAPIRequestIntent): Promise<LeadMoveStageContract> {
  const captured = captureCurrentLeadRequestIntent(intent);
  const apiBaseURL = getAPIBaseURL();
  if (!organizationId || !captured.expectedUserId || !captured.expectedSessionId) throw new LeadMoveContractError();
  let response: unknown;
  try {
    response = await vimobAPIRequest<unknown>('/v1/leads/capabilities/move-stage', {
      ...captured, organizationId, retry: false, cache: 'no-store', timeoutMs: 8_000, skipTelemetry: true,
    });
  } catch (error) {
    if (error instanceof VimobAPIError && (error.status === 404 || error.status === 405)) {
      throw new LeadMoveContractError(error.requestId);
    }
    throw error;
  }
  if (!leadMoveStageCapabilitiesSchema.safeParse(response).success || apiBaseURL !== getAPIBaseURL()) {
    throw new LeadMoveContractError();
  }
  const contract: LeadMoveStageContract = Object.freeze({
    contract: LEAD_MOVE_STAGE_CONTRACT, organizationId,
    userId: captured.expectedUserId, sessionId: captured.expectedSessionId,
    apiBaseURL, checkedAt: Date.now(),
  });
  issuedContracts.add(contract);
  return contract;
}

export function isLeadMoveStageContractCurrent(contract: LeadMoveStageContract | undefined, organizationId: string, intent: VimobAPIRequestIntent): contract is LeadMoveStageContract {
  if (!contract || !issuedContracts.has(contract)) return false;
  const age = Date.now() - contract.checkedAt;
  return contract.contract === LEAD_MOVE_STAGE_CONTRACT && contract.organizationId === organizationId
    && contract.userId === intent.expectedUserId && contract.sessionId === intent.expectedSessionId
    && contract.apiBaseURL === getAPIBaseURL() && age >= 0 && age < LEAD_MOVE_CONTRACT_FRESH_MS;
}

export function assertLeadMoveStageContractCurrent(contract: LeadMoveStageContract | undefined, organizationId: string, intent: VimobAPIRequestIntent): asserts contract is LeadMoveStageContract {
  if (!isLeadMoveStageContractCurrent(contract, organizationId, intent)) throw new LeadMoveContractError();
}

export function invalidateLeadMoveStageContract(contract: LeadMoveStageContract) {
  issuedContracts.delete(contract);
}
