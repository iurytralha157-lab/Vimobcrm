import { vimobAPIRequest, type VimobAPIRequestIntent } from '@/lib/api/vimob-client';
import { captureCurrentLeadRequestIntent } from '@/lib/api/lead-request-intent';
import { leadContactOutcomeCommandSchema, leadContactOutcomeResponseSchema,
  type LeadContactOutcomeCommand } from '@/lib/validation/lead-contact-outcomes';
import { parseDomainInput, uuidSchema, validateDomainResponse } from '@/lib/validation/common';

export const leadContactOutcomesAPI = {
  async record(leadId: string, command: LeadContactOutcomeCommand, organizationId: string, intent?: VimobAPIRequestIntent) {
    const requestIntent = captureCurrentLeadRequestIntent(intent);
    const id = parseDomainInput(uuidSchema, leadId, 'lead-contact-outcomes.lead');
    const org = parseDomainInput(uuidSchema, organizationId, 'lead-contact-outcomes.organization');
    const body = parseDomainInput(leadContactOutcomeCommandSchema, command, 'lead-contact-outcomes.command');
    const response = await vimobAPIRequest(`/v1/leads/${id}/contact-outcomes`, {
      method: 'POST', ...requestIntent, retry: false, organizationId: org, body,
    });
    const receipt = validateDomainResponse(leadContactOutcomeResponseSchema, response, 'lead-contact-outcomes.receipt').data;
    if (receipt.commandId !== body.commandId || receipt.leadId !== id || receipt.channel !== body.channel) {
      throw new Error('Não foi possível confirmar o resultado salvo. O rascunho foi mantido.');
    }
    return receipt;
  },
};
