import { useQuery } from '@tanstack/react-query';
import { formatResponseTime } from '@/hooks/use-lead-timeline';
import { leadsAPI } from '@/lib/api/leads';

type HistoryMetadata = Record<string, unknown>;

type HistoryActor = {
  id: string;
  name: string;
  avatar_url?: string | null;
};

type TimelineEventRow = {
  id: string;
  event_type: string;
  metadata?: HistoryMetadata | null;
  user_id?: string | null;
  actor_user_id?: string | null;
  created_at?: string | null;
  event_at?: string | null;
  channel?: string | null;
  is_automation?: boolean | null;
};

type ActivityEventRow = {
  id: string;
  type: string;
  content?: string | null;
  created_at: string;
  metadata?: HistoryMetadata | null;
  user_id?: string | null;
  user?: HistoryActor | null;
};

type LeadEntryEventRow = {
  id: string;
  entry_type?: string | null;
  source?: string | null;
  campaign_name?: string | null;
  created_at: string;
};

type DistributionLogRow = {
  id: string;
  round_robin_id?: string | null;
  assigned_user_id?: string | null;
  reason?: string | null;
  created_at: string;
  queue?: { id: string; name?: string | null } | null;
  assigned_user?: HistoryActor | null;
};

type AssignmentLogRow = {
  id: string;
  old_user_id?: string | null;
  new_user_id?: string | null;
  reason?: string | null;
  created_by?: string | null;
  created_at: string;
  old_user?: HistoryActor | null;
  new_user?: HistoryActor | null;
  actor?: HistoryActor | null;
};

type AuditLogRow = {
  id: string;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  old_data?: HistoryMetadata | null;
  new_data?: HistoryMetadata | null;
  user_id?: string | null;
  created_at: string;
  actor?: HistoryActor | null;
};

type LeadMetaHistoryRow = {
  id?: string | null;
  lead_id?: string | null;
  page_id?: string | null;
  form_id?: string | null;
  form_name?: string | null;
  ad_id?: string | null;
  ad_name?: string | null;
  adset_id?: string | null;
  adset_name?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  platform?: string | null;
  source_type?: string | null;
  creative_name?: string | null;
  creative_type?: string | null;
  creative_thumbnail_url?: string | null;
  creative_url?: string | null;
  creative_video_url?: string | null;
  creative_instagram_url?: string | null;
  creative_destination_url?: string | null;
  raw_payload?: Record<string, unknown> | null;
  created_at?: string | null;
};

type LeadHistoryLead = {
  id: string;
  source?: string | null;
  utm_source?: string | null;
  assigned_user_id?: string | null;
  assigned_at?: string | null;
  created_at: string;
  assigned_user?: HistoryActor | null;
};

type LeadHistoryRaw = {
  timelineEvents?: TimelineEventRow[];
  activityEvents?: ActivityEventRow[];
  entryEvents?: LeadEntryEventRow[];
  lead?: LeadHistoryLead | null;
  leadMeta?: LeadMetaHistoryRow | null;
  distributionLogs?: DistributionLogRow[];
  assignmentLogs?: AssignmentLogRow[];
  auditLogs?: AuditLogRow[];
  users?: HistoryActor[];
};

export interface UnifiedHistoryEvent {
  id: string;
  type: string;
  label: string;
  content?: string | null;
  timestamp: string;
  actor?: {
    id: string;
    name: string;
    avatar_url?: string | null;
  } | null;
  source: 'timeline' | 'activity';
  metadata?: HistoryMetadata | null;
  channel?: string | null;
  isAutomation?: boolean;
  // enriched fields
  sourceOrigin?: string | null; // 'meta_ads' | 'whatsapp' | 'website' | 'manual' | 'webhook' | etc.
  webhookName?: string | null;
  firstResponseSeconds?: number | null;
}

function asMetadata(metadata: unknown): HistoryMetadata {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return metadata as HistoryMetadata;
}

function metadataString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return null;
  return String(value);
}

function metadataNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const FORM_ANSWER_VALUE_KEYS = [
  'value',
  'values',
  'raw_value',
  'rawValue',
  'answer',
  'answers',
  'text',
  'selected',
  'selected_value',
  'selectedValue',
  'display_value',
  'displayValue',
];

