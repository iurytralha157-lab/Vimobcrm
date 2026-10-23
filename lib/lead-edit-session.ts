/** Keep a form snapshot stable until the user closes it or chooses to reload. */
export function shouldInitializeLeadForm(previous: string | null, identity: string, ready: boolean) {
  return ready && previous !== identity;
}

export function getLeadDraftKey(userId: string | undefined, organizationId: string | null | undefined, pipelineId?: string | null, stageId?: string | null) {
  return userId && organizationId
    ? `lead-draft-v2-${userId}-${organizationId}-${pipelineId || 'default'}-${stageId || 'any-stage'}`
    : null;
}

/** Profile is an aggregate on the server; send it only when it changed. */
export function changedLeadFields<T extends object>(base: T, next: T): Partial<T> {
  const changed: Partial<T> = {};
  for (const key of Object.keys(next) as Array<keyof T>) {
    if (JSON.stringify(base[key]) !== JSON.stringify(next[key])) changed[key] = next[key];
  }
  return changed;
}

type LeadEditForm = {
  name: string; phone: string; email: string; feedback: string; source: string;
  cargo: string; empresa: string; profissao: string; renda_familiar: string;
  valor_interesse: string; property_id: string; interest_property_ids: string[];
  person_type: 'individual' | 'company'; gender: '' | 'male' | 'female' | 'other';
  social_name: string; birth_date: string; cpf: string; rg: string; cnpj: string;
  corporate_name: string; trade_name: string; state_registration: string;
};

/** The persisted primary wins over a stale metadata order; keep all other interests. */
export function normalizeLeadInterestPropertyIds(primaryPropertyId: string | null | undefined, values: readonly unknown[] = []) {
  const primary = primaryPropertyId?.trim() || '';
  const ids = [...new Set(values.filter((value): value is string => typeof value === 'string')
    .map(value => value.trim()).filter(Boolean))];
  return primary ? [primary, ...ids.filter(id => id !== primary)] : ids;
}

export function buildLeadEditFields(form: LeadEditForm, parseCurrency: (value: string) => number | undefined) {
  const propertyId = form.interest_property_ids[0] || form.property_id || null;
  const interestPropertyIds = normalizeLeadInterestPropertyIds(propertyId, form.interest_property_ids);
  return {
    name: form.name.trim(), phone: form.phone || null, email: form.email.trim() || null,
    feedback: form.feedback.trim() || null, source: form.source || 'manual',
    cargo: form.cargo || null, empresa: form.empresa || null, profissao: form.profissao || null,
    renda_familiar: form.renda_familiar || null, valor_interesse: parseCurrency(form.valor_interesse) ?? null,
    property_id: propertyId, interest_property_id: propertyId, interest_property_ids: interestPropertyIds,
    profile: {
      personType: form.person_type, gender: form.gender || undefined, socialName: form.social_name || undefined,
      birthDate: form.birth_date || undefined, cpf: form.cpf || undefined, rg: form.rg || undefined,
      cnpj: form.cnpj || undefined, corporateName: form.corporate_name || undefined,
      tradeName: form.trade_name || undefined, stateRegistration: form.state_registration || undefined,
    },
  };
}

export async function uploadLeadFiles<T>(files: readonly T[], upload: (file: T) => Promise<unknown>, shouldContinue: () => boolean = () => true): Promise<T[]> {
  const failed: T[] = [];
  for (let index = 0; index < files.length; index += 1) {
    if (!shouldContinue()) { failed.push(...files.slice(index)); break; }
    const file = files[index];
    try { await upload(file); } catch { failed.push(file); }
  }
  return failed;
}
