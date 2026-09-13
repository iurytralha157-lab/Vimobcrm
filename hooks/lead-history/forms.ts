import type { HistoryMetadata } from './types';
import {
  FORM_ANSWER_VALUE_KEYS,
  answerText,
  metadataRecord,
  normalizeFieldKey,
} from './metadata';


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

export function extractMetaFormAnswers(metadata: HistoryMetadata) {
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

export function extractWebhookFormAnswers(source: Record<string, unknown> | null | undefined) {
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

export type MetaCreativeHistory = {
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

export function extractMetaCreative(source: Record<string, unknown> | null | undefined): MetaCreativeHistory | null {
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