function answerText(value: unknown): string | null {
  if (Array.isArray(value)) {
    const items = value.map(answerText).filter(Boolean);
    return items.length > 0 ? items.join(', ') : null;
  }
  if (value === null || value === undefined || value === false) return null;
  if (typeof value === 'object') {
    const record = metadataRecord(value);
    if (!record) return null;

    for (const key of FORM_ANSWER_VALUE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
      const nested = answerText(record[key]);
      if (nested) return nested;
    }

    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function normalizeFieldKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isStandardMetaLeadField(question: string) {
  const key = normalizeFieldKey(question);
  if (!key) return true;
  return (
    key === 'nome' ||
    key === 'name' ||
    key === 'full name' ||
    key.includes('email') ||
    key.includes('e mail') ||
    key.includes('telefone') ||
    key.includes('phone') ||
    key.includes('whatsapp') ||
    key.includes('mensagem') ||
    key.includes('message') ||
    key.includes('observacao') ||
    key.includes('cargo') ||
    key.includes('empresa') ||
    key.includes('company') ||
    key.includes('cidade') ||
    key.includes('city') ||
    key.includes('bairro') ||
    key.includes('campaign') ||
    key.includes('campanha') ||
    key.includes('adset') ||
    key.includes('ad set') ||
    key.includes('anuncio') ||
    key.includes('form id') ||
    key.includes('leadgen')
  );
}

function formatMetaQuestion(question: string) {
  const trimmed = question.trim();
  return trimmed.includes('_') || trimmed.includes('-')
    ? trimmed.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    : trimmed;
}

const WEBHOOK_TECHNICAL_FIELDS = new Set([
  'name',
  'nome',
  'full name',
  'email',
  'e mail',
  'phone',
  'telefone',
  'whatsapp',
  'action',
  'form name',
  'formname',
  'form title',
  'form url',
  'source detail',
  'source page',
  'source',
  'source url',
  'shubid',
  'page url',
  'post id',
  'post title',
  'referrer',
  'referer',
  'remote ip',
  'user agent',
  'ip',
  'token',
  'webhook',
  'webhook id',
  'webhook name',
  'payload',
  'raw payload',
  'field data',
  'fielddata',
  'custom fields',
  'customfields',
  'fields',
  'form fields',
  'formfields',
  'form answers',
  'formanswers',
  'posted data',
  'posteddata',
  'raw fields',
  'rawfields',
  'all fields',
  'allfields',
  'entry',
  'entries',
  'data',
  'submitted at',
  'created at',
  'updated at',
  'timestamp',
  'date',
  'time',
  'nonce',
  'wpnonce',
  'wpcf7',
  'wpcf7 version',
  'wpcf7 locale',
  'wpcf7 unit tag',
  'wpcf7 container post',
  'wpcf7 posted data hash',
  'elementor pro forms send form',
  'gclid',
  'fbclid',
  'campaign id',
  'campaignid',
  'campaign name',
  'campaignname',
  'adset id',
  'adsetid',
  'adset name',
  'adsetname',
  'ad id',
  'adid',
  'ad name',
  'adname',
  'form id',
  'formid',
  'leadgen id',
  'leadgenid',
  'enviado em',
]);

const WEBHOOK_FIELD_LABELS: Record<string, string> = {
  estado: 'Estado',
  cidade: 'Cidade',
  tipo_empreendimento: 'Tipo do empreendimento',
  tipo_outro_texto: 'Tipo do empreendimento: outro',
  padrao_empreendimento: 'Padrão do empreendimento',
  vgv_estimado: 'VGV estimado',
  etapa_atual: 'Etapa atual',
  previsao_aprovacao: 'Previsão de aprovação',
  tempo_aprovado: 'Tempo aprovado',
  unidades_comercializadas: 'Unidades comercializadas',
  inicio_aceleracao_vendas: 'Início da aceleração de vendas',
  verba_marketing: 'Verba de marketing',
  faixa_investimento_marketing: 'Faixa de investimento em marketing',
  situacao_verba_nao: 'Situação da verba',
  situacao_verba_outro_texto: 'Situação da verba: outro',
  estruturas: 'Estruturas existentes',
  estrutura_outra_texto: 'Estrutura: outra',
  cargo: 'Cargo',
  participacao_projeto: 'Participação no projeto',
  principal_desafio: 'Principal desafio',
  desafio_outro_texto: 'Desafio: outro',
  mensagem: 'Mensagem',
  message: 'Mensagem',
};

const WEBHOOK_FIELD_CONTAINER_KEYS = new Set([
  'field data',
  'fielddata',
  'custom fields',
  'customfields',
  'fields',
  'form fields',
  'formfields',
  'form answers',
  'formanswers',
  'posted data',
  'posteddata',
  'raw fields',
  'rawfields',
  'all fields',
  'allfields',
  'entry',
  'entries',
  'data',
  'answers',
  'questions',
]);

const FORM_ANSWER_LABEL_KEYS = [
  'label',
  'title',
  'question',
  'field_label',
  'fieldLabel',
  'name',
  'key',
  'id',
  'field_id',
  'fieldId',
];

function formatWebhookQuestion(question: string) {
  const clean = question.trim();
  const mapped = WEBHOOK_FIELD_LABELS[clean] || WEBHOOK_FIELD_LABELS[normalizeFieldKey(clean).replace(/\s+/g, '_')];
  if (mapped) return mapped;
  return formatMetaQuestion(clean).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isWebhookTechnicalField(question: string) {
  const key = normalizeFieldKey(question);
  if (!key) return true;
  if (WEBHOOK_TECHNICAL_FIELDS.has(key)) return true;
  return key.startsWith('utm ') || key.startsWith('utm') || key.endsWith(' id') || key.endsWith('id');
}

function isWebhookFieldContainer(question: string) {
  return WEBHOOK_FIELD_CONTAINER_KEYS.has(normalizeFieldKey(question));
}

function recordValueByKeys(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function fieldQuestion(record: Record<string, unknown>, fallback?: string) {
  const value = recordValueByKeys(record, FORM_ANSWER_LABEL_KEYS);
  const text = answerText(value);
  return text || fallback || null;
}

function hasFieldAnswerShape(record: Record<string, unknown>) {
  return FORM_ANSWER_VALUE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function extractMetaFormAnswers(metadata: HistoryMetadata) {
  const answers: Array<{ question: string; answer: string }> = [];
  const seen = new Set<string>();

  const pushAnswer = (question: string, value: unknown, skipStandard: boolean) => {
    const cleanQuestion = formatMetaQuestion(question);
    if (!cleanQuestion || (skipStandard && isStandardMetaLeadField(cleanQuestion))) return;
    const answer = answerText(value);
    if (!answer) return;
    const key = `${normalizeFieldKey(cleanQuestion)}:${answer}`;
    if (seen.has(key)) return;
    seen.add(key);
    answers.push({ question: cleanQuestion, answer });
  };

  const rawMetadata = metadata as Record<string, unknown>;
  const customFields = metadataRecord(rawMetadata.custom_fields);
  if (customFields) {
    Object.entries(customFields).forEach(([question, value]) => pushAnswer(question, value, false));
  }

  const fieldData = metadataRecord(rawMetadata.field_data);
  if (fieldData) {
    Object.entries(fieldData).forEach(([question, value]) => pushAnswer(question, value, true));
  }

  return answers;
}

function extractWebhookFormAnswers(source: Record<string, unknown> | null | undefined) {
  const answers: Array<{ question: string; answer: string }> = [];
  const seen = new Set<string>();

  const pushAnswer = (question: string, value: unknown) => {
    if (isWebhookTechnicalField(question)) return;
    const cleanQuestion = formatWebhookQuestion(question);
    if (!cleanQuestion) return;
    const answer = answerText(value);
    if (!answer) return;
    const key = `${normalizeFieldKey(cleanQuestion)}:${answer}`;
    if (seen.has(key)) return;
    seen.add(key);
    answers.push({ question: cleanQuestion, answer });
  };

  const visitFieldContainer = (value: unknown, fallbackQuestion?: string, depth = 0) => {
    if (depth > 5 || value === null || value === undefined) return;

    if (Array.isArray(value)) {
      value.forEach((item) => visitFieldContainer(item, fallbackQuestion, depth + 1));
      return;
    }

    const record = metadataRecord(value);
    if (!record) {
      if (fallbackQuestion) pushAnswer(fallbackQuestion, value);
      return;
    }

    if (hasFieldAnswerShape(record)) {
      const question = fieldQuestion(record, fallbackQuestion);
      const answerValue = recordValueByKeys(record, FORM_ANSWER_VALUE_KEYS);
      if (question) pushAnswer(question, answerValue);
      return;
    }

    Object.entries(record).forEach(([question, nestedValue]) => {
      const nestedRecord = metadataRecord(nestedValue);

      if (nestedRecord && hasFieldAnswerShape(nestedRecord)) {
        const nestedQuestion = fieldQuestion(nestedRecord, question);
        const nestedAnswer = recordValueByKeys(nestedRecord, FORM_ANSWER_VALUE_KEYS);
        if (nestedQuestion) pushAnswer(nestedQuestion, nestedAnswer);
        return;
      }

      if (isWebhookFieldContainer(question) || Array.isArray(nestedValue) || nestedRecord) {
        visitFieldContainer(nestedValue, question, depth + 1);
        return;
      }

      pushAnswer(question, nestedValue);
    });
  };

  const payload = metadataRecord(source?.payload) || metadataRecord(source?.raw_payload) || source;
  if (!payload) return answers;

  Object.entries(payload).forEach(([question, value]) => {
    if (isWebhookFieldContainer(question)) {
      visitFieldContainer(value, question);
      return;
    }
    pushAnswer(question, value);
  });

  return answers;
}

type MetaCreativeHistory = {
  name: string | null;
  adName: string | null;
  campaignName: string | null;
  adsetName: string | null;
  formName: string | null;
  type: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  linkUrl: string | null;
  instagramUrl: string | null;
  destinationUrl: string | null;
};

function firstURL(...values: unknown[]) {
  for (const value of values) {
    const text = answerText(value);
    if (!text || !/^https?:\/\//i.test(text)) continue;
    return text;
  }
  return null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = answerText(value);
    if (text) return text;
  }
  return null;
}

function rawLeadDetails(source: Record<string, unknown>) {
  const rawPayload = metadataRecord(source.raw_payload);
  return metadataRecord(rawPayload?.lead_details) || metadataRecord(source.lead_details) || rawPayload || source;
}

function extractMetaCreative(source: Record<string, unknown> | null | undefined): MetaCreativeHistory | null {
  if (!source) return null;
  const details = rawLeadDetails(source);
  const creative = metadataRecord(details.creative);

  const imageUrl = firstURL(
    source.creative_url,
    source.creative_thumbnail_url,
    details.creative_url,
    details.creative_thumbnail_url,
    creative?.thumbnail_url,
    creative?.image_url,
  );
  const videoUrl = firstURL(source.creative_video_url, details.creative_video_url);
  const instagramUrl = firstURL(source.creative_instagram_url, details.creative_instagram_url);
  const linkUrl = firstURL(
    source.creative_permalink_url,
    details.creative_permalink_url,
    instagramUrl,
    source.creative_url,
    details.creative_url,
  );
  const destinationUrl = firstURL(source.creative_destination_url, details.creative_destination_url);
  const name = firstText(source.creative_name, details.creative_name, creative?.name);
  const adName = firstText(source.ad_name, details.ad_name);
  const campaignName = firstText(source.campaign_name, details.campaign_name);
  const adsetName = firstText(source.adset_name, details.adset_name);
  const formName = firstText(source.form_name, details.form_name);
  const type = firstText(source.creative_type, details.creative_type);

  const hasCreativeSignal = Boolean(
    imageUrl ||
      videoUrl ||
      linkUrl ||
      instagramUrl ||
      destinationUrl ||
      name ||
      adName ||
      campaignName ||
      adsetName ||
      formName ||
      type,
  );

  if (!hasCreativeSignal) {
    return null;
  }

  return {
    name,
    adName,
    campaignName,
    adsetName,
    formName,
    type,
    imageUrl,
    videoUrl,
    linkUrl,
    instagramUrl,
    destinationUrl,
  };
}

function sourceLabel(source?: string | null): string | null {
  if (!source) return null;
  const labels: Record<string, string> = {
    meta: 'Meta Ads',
    meta_ads: 'Meta Ads',
    whatsapp: 'WhatsApp',
    webhook: 'Webhook',
    website: 'Site',
    site: 'Site',
    wordpress: 'WordPress',
    manual: 'Manual',
    indicacao: 'Indicação',
    portais: 'Portais',
    facebook: 'Facebook',
    instagram: 'Instagram',
    google: 'Google',
    google_ads: 'Google Ads',
    import: 'Importação',
    outros: 'Outros',
    outro: 'Outro',
  };
  return labels[source] || source;
}

// Types that only exist in activities (never in timeline) - no deduplication needed
const ACTIVITY_ONLY_TYPES = new Set([
  'call',
  'email',
  'note',
  'message',
  'meta_form_answer',
  'webhook_form_answer',
  'meta_creative',
  'task_completed',
  'contact_updated',
  'automation_message',
  'commission_created',
  'commission_updated',
  'property_selected',
  'property_linked',
  'document_attached',
  'attachment_created',
  'proposal_sent',
  'agenda_created',
  'agenda_rescheduled',
  'agenda_completed',
  'agenda_cancelled',
  'visit_scheduled',
  'visit_made',
  'visit_confirmed',
  'meeting_scheduled',
  'meeting_made',
  'meeting_held',
]);

// Types where timeline is authoritative - skip activity duplicate
const TIMELINE_AUTHORITY_TYPES = new Set([
  'lead_created',
  'lead_assigned',
  'assignee_changed', // deduplica com lead_assigned da timeline
  'stage_changed',
  'stage_change',
  'first_response',
  'whatsapp_message_sent',
  'whatsapp_message_received',
  'call_initiated',
  'note_created',
  'tag_added',
  'tag_removed',
  'sla_warning',
  'sla_overdue',
  'lead_reentry',
]);

function buildLabel(type: string, metadata: HistoryMetadata): string {
  switch (type) {
    case 'lead_created': {
      const src = metadata?.source_label || metadata?.source;
      if (!src) return 'Lead criado';
      if (src === 'meta_ads' || src === 'Meta Ads') return 'Lead criado via Meta Ads';
      if (src === 'whatsapp' || src === 'WhatsApp') return 'Lead criado via WhatsApp';
      if (src === 'webhook' || src === 'Webhook' || src === 'generic_webhook') {
        const name = metadata?.form_name || metadata?.webhook_name;
        return name ? `Lead criado via "${name}"` : 'Lead criado via Webhook';
      }
      if (src === 'website' || src === 'Site') return 'Lead criado via Site';
      if (src === 'manual') return 'Lead criado manualmente';
      return `Lead criado via ${src}`;
    }
    case 'lead_assigned': {
      const queueName = metadata?.distribution_queue_name || metadata?.queue_name;
      const assignedName = metadata?.assigned_user_name;
      if (queueName && assignedName) return `Distribuído via "${queueName}" → ${assignedName}`;
      if (queueName) return `Distribuído via "${queueName}"`;
      if (metadata?.destination === 'admin_fallback') return 'Atribuído ao administrador (sem fila ativa)';
      if (metadata?.destination === 'pool') return 'Enviado para o Pool';
      if (assignedName) return `Atribuído a ${assignedName}`;
      return 'Distribuído';
    }
    case 'stage_changed':
    case 'stage_change': {
      const from = metadata?.old_stage_name || metadata?.from_stage;
      const to = metadata?.new_stage_name || metadata?.to_stage;
      if (!from || from === 'Desconhecido' || from === 'Unknown') {
        return `Iniciado no estágio ${to || 'Base'}`;
      }
      if (from && to) return `Movido: ${from} → ${to}`;
      return 'Estágio alterado';
    }
    case 'first_response':
      return 'Primeiro contato';
    case 'whatsapp_message_sent':
      return 'Mensagem enviada (WhatsApp)';
    case 'whatsapp_message_received':
      return 'Mensagem recebida (WhatsApp)';
    case 'call_initiated':
      return 'Ligação iniciada';
    case 'note_created':
    case 'note':
      return 'Nota adicionada';
    case 'tag_added':
      return metadata?.tag_name ? `Tag "${metadata.tag_name}" adicionada` : 'Tag adicionada';
    case 'tag_removed':
      return metadata?.tag_name ? `Tag "${metadata.tag_name}" removida` : 'Tag removida';
    case 'sla_warning':
      return 'SLA em alerta';
    case 'sla_overdue':
      return 'SLA estourado';
    case 'call':
      return 'Ligação realizada';
    case 'email':
      return 'Email enviado';
    case 'message':
      return 'Mensagem enviada';
    case 'property_selected':
    case 'property_linked': {
      const code = metadataString(metadata?.property_code) || metadataString(metadata?.property_ref);
      const title = metadataString(metadata?.property_title) || metadataString(metadata?.property_name);
      if (code && title) return `Imovel selecionado: ${code} - ${title}`;
      if (code || title) return `Imovel selecionado: ${code || title}`;
      return 'Imovel selecionado';
    }
    case 'document_attached':
    case 'attachment_created': {
      const fileName =
        metadataString(metadata?.file_name) ||
        metadataString(metadata?.fileName) ||
        metadataString(metadata?.filename) ||
        metadataString(metadata?.attachment_name);
      return fileName ? `Documento anexado: ${fileName}` : 'Documento anexado';
    }
    case 'meta_form_answer': {
      const question = metadataString(metadata?.question);
      return question ? `Meta: ${question}` : 'Resposta do formulário Meta';
    }
    case 'webhook_form_answer': {
      const question = metadataString(metadata?.question);
      return question ? `Webhook: ${question}` : 'Resposta do formulário';
    }
    case 'meta_creative':
      return 'Criativo Meta';
    case 'automation_message': {
      const ch = metadata?.channel || 'whatsapp';
      return `Mensagem automática (${ch === 'whatsapp' ? 'WhatsApp' : ch})`;
    }
    case 'task_completed':
      return 'Tarefa concluída';
    case 'contact_updated':
      return 'Contato atualizado';
    case 'assignee_changed': {
      if (metadata?.distribution_queue_name && metadata?.to_user_name) {
        const prefix = metadata?.is_initial_distribution === false ? 'Redistribuído' : 'Distribuído';
        return `${prefix} por "${metadata.distribution_queue_name}" → ${metadata.to_user_name}`;
      }
      const actorName = metadataString(metadata?.transferred_by_name);
      const targetName = metadataString(metadata?.to_user_name);
      if (!metadata?.to_user_id && !targetName) {
        return actorName ? `Responsável removido por ${actorName}` : 'Responsável removido';
      }
      if (actorName && targetName) return `Lead transferido por ${actorName} para ${targetName}`;
      if (targetName) return `Lead transferido para ${targetName}`;
      return 'Responsável alterado';
    }
    case 'lead_reentry': {
      if (metadata?.entry_type === 'manual_reentry') return 'Lead reentrou';
      if (metadata?.webhook_name) return `Lead reentrou via webhook "${metadata.webhook_name}"`;
      if (metadata?.source === 'whatsapp') return 'Lead reentrou via WhatsApp';
      return `Lead reentrou via ${metadata?.source || 'sistema'}`;
    }
    case 'status_change': {
      const from =
        metadataString(metadata?.from_status) ||
        metadataString(metadata?.previous_status) ||
        metadataString(metadata?.old_status);
      const to = metadataString(metadata?.to_status);
      const statusMap: Record<string, string> = { open: 'Aberto', won: 'Ganho', lost: 'Perdido' };
      if (from && to) return `Status: ${statusMap[from] || from} → ${statusMap[to] || to}`;
      return 'Status alterado';
    }
    case 'commission_created':
      return 'Comissão registrada';
    case 'commission_updated':
      return 'Comissão atualizada';
    case 'lead_updated':
      return 'Lead editado';
    case 'lead_deleted':
      return 'Lead excluido';
    case 'lead_auto_redistributed':
      return 'Redistribuicao automatica';
    case 'sale_closed':
      return 'Venda concluida';
    case 'property_interest_reserved':
      return 'Imovel reservado';
    case 'whatsapp':
      return 'Mensagem WhatsApp';
    case 'assignment':
      return metadata?.to_user_name ? `Atribuído a ${metadata.to_user_name}` : 'Lead atribuído';
    case 'automation_stage_move':
      return 'Movido por automação';
    case 'automation_tag_added':
      return 'Tag adicionada por automação';
    case 'proposal_sent':
      return 'Proposta registrada';
    case 'agenda_created':
      return 'Atividade agendada';
    case 'agenda_rescheduled':
      return 'Atividade remarcada';
    case 'agenda_completed':
      return 'Atividade concluida';
    case 'agenda_cancelled':
      return 'Atividade cancelada';
    case 'visit_scheduled':
      return 'Visita agendada';
    case 'visit_made':
    case 'visit_confirmed':
      return 'Visita realizada';
    case 'meeting_scheduled':
      return 'Reunião agendada';
    case 'meeting_made':
    case 'meeting_held':
      return 'Reunião realizada';
    default: {
      if (metadata?.is_automation) return `Ação automática (${type})`;
      const translations: Record<string, string> = {
        'call_made': 'Ligação realizada',
        'message_sent': 'Mensagem enviada',
        'contact_made': 'Contato realizado',
        'prospecting_report': 'Relatório de prospecção',
        'agenda_created': 'Atividade agendada',
        'agenda_rescheduled': 'Atividade remarcada',
        'agenda_completed': 'Atividade concluída',
        'agenda_cancelled': 'Atividade cancelada'
      };
      return translations[type] || type.replace(/_/g, ' ');
    }
  }
}

function buildContent(type: string, metadata: HistoryMetadata): string | undefined {
  switch (type) {
    case 'first_response': {
      const secs = metadata?.response_seconds;
      if (secs !== undefined && secs !== null) {
        return `Primeiro contato: ${formatResponseTime(Number(secs))}`;
      }
      return undefined;
    }
    case 'stage_changed':
    case 'stage_change': {
      const from = metadataString(metadata?.old_stage_name) || metadataString(metadata?.from_stage);
      const to = metadataString(metadata?.new_stage_name) || metadataString(metadata?.to_stage);
      const isInitial = !from || from === 'Desconhecido' || from === 'Unknown';
      if (!isInitial && from && to) return `${from} → ${to}`;
      return undefined;
    }
    case 'property_selected':
    case 'property_linked': {
      const details = [
        metadataString(metadata?.property_title) || metadataString(metadata?.property_name),
        metadataString(metadata?.property_code) || metadataString(metadata?.property_ref),
      ].filter(Boolean);
      const price = metadataNumber(metadata?.property_price);
      if (price) details.push(`R$ ${price.toLocaleString('pt-BR')}`);
      return details.join(' | ') || undefined;
    }
    case 'document_attached':
    case 'attachment_created':
      return metadataString(metadata?.file_name) || metadataString(metadata?.attachment_name) || undefined;
    case 'agenda_created':
    case 'agenda_rescheduled':
    case 'agenda_completed':
    case 'agenda_cancelled':
    case 'visit_scheduled':
    case 'visit_confirmed':
    case 'meeting_scheduled':
    case 'meeting_held': {
      const title = metadataString(metadata?.title) || metadataString(metadata?.event_title);
      const startsAt =
        metadataString(metadata?.starts_at) ||
        metadataString(metadata?.start_at) ||
        metadataString(metadata?.start_time) ||
        metadataString(metadata?.scheduled_at);
      return [title, startsAt].filter(Boolean).join(' | ') || undefined;
    }
    default:
      return undefined;
  }
}

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

function auditVisibleKeys(audit: AuditLogRow, activityEvents: ActivityEventRow[]) {
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

function auditEventType(action: string, keys: string[]) {
  if (action === 'delete') return 'lead_deleted';
  if (action === 'create') return 'lead_created';
  if (action === 'move_stage' || keys.some((key) => key === 'stage_id' || key === 'pipeline_id')) {
    return 'stage_change';
  }
  if (keys.includes('assigned_user_id')) return 'assignee_changed';
  if (keys.includes('deal_status')) return 'status_change';
  return 'lead_updated';
}

function auditDisplayValue(value: unknown, key?: string) {
  if (value === null || value === undefined || value === '') return '';
  if (key === 'source') return sourceLabel(String(value));
  if (key === 'valor_interesse') {
    const amount = Number(value);
    if (Number.isFinite(amount)) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount);
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

function auditContent(action: string, keys: string[], oldData: HistoryMetadata, newData: HistoryMetadata) {
  if (action === 'delete') return 'Lead removido do CRM';
  if (keys.length === 0) return undefined;
  return keys.map((key) => {
    const label = auditFieldLabel(key);
    const oldValue = auditDisplayValue(oldData[key], key);
    const newValue = auditDisplayValue(newData[key], key);
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

export function useLeadHistory(leadId: string | null) {

  return useQuery({
    queryKey: ['lead-history-v2', leadId],
    queryFn: async (): Promise<UnifiedHistoryEvent[]> => {
      if (!leadId) return [];

      const raw = await leadsAPI.getLeadHistoryRaw<LeadHistoryRaw>(leadId);
      const timelineEvents = raw.timelineEvents || [];
      const activityEvents = raw.activityEvents || [];
      const entryEvents = raw.entryEvents || [];
      const lead = raw.lead || null;
      const leadMeta = raw.leadMeta || null;
      const distributionLogs = raw.distributionLogs || [];
      const assignmentLogs = raw.assignmentLogs || [];
      const auditLogs = raw.auditLogs || [];

      // Collect all user IDs that need resolution from metadata
      const userIdsToResolve = new Set<string>();
      [...timelineEvents, ...activityEvents].forEach((event) => {
        const meta = asMetadata(event.metadata);
        const userId = metadataString(meta.user_id);
        const toUserId = metadataString(meta.to_user_id);
        const fromUserId = metadataString(meta.from_user_id);
        if (userId) userIdsToResolve.add(userId);
        if (toUserId) userIdsToResolve.add(toUserId);
        if (fromUserId) userIdsToResolve.add(fromUserId);
        if (event.user_id) userIdsToResolve.add(event.user_id);
        if ('actor_user_id' in event && event.actor_user_id) userIdsToResolve.add(event.actor_user_id);
      });
      distributionLogs.forEach((log) => {
        if (log.assigned_user_id && typeof log.assigned_user_id === 'string') userIdsToResolve.add(log.assigned_user_id);
      });
      assignmentLogs.forEach((log) => {
        if (log.old_user_id) userIdsToResolve.add(log.old_user_id);
        if (log.new_user_id) userIdsToResolve.add(log.new_user_id);
        if (log.created_by) userIdsToResolve.add(log.created_by);
      });
      auditLogs.forEach((log) => {
        if (log.user_id) userIdsToResolve.add(log.user_id);
      });
      if (lead?.assigned_user_id) userIdsToResolve.add(lead.assigned_user_id);

      // Resolve users
      const userMap = new Map<string, HistoryActor>();
      if (userIdsToResolve.size > 0) {
        (raw.users || []).forEach((user) => {
          if (!userIdsToResolve.has(user.id)) return;
          userMap.set(user.id, {
            id: user.id,
            name: user.name || 'Usuário',
            avatar_url: user.avatar_url || null,
          });
        });
      }

      // -- Deduplication fingerprint for activities (handles backend double-writes) --
      function getActivityFingerprint(activity: ActivityEventRow): string {
        const meta = asMetadata(activity.metadata);
        const ts = Math.floor(new Date(activity.created_at).getTime() / 2000); // 2-second window
        if (activity.type === 'stage_change' || activity.type === 'stage_changed') {
          const from = metadataString(meta.from_stage_id) || metadataString(meta.old_stage_id) || metadataString(meta.from_stage) || metadataString(meta.old_stage_name) || '';
          const to = metadataString(meta.to_stage_id) || metadataString(meta.new_stage_id) || metadataString(meta.to_stage) || metadataString(meta.new_stage_name) || '';
          return `${activity.type}-${from}->${to}-${ts}`;
        }
        const detail = [
          metadataString(meta.to_stage),
          metadataString(meta.to_user_id),
          metadataString(meta.new_stage_name),
          metadataString(meta.tag_name),
          metadataString(meta.property_id),
          metadataString(meta.property_code),
          metadataString(meta.file_name) || metadataString(meta.fileName) || metadataString(meta.filename) || metadataString(meta.attachment_name),
          metadataString(meta.outcome),
          metadataString(meta.kind),
          metadataString(meta.question),
          metadataString(meta.answer),
          activity.content,
        ].filter(Boolean).join('|');
        return `${activity.type}-${detail}-${ts}`;
      }

      function getActivityDetailScore(activity: ActivityEventRow): number {
        const meta = asMetadata(activity.metadata);
        let score = 0;
        if (metadataString(meta.from_stage) || metadataString(meta.old_stage_name)) score += 3;
        if (metadataString(meta.to_stage) || metadataString(meta.new_stage_name)) score += 3;
        if (metadataString(meta.property_id) || metadataString(meta.property_title)) score += 3;
        if (metadataString(meta.file_url) || metadataString(meta.file_name)) score += 3;
        if (metadataString(meta.outcome) || metadataString(meta.notes)) score += 2;
        if (/movido de\s+"/i.test(activity.content || '')) score += 2;
        if (activity.content) score += 1;
        if (activity.user_id || metadataString(meta.actor_id)) score += 1;
        return score;
      }

      const dedupedActivityMap = new Map<string, ActivityEventRow>();
      activityEvents.forEach((activity) => {
        const fp = getActivityFingerprint(activity);
        const existing = dedupedActivityMap.get(fp);
        if (!existing || getActivityDetailScore(activity) > getActivityDetailScore(existing)) {
          dedupedActivityMap.set(fp, activity);
        }
      });
      const dedupedActivityEvents = Array.from(dedupedActivityMap.values()).sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      // Build unified events from timeline
      const timelineMapped: UnifiedHistoryEvent[] = timelineEvents.map((event) => {
        const meta = asMetadata(event.metadata);
        const actorId = event.user_id || event.actor_user_id;
        const actor = actorId ? (userMap.get(actorId) || null) : null;
        const responseSeconds = metadataNumber(meta.response_seconds);

        return {
          id: `timeline-${event.id}`,
          type: event.event_type,
          label: buildLabel(event.event_type, meta),
          content: buildContent(event.event_type, meta),
          timestamp: event.created_at || event.event_at || new Date().toISOString(),
          actor: actor ? { id: actor.id, name: actor.name, avatar_url: actor.avatar_url } : null,
          source: 'timeline' as const,
          metadata: meta,
          channel: event.channel || metadataString(meta.channel),
          isAutomation: event.is_automation || false,
          sourceOrigin: metadataString(meta.source) || metadataString(meta.source_label),
          webhookName: metadataString(meta.webhook_name) || metadataString(meta.form_name),
          firstResponseSeconds: event.event_type === 'first_response' ? responseSeconds : null,
        };
      });

      // Track which timeline types exist for deduplication
      const timelineTypesPresent = new Set(timelineEvents.map((event) => event.event_type));
      const activityTypesPresent = new Set(dedupedActivityEvents.map((activity) => activity.type));

      // Enrich timeline lead_created with webhook_name from activity if missing
      const activityLeadCreated = dedupedActivityEvents.find((activity) => activity.type === 'lead_created');
      timelineMapped.forEach((event) => {
        if (event.type === 'lead_created' && !event.webhookName && activityLeadCreated) {
          const actMeta = asMetadata(activityLeadCreated.metadata);
          const wn = metadataString(actMeta.webhook_name) || metadataString(actMeta.form_name);
          if (wn) {
            event.webhookName = wn;
            // Re-build label with enriched metadata
            event.label = buildLabel('lead_created', { ...asMetadata(event.metadata), webhook_name: wn });
          }
        }
      });

      // Build unified events from activities (with deduplication)
      const activityMapped: UnifiedHistoryEvent[] = dedupedActivityEvents
        .filter((activity) => {
          // Always include activity-only types
          if (ACTIVITY_ONLY_TYPES.has(activity.type)) return true;
          if (activity.type === 'lead_reentry' && asMetadata(activity.metadata).entry_type === 'manual_reentry') return true;
          // Skip if timeline already has authority over this type
          if (TIMELINE_AUTHORITY_TYPES.has(activity.type) && timelineTypesPresent.has(activity.type)) return false;
          // Also map stage_change → stage_changed
          if (activity.type === 'stage_change' && timelineTypesPresent.has('stage_changed')) return false;
          return true;
        })
        .map((activity) => {
          const meta = asMetadata(activity.metadata);
          const actorId = activity.user_id;
          const actorFromQuery = activity.user;
          const actor = actorFromQuery || (actorId ? userMap.get(actorId) || null : null);

          return {
            id: `activity-${activity.id}`,
            type: activity.type,
            label: buildLabel(activity.type, meta),
            content: activity.content || buildContent(activity.type, meta),
            timestamp: activity.created_at,
            actor: actor ? { id: actor.id, name: actor.name, avatar_url: actor.avatar_url || undefined } : null,
            source: 'activity' as const,
            metadata: meta,
            channel: metadataString(meta.channel),
            isAutomation: Boolean(meta.is_automation) || activity.type.startsWith('automation_'),
          };
        });

      const metaFormAnswerMapped: UnifiedHistoryEvent[] = dedupedActivityEvents.flatMap((activity) => {
        if (activity.type !== 'lead_created' && activity.type !== 'lead_reentry') return [];
        const meta = asMetadata(activity.metadata);
        const source = metadataString(meta.source);
        const sourceType = metadataString(meta.source_type);
        if (source !== 'meta' && sourceType !== 'meta_lead_ads') return [];

        const baseTime = new Date(activity.created_at).getTime();
        return extractMetaFormAnswers(meta).map((answer, index) => {
          const timestamp = Number.isFinite(baseTime)
            ? new Date(baseTime + index + 1).toISOString()
            : activity.created_at;
          const answerMetadata: HistoryMetadata = {
            source: 'meta',
            source_type: 'meta_lead_ads',
            question: answer.question,
            answer: answer.answer,
            form_name: metadataString(meta.form_name),
            form_id: metadataString(meta.form_id),
            leadgen_id: metadataString(meta.leadgen_id),
          };

          return {
            id: `meta-answer-${activity.id}-${index}`,
            type: 'meta_form_answer',
            label: buildLabel('meta_form_answer', answerMetadata),
            content: answer.answer,
            timestamp,
            actor: null,
            source: 'activity' as const,
            metadata: answerMetadata,
            channel: 'meta',
            isAutomation: false,
            sourceOrigin: 'meta',
          };
        });
      });

      const webhookFormAnswerMappedFromActivities: UnifiedHistoryEvent[] = dedupedActivityEvents.flatMap((activity) => {
        if (activity.type !== 'lead_created' && activity.type !== 'lead_reentry') return [];
        const meta = asMetadata(activity.metadata);
        const source = metadataString(meta.source);
        const sourceType = metadataString(meta.source_type);
        const payload = metadataRecord(meta.payload);
        const isWebhook = source === 'generic_webhook' || source === 'webhook' || sourceType === 'generic_webhook' || !!payload;
        if (!isWebhook) return [];

        const baseTime = new Date(activity.created_at).getTime();
        return extractWebhookFormAnswers(meta).map((answer, index) => {
          const timestamp = Number.isFinite(baseTime)
            ? new Date(baseTime + index + 1).toISOString()
            : activity.created_at;
          const answerMetadata: HistoryMetadata = {
            source: 'webhook',
            source_type: 'generic_webhook',
            question: answer.question,
            answer: answer.answer,
            webhook_name: metadataString(meta.webhook_name),
            webhook_id: metadataString(meta.webhook_id),
            form_name: metadataString(meta.form_name) || metadataString(meta.webhook_name),
          };

          return {
            id: `webhook-answer-${activity.id}-${index}`,
            type: 'webhook_form_answer',
            label: buildLabel('webhook_form_answer', answerMetadata),
            content: answer.answer,
            timestamp,
            actor: null,
            source: 'activity' as const,
            metadata: answerMetadata,
            channel: 'webhook',
            isAutomation: false,
            sourceOrigin: 'webhook',
          };
        });
      });

      const webhookFormAnswerMappedFromLeadMeta: UnifiedHistoryEvent[] = (() => {
        if (webhookFormAnswerMappedFromActivities.length > 0) return [];
        const rawPayload = metadataRecord(leadMeta?.raw_payload);
        const isWebhook = lead?.source === 'webhook' || leadMeta?.platform === 'webhook' || leadMeta?.source_type === 'generic_webhook';
        if (!isWebhook || !rawPayload) return [];

        const createdAt = leadMeta?.created_at || lead?.created_at || new Date().toISOString();
        const baseTime = new Date(createdAt).getTime();
        return extractWebhookFormAnswers({ raw_payload: rawPayload }).map((answer, index) => {
          const timestamp = Number.isFinite(baseTime) ? new Date(baseTime + index + 1).toISOString() : createdAt;
          const metadata: HistoryMetadata = {
            source: 'webhook',
            source_type: 'generic_webhook',
            question: answer.question,
            answer: answer.answer,
            form_name: leadMeta?.form_name || null,
            form_id: leadMeta?.form_id || null,
          };

          return {
            id: `webhook-answer-lead-meta-${leadMeta?.id || lead?.id || leadId}-${index}`,
            type: 'webhook_form_answer',
            label: buildLabel('webhook_form_answer', metadata),
            content: answer.answer,
            timestamp,
            actor: null,
            source: 'activity' as const,
            metadata,
            channel: 'webhook',
            isAutomation: false,
            sourceOrigin: 'webhook',
          };
        });
      })();

      const metaCreativeMappedFromActivities: UnifiedHistoryEvent[] = dedupedActivityEvents.flatMap((activity) => {
        if (activity.type !== 'lead_created' && activity.type !== 'lead_reentry') return [];
        const meta = asMetadata(activity.metadata);
        const source = metadataString(meta.source);
        const sourceType = metadataString(meta.source_type);
        if (source !== 'meta' && sourceType !== 'meta_lead_ads') return [];

        const creative = extractMetaCreative(meta as Record<string, unknown>);
        if (!creative) return [];

        const baseTime = new Date(activity.created_at).getTime();
        const timestamp = Number.isFinite(baseTime)
          ? new Date(baseTime + 1).toISOString()
          : activity.created_at;
        const creativeMetadata: HistoryMetadata = {
          source: 'meta',
          source_type: 'meta_lead_ads',
          creative_name: creative.name,
          ad_name: creative.adName,
          campaign_name: creative.campaignName || metadataString(meta.campaign_name),
          adset_name: creative.adsetName || metadataString(meta.adset_name),
          creative_type: creative.type,
          creative_url: creative.imageUrl,
          creative_video_url: creative.videoUrl,
          creative_link_url: creative.linkUrl,
          creative_instagram_url: creative.instagramUrl,
          creative_destination_url: creative.destinationUrl,
          form_name: creative.formName || metadataString(meta.form_name),
          form_id: metadataString(meta.form_id),
          leadgen_id: metadataString(meta.leadgen_id),
        };

        return [{
          id: `meta-creative-${activity.id}`,
          type: 'meta_creative',
          label: buildLabel('meta_creative', creativeMetadata),
          content: creative.name || creative.adName || creative.campaignName || creative.adsetName || creative.formName || 'Criativo do anuncio',
          timestamp,
          actor: null,
          source: 'activity' as const,
          metadata: creativeMetadata,
          channel: 'meta',
          isAutomation: false,
          sourceOrigin: 'meta',
        }];
      });

      const metaCreativeMappedFromLeadMeta: UnifiedHistoryEvent[] = (() => {
        if (metaCreativeMappedFromActivities.length > 0) return [];
        const creative = extractMetaCreative(leadMeta as Record<string, unknown> | null);
        if (!creative) return [];

        const createdAt = leadMeta?.created_at || lead?.created_at || new Date().toISOString();
        const baseTime = new Date(createdAt).getTime();
        const timestamp = Number.isFinite(baseTime) ? new Date(baseTime + 1).toISOString() : createdAt;
        const metadata: HistoryMetadata = {
          source: 'meta',
          source_type: 'meta_lead_ads',
          creative_name: creative.name,
          ad_name: creative.adName,
          campaign_name: creative.campaignName || leadMeta?.campaign_name || null,
          adset_name: creative.adsetName || leadMeta?.adset_name || null,
          creative_type: creative.type,
          creative_url: creative.imageUrl,
          creative_video_url: creative.videoUrl,
          creative_link_url: creative.linkUrl,
          creative_instagram_url: creative.instagramUrl,
          creative_destination_url: creative.destinationUrl,
          form_name: creative.formName || leadMeta?.form_name || null,
          form_id: leadMeta?.form_id || null,
        };

        return [{
          id: `meta-creative-lead-meta-${leadMeta?.id || lead?.id || leadId}`,
          type: 'meta_creative',
          label: buildLabel('meta_creative', metadata),
          content: creative.name || creative.adName || creative.campaignName || creative.adsetName || creative.formName || 'Criativo do anuncio',
          timestamp,
          actor: null,
          source: 'activity' as const,
          metadata,
          channel: 'meta',
          isAutomation: false,
          sourceOrigin: 'meta',
        }];
      })();

      // Build entry events mapped to unified format
      const entriesMapped: UnifiedHistoryEvent[] = entryEvents
        .filter((entry) => entry.entry_type !== 'initial') // Remove redundancy with "Lead criado"
        .map((entry, index) => ({
          id: `entry-${entry.id}`,
          type: 'lead_reentry',
          label: `${index + 2}ª Entrada`, // First re-entry is the 2nd entry
          content: `Origem: ${entry.source}${entry.campaign_name ? ` | Campanha: ${entry.campaign_name}` : ''}`,
          timestamp: entry.created_at,
          actor: null,
          source: 'timeline' as const,
          metadata: { ...entry },
          channel: entry.source,
          isAutomation: false,
        }));

      const distributionMapped: UnifiedHistoryEvent[] = distributionLogs
        .filter((log) => {
          if (!log.round_robin_id && !log.assigned_user_id && !log.reason) return false;
          const hasTimelineQueue = timelineEvents.some((event) => {
            const meta = asMetadata(event.metadata);
            return event.event_type === 'lead_assigned'
              && (meta.distribution_queue_id === log.round_robin_id || meta.queue_id === log.round_robin_id);
          });
          return !hasTimelineQueue;
        })
        .map((log) => {
          const queueName = log.queue?.name || null;
          const assignedUser = log.assigned_user || (log.assigned_user_id ? userMap.get(log.assigned_user_id) : null);
          const assignedName = assignedUser?.name || null;
          const success = !!log.assigned_user_id;
          const reason = log.reason || null;
          const metadata: HistoryMetadata = {
            queue_id: log.round_robin_id,
            distribution_queue_id: log.round_robin_id,
            queue_name: queueName,
            distribution_queue_name: queueName,
            assigned_user_id: log.assigned_user_id,
            assigned_user_name: assignedName,
            to_user_id: log.assigned_user_id,
            to_user_name: assignedName,
            reason,
            is_initial_distribution: true,
          };

          return {
            id: `distribution-${log.id}`,
            type: 'lead_assigned',
            label: success
              ? buildLabel('lead_assigned', metadata)
              : queueName
                ? `Fila "${queueName}" sem distribuição`
                : 'Sem fila de distribuição compatível',
            content: success ? undefined : reason || undefined,
            timestamp: log.created_at,
            actor: assignedUser ? { id: assignedUser.id, name: assignedUser.name, avatar_url: assignedUser.avatar_url || null } : null,
            source: 'timeline' as const,
            metadata,
            channel: null,
            isAutomation: true,
          };
        });

      const assignmentMapped: UnifiedHistoryEvent[] = assignmentLogs
        .filter((log) => {
          return !distributionMapped.some((event) => {
            const meta = asMetadata(event.metadata);
            const sameUser = metadataString(meta.to_user_id) === log.new_user_id;
            const sameReason = metadataString(meta.reason) === log.reason || metadataString(meta.queue_id) === metadataString(log.reason);
            const distance = Math.abs(new Date(event.timestamp).getTime() - new Date(log.created_at).getTime());
            return sameUser && (sameReason || distance < 5000);
          });
        })
        .map((log) => {
          const oldUser = log.old_user || (log.old_user_id ? userMap.get(log.old_user_id) : null);
          const newUser = log.new_user || (log.new_user_id ? userMap.get(log.new_user_id) : null);
          const actor = log.actor || (log.created_by ? userMap.get(log.created_by) : null);
          const metadata: HistoryMetadata = {
            from_user_id: log.old_user_id,
            from_user_name: oldUser?.name || null,
            to_user_id: log.new_user_id,
            to_user_name: newUser?.name || null,
            transferred_by_id: actor?.id || log.created_by || null,
            transferred_by_name: actor?.name || null,
            reason: log.reason,
            is_automation: log.reason !== 'manual_transfer',
          };
          const normalizedReason = metadataString(log.reason)?.toLowerCase();
          const content = normalizedReason && ![
            'manual_transfer',
            'round_robin',
            'round_robin_auto',
            'canonical_round_robin',
          ].includes(normalizedReason)
            ? `Motivo: ${log.reason}`
            : undefined;

          return {
            id: `assignment-${log.id}`,
            type: 'assignee_changed',
            label: buildLabel('assignee_changed', metadata),
            content,
            timestamp: log.created_at,
            actor: actor ? { id: actor.id, name: actor.name, avatar_url: actor.avatar_url || null } : null,
            source: 'timeline' as const,
            metadata,
            channel: null,
            isAutomation: log.reason !== 'manual_transfer',
          };
        });

      const fallbackEvents: UnifiedHistoryEvent[] = [];
      const hasLeadCreated = timelineTypesPresent.has('lead_created') || activityTypesPresent.has('lead_created');
      if (lead && !hasLeadCreated) {
        const label = sourceLabel(lead.source);
        fallbackEvents.push({
          id: `lead-fallback-created-${lead.id}`,
          type: 'lead_created',
          label: buildLabel('lead_created', { source: lead.source, source_label: label }),
          content: label ? `Origem: ${label}` : undefined,
          timestamp: lead.created_at,
          actor: null,
          source: 'timeline' as const,
          metadata: { source: lead.source, source_label: label, utm_source: lead.utm_source },
          channel: lead.source || null,
          isAutomation: false,
          sourceOrigin: lead.source || null,
        });
      }

      const hasAssignmentEvent =
        timelineTypesPresent.has('lead_assigned') ||
        timelineTypesPresent.has('assignee_changed') ||
        activityTypesPresent.has('assignee_changed') ||
        assignmentMapped.length > 0 ||
        distributionMapped.length > 0;
      if (lead?.assigned_user_id && !hasAssignmentEvent) {
        const assignedUser = lead.assigned_user || userMap.get(lead.assigned_user_id);
        const assignedName = assignedUser?.name || 'Responsável atual';
        fallbackEvents.push({
          id: `lead-fallback-assigned-${lead.id}`,
          type: 'lead_assigned',
          label: `Atribuído a ${assignedName}`,
          content: 'Registro sem fila de distribuição vinculada',
          timestamp: lead.assigned_at || lead.created_at,
          actor: assignedUser ? { id: assignedUser.id, name: assignedUser.name, avatar_url: assignedUser.avatar_url || null } : null,
          source: 'timeline' as const,
          metadata: {
            assigned_user_id: lead.assigned_user_id,
            assigned_user_name: assignedName,
            to_user_id: lead.assigned_user_id,
            to_user_name: assignedName,
            source: lead.source,
            source_label: sourceLabel(lead.source),
          },
          channel: null,
          isAutomation: false,
        });
      }

      const auditMapped: UnifiedHistoryEvent[] = auditLogs
        .map((audit) => ({ audit, keys: auditVisibleKeys(audit, activityEvents) }))
        .filter(({ audit, keys }) => {
          const eventType = auditEventType(audit.action, keys);
          if (eventType === 'lead_created' && hasLeadCreated) return false;
          if (
            audit.action === 'move_stage' &&
            (timelineTypesPresent.has('stage_changed') || activityTypesPresent.has('stage_change'))
          ) {
            return false;
          }
          return audit.action === 'create' || audit.action === 'delete' || keys.length > 0;
        })
        .map(({ audit, keys }) => {
          const eventType = auditEventType(audit.action, keys);
          const oldData = asMetadata(audit.old_data);
          const newData = asMetadata(audit.new_data);
          const toUserId = metadataString(newData.assigned_user_id);
          const fromUserId = metadataString(oldData.assigned_user_id);
          const toUser = toUserId ? userMap.get(toUserId) : null;
          const fromUser = fromUserId ? userMap.get(fromUserId) : null;
          const actor = audit.actor || (audit.user_id ? userMap.get(audit.user_id) : null);
          const metadata: HistoryMetadata = {
            ...newData,
            audit_action: audit.action,
            old_data: oldData,
            new_data: newData,
            from_user_id: fromUserId,
            from_user_name: fromUser?.name || null,
            to_user_id: toUserId,
            to_user_name: toUser?.name || null,
            from_status: metadataString(oldData.deal_status),
            to_status: metadataString(newData.deal_status),
            old_stage_id: metadataString(oldData.stage_id),
            new_stage_id: metadataString(newData.stage_id),
          };

          return {
            id: `audit-${audit.id}`,
            type: eventType,
            label: buildLabel(eventType, metadata),
            content: auditContent(audit.action, keys, oldData, newData),
            timestamp: audit.created_at,
            actor: actor ? { id: actor.id, name: actor.name, avatar_url: actor.avatar_url || null } : null,
            source: 'activity' as const,
            metadata,
            channel: null,
            isAutomation: false,
          };
        });

      // Merge and sort chronologically (oldest first)
      return [
        ...fallbackEvents,
        ...timelineMapped,
        ...activityMapped,
        ...assignmentMapped,
        ...auditMapped,
        ...metaCreativeMappedFromActivities,
        ...metaCreativeMappedFromLeadMeta,
        ...metaFormAnswerMapped,
        ...webhookFormAnswerMappedFromActivities,
        ...webhookFormAnswerMappedFromLeadMeta,
        ...entriesMapped,
        ...distributionMapped,
      ].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    },
    enabled: !!leadId,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
}
