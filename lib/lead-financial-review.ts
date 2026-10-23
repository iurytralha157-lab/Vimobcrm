type LeadFinancialValues = {
  deal_status?: string | null;
  valor_interesse?: number | null;
  commission_percentage?: number | null;
  financial_review_required?: boolean;
};

export const WON_LEAD_FINANCIAL_REVIEW_MESSAGE = 'Dados do lead salvos. Lançamentos e comissões não foram recalculados; solicite a revisão financeira.';
export const LEAD_STATUS_FINANCIAL_REVIEW_MESSAGE = 'Status do lead atualizado. Lançamentos e comissões existentes foram mantidos; solicite a revisão financeira.';

/** The server flags a new win only when records existed before that write. */
export function getLeadStatusFinancialReviewMessage(before: LeadFinancialValues, saved: LeadFinancialValues): string | null {
  const leavingWon = before.deal_status === 'won' && (saved.deal_status === 'open' || saved.deal_status === 'lost');
  const returningToWon = (before.deal_status === 'open' || before.deal_status === 'lost') &&
    saved.deal_status === 'won' && saved.financial_review_required === true;
  return leavingWon || returningToWon ? LEAD_STATUS_FINANCIAL_REVIEW_MESSAGE : null;
}

/** Existing won-deal entries are not recalculated by a lead-only PATCH. */
export function requiresWonLeadFinancialReview(before: LeadFinancialValues, saved: LeadFinancialValues): boolean {
  return before.deal_status === 'won' && saved.deal_status === 'won' && (
    (before.valor_interesse !== undefined && saved.valor_interesse !== undefined && before.valor_interesse !== saved.valor_interesse) ||
    (before.commission_percentage !== undefined && saved.commission_percentage !== undefined && before.commission_percentage !== saved.commission_percentage)
  );
}
