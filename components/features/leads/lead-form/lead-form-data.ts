import type { Lead } from '@/hooks/use-leads';
import { normalizeLeadInterestPropertyIds } from '@/lib/lead-edit-session';
import { maskCNPJ, maskCPF, maskRG } from '@/lib/masks';
import { formatPropertyCurrency } from '@/lib/property-display-utils';

export type EditableLead = Omit<Partial<Lead>, 'tags' | 'stage' | 'assignee'> & {
  id: string;
  tags?: Array<{ id?: string; name?: string | null; color?: string | null }>;
};

export type LeadFormErrors = Partial<Record<
  'name' | 'contact' | 'phone' | 'email' | 'cpf' | 'cnpj' | 'birth_date' | 'assigned_user_id' | 'team_id' | 'pipeline_id' | 'stage_id' | 'lost_reason',
  string
>>;

export function formatCurrencyInput(value: string | number) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return formatPropertyCurrency(value);
  }
  const digits = value.replace(/\D/g, '').slice(0, 15);
  if (!digits) return '';
  return formatPropertyCurrency(Number(digits) / 100);
}

export function parseCurrencyInput(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) / 100 : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function metadataText(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' ? value : '';
}

export function buildLeadFormData({
  editableLead,
  currentUserProfileId,
  defaultPipelineId,
  defaultStageId,
  cpf,
  rg,
}: {
  editableLead: EditableLead | null;
  currentUserProfileId?: string;
  defaultPipelineId?: string | null;
  defaultStageId?: string | null;
  cpf?: string;
  rg?: string;
}) {
  const metadata = asRecord(editableLead?.metadata);
  const nestedProfile = asRecord(metadata.profile);
  const profileMetadata = Object.keys(nestedProfile).length > 0 ? nestedProfile : metadata;
  const primaryPropertyId = editableLead?.interest_property_id || editableLead?.property_id || '';
  const metadataPropertyIds = Array.isArray(metadata.interestPropertyIds)
    ? metadata.interestPropertyIds.filter((value): value is string => typeof value === 'string')
    : [];
  const interestPropertyIds = normalizeLeadInterestPropertyIds(primaryPropertyId, metadataPropertyIds);

  return {
    name: editableLead?.name || '',
    phone: editableLead?.phone || '',
    email: editableLead?.email || '',
    message: editableLead?.message || '',
    feedback: editableLead?.feedback || '',
    source: editableLead?.source || '',
    person_type: (metadataText(profileMetadata, 'personType') === 'company' ? 'company' : 'individual') as 'individual' | 'company',
    gender: (['male', 'female', 'other'].includes(metadataText(profileMetadata, 'gender')) ? metadataText(profileMetadata, 'gender') : '') as '' | 'male' | 'female' | 'other',
    social_name: metadataText(profileMetadata, 'socialName'),
    cpf: maskCPF(cpf || metadataText(profileMetadata, 'cpf')),
    rg: maskRG(rg || metadataText(profileMetadata, 'rg')),
    birth_date: metadataText(profileMetadata, 'birthDate'),
    cnpj: maskCNPJ(metadataText(profileMetadata, 'cnpj')),
    corporate_name: metadataText(profileMetadata, 'corporateName'),
    trade_name: metadataText(profileMetadata, 'tradeName'),
    state_registration: metadataText(profileMetadata, 'stateRegistration'),
    is_portability: false,
    mother_name: '',
    uf: '',
    cidade: '',
    bairro: '',
    endereco: '',
    numero: '',
    cep: '',
    plan_id: '',
    due_day: '',
    payment_method: '',
    cargo: editableLead?.cargo || '',
    empresa: editableLead?.empresa || '',
    profissao: editableLead?.profissao || '',
    renda_familiar: editableLead?.renda_familiar || '',
    valor_interesse: editableLead?.valor_interesse == null ? '' : formatCurrencyInput(editableLead.valor_interesse),
    assigned_user_id: editableLead?.assigned_user_id || currentUserProfileId || '',
    team_id: editableLead?.team_id || '',
    pipeline_id: editableLead?.pipeline_id || defaultPipelineId || '',
    stage_id: editableLead?.stage_id || defaultStageId || '',
    property_id: primaryPropertyId,
    interest_property_ids: interestPropertyIds,
    deal_status: editableLead?.deal_status || 'open',
    lost_reason: editableLead?.lost_reason || '',
    tag_ids: (editableLead?.tags || []).flatMap((tag) => tag.id ? [tag.id] : []),
    conversation_id: '',
  };
}

export type LeadFormData = ReturnType<typeof buildLeadFormData>;
export type UpdateLeadFormField = <K extends keyof LeadFormData>(field: K, value: LeadFormData[K]) => void;

export function isFormEmpty(data: LeadFormData) {
  return !data.name.trim()
    && !data.phone
    && !data.email.trim()
    && !data.message.trim()
    && !data.feedback.trim()
    && !data.source
    && data.person_type === 'individual'
    && !data.gender
    && !data.social_name
    && !data.cpf
    && !data.rg
    && !data.birth_date
    && !data.cnpj
    && !data.corporate_name
    && !data.trade_name
    && !data.state_registration
    && !data.mother_name
    && !data.uf
    && !data.cidade
    && !data.bairro
    && !data.endereco
    && !data.numero
    && !data.cep
    && !data.plan_id
    && !data.due_day
    && !data.payment_method
    && !data.cargo
    && !data.empresa
    && !data.profissao
    && !data.renda_familiar
    && !data.valor_interesse
    && !data.lost_reason
    && !data.property_id
    && data.interest_property_ids.length === 0
    && data.tag_ids.length === 0
    && !data.is_portability;
}
