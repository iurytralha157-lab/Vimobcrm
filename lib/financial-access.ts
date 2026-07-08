type FinancialOrganizationLike = {
  id?: string | null;
  organization_id?: string | null;
  name?: string | null;
  organization_name?: string | null;
};

const VETTER_ORGANIZATION_NAMES = new Set(['vetter co', 'vetter co.']);

function normalizeOrganizationName(value?: string | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function configuredFinancialOrganizationIds() {
  return (process.env.NEXT_PUBLIC_FINANCIAL_ORGANIZATION_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function canUseFinancialModule(organization?: FinancialOrganizationLike | null) {
  if (!organization) return false;

  const organizationIds = configuredFinancialOrganizationIds();
  const currentIds = [organization.id, organization.organization_id].filter(Boolean) as string[];

  if (organizationIds.length > 0 && currentIds.some((id) => organizationIds.includes(id))) {
    return true;
  }

  const organizationName = normalizeOrganizationName(
    organization.name || organization.organization_name
  );

  return VETTER_ORGANIZATION_NAMES.has(organizationName);
}
