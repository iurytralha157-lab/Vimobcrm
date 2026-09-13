import type { ActivityEventRow, AuditLogRow, HistoryMetadata } from './types';
import { asMetadata, metadataString } from './metadata';
import { sourceLabel } from './presentation';


const AUDIT_FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  email: 'E-mail',
  phone: 'Telefone',
  source: 'Origem',
  message: 'Mensagem',
  property_code: 'Código do imóvel',
  property_id: 'Imóvel',
  interest_property_id: 'Imóvel de interesse',
  pipeline_id: 'Pipeline',
  stage_id: 'Etapa',
  assigned_user_id: 'Responsável',
  valor_interesse: 'Valor de interesse',
  commission_percentage: 'Comissão',
  deal_status: 'Status',
  lost_reason: 'Motivo de perda',
  feedback: 'Feedback',
  cargo: 'Cargo',
  empresa: 'Empresa',
  profissao: 'Profissão',
  endereco: 'Endereço',
  numero: 'Número',
  complemento: 'Complemento',
  bairro: 'Bairro',
  cep: 'CEP',
  cidade: 'Cidade',
  uf: 'UF',
  renda_familiar: 'Renda familiar',
  faixa_valor_imovel: 'Faixa de valor',
  finalidade_compra: 'Finalidade',
  trabalha: 'Trabalha',
  procura_financiamento: 'Procura financiamento',
  person_type: 'Tipo de pessoa',
  gender: 'Gênero',
  social_name: 'Nome social',
  birth_date: 'Data de nascimento',
  cpf: 'CPF',
  rg: 'RG',
  cnpj: 'CNPJ',
  corporate_name: 'Razão social',
  trade_name: 'Nome fantasia',
  state_registration: 'Inscrição estadual',
};

const AUDIT_IGNORED_FIELDS = new Set(['origin', 'is_own_resource']);
const AUDIT_FEMININE_FIELDS = new Set(['birth_date', 'source', 'empresa', 'profissao', 'renda_familiar', 'commission_percentage']);

function auditChangedKeys(audit: AuditLogRow) {
  const newData = asMetadata(audit.new_data);
  return Object.keys(newData)
    .filter((key) => !AUDIT_IGNORED_FIELDS.has(key))
    .sort();
}

function isNearbyHistoryTimestamp(left: string, right: string, toleranceMs = 15_000) {
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && Math.abs(leftTime - rightTime) <= toleranceMs;
}

export function auditVisibleKeys(audit: AuditLogRow, activityEvents: ActivityEventRow[]) {
  const visibleKeys = new Set(auditChangedKeys(audit));
  const nearbyActivities = activityEvents.filter((activity) => {
    if (!isNearbyHistoryTimestamp(audit.created_at, activity.created_at)) return false;
    return !audit.user_id || !activity.user_id || audit.user_id === activity.user_id;
  });

  const hasActivity = (types: string[], predicate?: (activity: ActivityEventRow) => boolean) =>
    nearbyActivities.some((activity) => types.includes(activity.type) && (!predicate || predicate(activity)));

  if (hasActivity(['status_change'])) {
    visibleKeys.delete('deal_status');
    visibleKeys.delete('lost_reason');
  }

  if (hasActivity(['property_selected', 'property_linked'])) {
    ['property_id', 'interest_property_id', 'property_code', 'valor_interesse', 'commission_percentage']
      .forEach((key) => visibleKeys.delete(key));
  }

  if (hasActivity(['stage_change', 'stage_changed'])) {
    visibleKeys.delete('stage_id');
    visibleKeys.delete('pipeline_id');
  }

  if (hasActivity(['note', 'note_created'], (activity) => {
    const metadata = asMetadata(activity.metadata);
    return metadataString(metadata.kind)?.toLowerCase() === 'feedback';
  })) {
    visibleKeys.delete('feedback');
  }

  return [...visibleKeys].sort();
}

function auditFieldLabel(key: string) {
  return AUDIT_FIELD_LABELS[key] || key.replace(/_/g, ' ');
}

export function auditEventType(action: string, keys: string[]) {
  if (action === 'delete') return 'lead_deleted';
  if (action === 'create') return 'lead_created';
  if (action === 'move_stage' || keys.some((key) => key === 'stage_id' || key === 'pipeline_id')) {
    return 'stage_change';
  }
  if (keys.includes('assigned_user_id')) return 'assignee_changed';
  if (keys.includes('deal_status')) return 'status_change';
  return 'lead_updated';
}

function auditDisplayValue(
  value: unknown,
  formatPropertyCurrency: (value: number) => string,
  key?: string,
) {
  if (value === null || value === undefined || value === '') return '';
  if (key === 'source') return sourceLabel(String(value));
  if (key === 'valor_interesse') {
    const amount = Number(value);
    if (Number.isFinite(amount)) {
      return formatPropertyCurrency(amount);
    }
  }
  if (key === 'birth_date' && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const [year, month, day] = String(value).split('-');
    return `${day}/${month}/${year}`;
  }
  if (key === 'person_type') {
    return value === 'company' ? 'Pessoa jurídica' : value === 'individual' ? 'Pessoa física' : String(value);
  }
  if (key === 'gender') {
    return value === 'male' ? 'Masculino' : value === 'female' ? 'Feminino' : value === 'other' ? 'Outro' : String(value);
  }
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  return String(value);
}

export function auditContent(
  action: string,
  keys: string[],
  oldData: HistoryMetadata,
  newData: HistoryMetadata,
  formatPropertyCurrency: (value: number) => string,
) {
  if (action === 'delete') return 'Lead removido do CRM';
  if (keys.length === 0) return undefined;
  return keys.map((key) => {
    const label = auditFieldLabel(key);
    const oldValue = auditDisplayValue(oldData[key], formatPropertyCurrency, key);
    const newValue = auditDisplayValue(newData[key], formatPropertyCurrency, key);
    if (key === 'cpf' || key === 'rg') {
      if (!oldValue && newValue) return `${label} adicionado`;
      if (oldValue && !newValue) return `${label} removido`;
      return `${label} atualizado`;
    }
    if (!oldValue && newValue) return `${label} ${AUDIT_FEMININE_FIELDS.has(key) ? 'adicionada' : 'adicionado'}: ${newValue}`;
    if (oldValue && !newValue) return `${label} ${AUDIT_FEMININE_FIELDS.has(key) ? 'removida' : 'removido'} (era: ${oldValue})`;
    return `${label}: ${oldValue} → ${newValue}`;
  }).join('\n');
}
