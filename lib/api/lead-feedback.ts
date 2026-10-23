import { vimobAPIRequest, type VimobAPIRequestIntent } from '@/lib/api/vimob-client';
import { captureCurrentLeadRequestIntent } from '@/lib/api/lead-request-intent';
import { leadFeedbackCommandSchema, leadFeedbackResponseSchema, type LeadFeedbackCommand } from '@/lib/validation/lead-feedback';
import { parseDomainInput, uuidSchema, validateDomainResponse } from '@/lib/validation/common';

export const leadFeedbackAPI = {
  async record(leadId: string, command: LeadFeedbackCommand, organizationId: string, intent?: VimobAPIRequestIntent) {
    const requestIntent = captureCurrentLeadRequestIntent(intent);
    const id = parseDomainInput(uuidSchema, leadId, 'lead-feedback.lead');
    const org = parseDomainInput(uuidSchema, organizationId, 'lead-feedback.organization');
    const body = parseDomainInput(leadFeedbackCommandSchema, command, 'lead-feedback.command');
    const response = await vimobAPIRequest(`/v1/leads/${id}/feedback`, {
      method: 'POST', ...requestIntent, organizationId: org, body,
    });
    const receipt = validateDomainResponse(leadFeedbackResponseSchema, response, 'lead-feedback.receipt').data;
    if (receipt.commandId !== body.commandId || receipt.leadId !== id) {
      throw new Error('Não foi possível confirmar o feedback salvo. O rascunho foi mantido.');
    }
    return receipt;
  },
};
