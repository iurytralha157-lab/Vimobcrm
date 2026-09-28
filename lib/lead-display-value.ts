type LeadValueFields = {
  valor_interesse?: number | null;
  interest_property?: { preco?: number | null } | null;
  property?: { preco?: number | null } | null;
};

// Keep card values aligned with the Pipeline column aggregate: the explicit
// lead value wins, then the visible linked property's price is the fallback.
export function getLeadDisplayValue(lead: LeadValueFields): number {
  const interestValue = Number(lead.valor_interesse ?? 0);
  if (Number.isFinite(interestValue) && interestValue > 0) return interestValue;

  const propertyPrice = Number((lead.interest_property ?? lead.property)?.preco ?? 0);
  return Number.isFinite(propertyPrice) && propertyPrice > 0 ? propertyPrice : 0;
}
