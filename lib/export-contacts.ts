import ExcelJS from 'exceljs';
import { format as formatDate } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { contactsAPI } from '@/lib/api/contacts';
import type { Contact, ContactListFilters } from '@/hooks/use-contacts-list';

interface ExportFilters {
  search?: string;
  teamId?: string;
  pipelineId?: string;
  stageId?: string;
  assigneeId?: string;
  unassigned?: boolean;
  tagId?: string;
  source?: string;
  campaignId?: string;
  adSetId?: string;
  adId?: string;
  dealStatus?: string;
  createdFrom?: string;
  createdTo?: string;
}

interface ExportOptions {
  filters?: ExportFilters;
  filename?: string;
  exportFormat?: 'xlsx' | 'csv';
  organizationId?: string | null;
}

type ContactExportRow = Record<string, string | number | boolean | null | undefined>;

type ExportColumn = {
  header: string;
  key: string;
  width: number;
  value?: (contact: Contact) => string | number | boolean | null | undefined;
};

type JsonScalar = string | number | boolean | null;
type JsonRecord = Record<string, unknown>;
type ContactExportExtras = {
  answers: Record<string, string>;
  flattened: Record<string, Record<string, string>>;
};

interface LegacyExportLead {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  stage?: { name?: string | null } | null;
  assignee?: { name?: string | null } | null;
  tags?: unknown;
  source?: string | null;
  message?: string | null;
  created_at: string;
}

const sourceLabels: Record<string, string> = {
  manual: 'Manual',
  meta: 'Meta Ads',
  site: 'Site',
  wordpress: 'WordPress',
  website: 'Website',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  indicacao: 'Indicacao',
  outro: 'Outro',
};

const dealStatusLabels: Record<string, string> = {
  open: 'Aberto',
  won: 'Ganho',
  lost: 'Perdido',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatTags(tags: unknown) {
  if (!Array.isArray(tags)) return '';

  return tags
    .map((tag) => (isRecord(tag) && typeof tag.name === 'string' ? tag.name : ''))
    .filter(Boolean)
    .join(', ');
}

function formatOptionalDate(value?: string | null) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return formatDate(date, 'dd/MM/yyyy HH:mm', { locale: ptBR });
}

function sourceLabel(source?: string | null) {
  return sourceLabels[source || ''] || source || '';
}

function dealStatusLabel(status?: string | null) {
  return dealStatusLabels[status || 'open'] || 'Aberto';
}

function boolLabel(value?: boolean | null) {
  if (value === true) return 'Sim';
  if (value === false) return 'Nao';
  return '';
}

function jsonText(value?: string | null) {
  return value && value !== '{}' ? value : '';
}

function parseJsonRecord(value?: string | null): JsonRecord | null {
  if (!value || value === '{}') return null;

  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeDynamicKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
}

function stringifyExportValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => stringifyExportValue(item)).filter(Boolean).join(', ');
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isScalar(value: unknown): value is JsonScalar {
  return value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function flattenJsonScalars(value: unknown, prefix = '', depth = 0, output: Record<string, string> = {}) {
  if (depth > 4 || value == null) return output;

  if (isScalar(value)) {
    if (prefix) output[prefix] = stringifyExportValue(value);
    return output;
  }

  if (Array.isArray(value)) {
    if (value.every(isScalar)) {
      if (prefix) output[prefix] = stringifyExportValue(value);
      return output;
    }

    value.slice(0, 20).forEach((item, index) => {
      flattenJsonScalars(item, `${prefix}.${index + 1}`, depth + 1, output);
    });
    return output;
  }

  if (!isRecord(value)) return output;

  Object.entries(value)
    .slice(0, 250)
    .forEach(([key, item]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      flattenJsonScalars(item, path, depth + 1, output);
    });

  return output;
}

function collectFieldAnswers(value: unknown, output: Record<string, string> = {}) {
  if (value == null) return output;

  if (Array.isArray(value)) {
    value.forEach((item) => collectFieldAnswers(item, output));
    return output;
  }

  if (!isRecord(value)) return output;

  const labelCandidate =
    value.name ??
    value.question ??
    value.label ??
    value.field_label ??
    value.field_name ??
    value.key ??
    value.title;
  const answerCandidate =
    value.values ??
    value.value ??
    value.answer ??
    value.response ??
    value.field_value ??
    value.text;

  if (typeof labelCandidate === 'string' && answerCandidate != null) {
    const answer = stringifyExportValue(answerCandidate);
    if (answer) output[labelCandidate] = answer;
  }

  Object.values(value).forEach((item) => {
    if (Array.isArray(item) || isRecord(item)) collectFieldAnswers(item, output);
  });

  return output;
}

const jsonSourceDefinitions = [
  { prefix: 'Metadado', keyPrefix: 'metadata' },
  { prefix: 'Meta payload', keyPrefix: 'meta_payload' },
  { prefix: 'Meta raw', keyPrefix: 'meta_raw' },
] as const;

function contactJsonSources(contact: Contact) {
  return [
    { ...jsonSourceDefinitions[0], value: parseJsonRecord(contact.metadata_json) },
    { ...jsonSourceDefinitions[1], value: parseJsonRecord(contact.meta_payload_json) },
    { ...jsonSourceDefinitions[2], value: parseJsonRecord(contact.meta_raw_payload_json) },
  ];
}

function buildContactExportExtras(contact: Contact): ContactExportExtras {
  const answers: Record<string, string> = {};
  const flattened: Record<string, Record<string, string>> = {};

  contactJsonSources(contact).forEach((source) => {
    if (!source.value) return;
    Object.assign(answers, collectFieldAnswers(source.value));
    flattened[source.keyPrefix] = flattenJsonScalars(source.value);
  });

  return { answers, flattened };
}

function buildExportExtras(contacts: Contact[]) {
  return new Map(contacts.map((contact) => [contact.id, buildContactExportExtras(contact)]));
}

function buildDynamicExportColumns(contacts: Contact[], extrasByContactId: Map<string, ContactExportExtras>): ExportColumn[] {
  const columns = new Map<string, ExportColumn>();

  const addColumn = (column: ExportColumn) => {
    if (!columns.has(column.key)) columns.set(column.key, column);
  };

  contacts.forEach((contact) => {
    const extras = extrasByContactId.get(contact.id);
    if (!extras) return;

    Object.keys(extras.answers).forEach((question) => {
      const normalized = normalizeDynamicKey(question);
      if (!normalized) return;

      addColumn({
        header: `Pergunta: ${question}`,
        key: `question_${normalized}`,
        width: 34,
        value: (row) => extrasByContactId.get(row.id)?.answers[question] || '',
      });
    });

    jsonSourceDefinitions.forEach((source) => {
      const flattened = extras.flattened[source.keyPrefix];
      if (!flattened) return;

      Object.keys(flattened).forEach((path) => {
        const normalized = normalizeDynamicKey(`${source.keyPrefix}_${path}`);
        if (!normalized) return;

        addColumn({
          header: `${source.prefix}: ${path}`,
          key: `extra_${normalized}`,
          width: 32,
          value: (row) => {
            return extrasByContactId.get(row.id)?.flattened[source.keyPrefix]?.[path] || '';
          },
        });
      });
    });
  });

  return Array.from(columns.values()).sort((a, b) => a.header.localeCompare(b.header, 'pt-BR'));
}

function buildExportColumns(contacts: Contact[], extrasByContactId: Map<string, ContactExportExtras>) {
  return [...contactExportColumns, ...buildDynamicExportColumns(contacts, extrasByContactId)];
}

const contactExportColumns: ExportColumn[] = [
  { header: 'ID do lead', key: 'id', width: 36 },
  { header: 'Nome', key: 'nome', width: 25 },
  { header: 'Telefone', key: 'telefone', width: 18 },
  { header: 'WhatsApp', key: 'whatsapp', width: 18 },
  { header: 'Email', key: 'email', width: 30 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Status interno', key: 'status_interno', width: 18 },
  { header: 'Pipeline', key: 'pipeline', width: 20 },
  { header: 'ID da pipeline', key: 'pipeline_id', width: 36 },
  { header: 'Atendimento/Estagio', key: 'estagio', width: 24 },
  { header: 'ID do estagio', key: 'estagio_id', width: 36 },
  { header: 'Responsavel', key: 'responsavel', width: 24 },
  { header: 'ID do responsavel', key: 'responsavel_id', width: 36 },
  { header: 'Origem', key: 'origem', width: 18 },
  { header: 'Detalhe da origem', key: 'origem_detalhe', width: 28 },
  { header: 'Prioridade', key: 'prioridade', width: 14 },
  { header: 'Tags', key: 'tags', width: 30 },
  { header: 'Criado em', key: 'criado_em', width: 18 },
  { header: 'Atualizado em', key: 'atualizado_em', width: 18 },
  { header: 'Entrada no estagio', key: 'entrada_estagio', width: 18 },
  { header: 'Ultima entrada', key: 'ultima_entrada', width: 18 },
  { header: 'Último contato', key: 'ultimo_contato', width: 18 },
  { header: 'Próximo follow-up', key: 'proximo_follow_up', width: 18 },
  { header: 'Data de ganho', key: 'data_ganho', width: 18 },
  { header: 'Data de perda', key: 'data_perda', width: 18 },
  { header: 'Motivo de perda', key: 'motivo_perda', width: 34 },
  { header: 'Motivo/feedback de ganho', key: 'motivo_ganho', width: 34 },
  { header: 'Feedback', key: 'feedback', width: 42 },
  { header: 'Valor de interesse', key: 'valor_interesse', width: 18 },
  { header: 'Comissao %', key: 'comissao_percentual', width: 14 },
  { header: 'Faixa de valor do imóvel', key: 'faixa_valor_imovel', width: 24 },
  { header: 'Renda familiar', key: 'renda_familiar', width: 20 },
  { header: 'Finalidade da compra', key: 'finalidade_compra', width: 24 },
  { header: 'Procura financiamento', key: 'procura_financiamento', width: 20 },
  { header: 'Trabalha', key: 'trabalha', width: 12 },
  { header: 'Cargo', key: 'cargo', width: 20 },
  { header: 'Empresa', key: 'empresa', width: 24 },
  { header: 'Profissao', key: 'profissao', width: 20 },
  { header: 'CEP', key: 'cep', width: 12 },
  { header: 'Endereço', key: 'endereco', width: 34 },
  { header: 'Número', key: 'numero', width: 12 },
  { header: 'Complemento', key: 'complemento', width: 18 },
  { header: 'Bairro', key: 'bairro', width: 20 },
  { header: 'Cidade', key: 'cidade', width: 20 },
  { header: 'UF', key: 'uf', width: 8 },
  { header: 'Recurso proprio', key: 'recurso_proprio', width: 16 },
  { header: 'Código do imóvel', key: 'codigo_imovel', width: 18 },
  { header: 'ID do imóvel', key: 'imovel_id', width: 36 },
  { header: 'ID do imóvel de interesse', key: 'imovel_interesse_id', width: 36 },
  { header: 'ID do plano de interesse', key: 'plano_interesse_id', width: 36 },
  { header: 'Mensagem do lead', key: 'mensagem', width: 44 },
  { header: 'Mensagem inicial', key: 'mensagem_inicial', width: 44 },
  { header: 'Campanha', key: 'campanha', width: 28 },
  { header: 'ID da campanha', key: 'campanha_id', width: 24 },
  { header: 'Conjunto', key: 'conjunto', width: 26 },
  { header: 'ID do conjunto', key: 'conjunto_id', width: 24 },
  { header: 'Formulário', key: 'formulario', width: 28 },
  { header: 'ID do formulário', key: 'formulario_id', width: 24 },
  { header: 'Criativo', key: 'criativo', width: 32 },
  { header: 'ID do criativo/anuncio', key: 'criativo_id', width: 24 },
  { header: 'URL do criativo', key: 'criativo_url', width: 36 },
  { header: 'URL do video', key: 'video_url', width: 36 },
  { header: 'URL do Instagram', key: 'instagram_url', width: 36 },
  { header: 'Plataforma', key: 'plataforma', width: 16 },
  { header: 'Meta Lead ID', key: 'meta_lead_id', width: 28 },
  { header: 'Meta Form ID original', key: 'meta_form_id', width: 24 },
  { header: 'Meta Campaign ID original', key: 'meta_campaign_id', width: 24 },
  { header: 'Meta Adset ID original', key: 'meta_adset_id', width: 24 },
  { header: 'Meta Ad ID original', key: 'meta_ad_id', width: 24 },
  { header: 'Meta Click ID', key: 'meta_click_id', width: 24 },
  { header: 'UTM Source', key: 'utm_source', width: 18 },
  { header: 'UTM Medium', key: 'utm_medium', width: 18 },
  { header: 'UTM Campaign', key: 'utm_campaign', width: 24 },
  { header: 'UTM Content', key: 'utm_content', width: 24 },
  { header: 'UTM Term', key: 'utm_term', width: 24 },
  { header: 'Primeiro toque em', key: 'primeiro_toque_em', width: 18 },
  { header: 'Primeiro toque segundos', key: 'primeiro_toque_segundos', width: 18 },
  { header: 'Canal primeiro toque', key: 'primeiro_toque_canal', width: 20 },
  { header: 'Usuário primeiro toque', key: 'primeiro_toque_usuario_id', width: 36 },
  { header: 'Primeira resposta em', key: 'primeira_resposta_em', width: 18 },
  { header: 'Primeira resposta segundos', key: 'primeira_resposta_segundos', width: 20 },
  { header: 'Canal primeira resposta', key: 'primeira_resposta_canal', width: 22 },
  { header: 'Primeira resposta automatica', key: 'primeira_resposta_automatica', width: 22 },
  { header: 'Usuário primeira resposta', key: 'primeira_resposta_usuario_id', width: 36 },
  { header: 'Reentradas', key: 'reentradas', width: 12 },
  { header: 'Redistribuicoes', key: 'redistribuicoes', width: 16 },
  { header: 'Source Session ID', key: 'source_session_id', width: 28 },
  { header: 'Source Webhook ID', key: 'source_webhook_id', width: 36 },
  { header: 'Visitor Session ID', key: 'visitor_session_id', width: 28 },
  { header: 'Criado por', key: 'criado_por', width: 36 },
  { header: 'Metadados JSON', key: 'metadata_json', width: 42 },
  { header: 'Meta Payload JSON', key: 'meta_payload_json', width: 42 },
  { header: 'Meta Raw Payload JSON', key: 'meta_raw_payload_json', width: 42 },
];

function buildContactExportRow(contact: Contact, columns: ExportColumn[] = contactExportColumns): ContactExportRow {
  const row: ContactExportRow = {
    id: contact.id,
    nome: contact.name,
    telefone: contact.phone || '',
    whatsapp: contact.whatsapp || '',
    email: contact.email || '',
    status: dealStatusLabel(contact.deal_status),
    status_interno: contact.status || '',
    pipeline: contact.pipeline_name || '',
    pipeline_id: contact.pipeline_id || '',
    estagio: contact.stage_name || '',
    estagio_id: contact.stage_id || '',
    responsavel: contact.assignee_name || '',
    responsavel_id: contact.assigned_user_id || '',
    origem: sourceLabel(contact.source),
    origem_detalhe: contact.source_detail || '',
    prioridade: contact.priority || '',
    tags: formatTags(contact.tags),
    criado_em: formatOptionalDate(contact.created_at),
    atualizado_em: formatOptionalDate(contact.updated_at),
    entrada_estagio: formatOptionalDate(contact.stage_entered_at),
    ultima_entrada: formatOptionalDate(contact.last_entry_at),
    ultimo_contato: formatOptionalDate(contact.last_contact_at),
    proximo_follow_up: formatOptionalDate(contact.next_follow_up_at),
    data_ganho: formatOptionalDate(contact.won_at),
    data_perda: formatOptionalDate(contact.lost_at),
    motivo_perda: contact.lost_reason || '',
    motivo_ganho: contact.deal_status === 'won' ? contact.feedback || '' : '',
    feedback: contact.feedback || '',
    valor_interesse: contact.valor_interesse || '',
    comissao_percentual: contact.commission_percentage || '',
    faixa_valor_imovel: contact.faixa_valor_imovel || '',
    renda_familiar: contact.renda_familiar || '',
    finalidade_compra: contact.finalidade_compra || '',
    procura_financiamento: boolLabel(contact.procura_financiamento),
    trabalha: boolLabel(contact.trabalha),
    cargo: contact.cargo || '',
    empresa: contact.empresa || '',
    profissao: contact.profissao || '',
    cep: contact.cep || '',
    endereco: contact.endereco || '',
    numero: contact.numero || '',
    complemento: contact.complemento || '',
    bairro: contact.bairro || '',
    cidade: contact.cidade || '',
    uf: contact.uf || '',
    recurso_proprio: boolLabel(contact.is_own_resource),
    codigo_imovel: contact.property_code || '',
    imovel_id: contact.property_id || '',
    imovel_interesse_id: contact.interest_property_id || '',
    plano_interesse_id: contact.interest_plan_id || '',
    mensagem: contact.message || '',
    mensagem_inicial: contact.initial_message || '',
    campanha: contact.campaign_name || contact.utm_campaign || '',
    campanha_id: contact.campaign_id || '',
    conjunto: contact.adset_name || '',
    conjunto_id: contact.adset_id || '',
    formulario: contact.form_name || contact.utm_term || '',
    formulario_id: contact.form_id || '',
    criativo: contact.ad_name || contact.utm_content || '',
    criativo_id: contact.ad_id || '',
    criativo_url: contact.creative_url || '',
    video_url: contact.creative_video_url || '',
    instagram_url: contact.creative_instagram_url || '',
    plataforma: contact.platform || '',
    meta_lead_id: contact.meta_lead_id || '',
    meta_form_id: contact.meta_form_id || '',
    meta_campaign_id: contact.meta_campaign_id || '',
    meta_adset_id: contact.meta_adset_id || '',
    meta_ad_id: contact.meta_ad_id || '',
    meta_click_id: contact.meta_click_id || '',
    utm_source: contact.utm_source || '',
    utm_medium: contact.utm_medium || '',
    utm_campaign: contact.utm_campaign || '',
    utm_content: contact.utm_content || '',
    utm_term: contact.utm_term || '',
    primeiro_toque_em: formatOptionalDate(contact.first_touch_at),
    primeiro_toque_segundos: contact.first_touch_seconds ?? '',
    primeiro_toque_canal: contact.first_touch_channel || '',
    primeiro_toque_usuario_id: contact.first_touch_actor_user_id || '',
    primeira_resposta_em: formatOptionalDate(contact.first_response_at),
    primeira_resposta_segundos: contact.first_response_seconds ?? '',
    primeira_resposta_canal: contact.first_response_channel || '',
    primeira_resposta_automatica: boolLabel(contact.first_response_is_automation),
    primeira_resposta_usuario_id: contact.first_response_actor_user_id || '',
    reentradas: contact.reentry_count || 0,
    redistribuicoes: contact.redistribution_count || 0,
    source_session_id: contact.source_session_id || '',
    source_webhook_id: contact.source_webhook_id || '',
    visitor_session_id: contact.visitor_session_id || '',
    criado_por: contact.created_by || '',
    metadata_json: jsonText(contact.metadata_json),
    meta_payload_json: jsonText(contact.meta_payload_json),
    meta_raw_payload_json: jsonText(contact.meta_raw_payload_json),
  };

  columns.forEach((column) => {
    if (column.value) row[column.key] = column.value(contact);
  });

  return row;
}

function addContactWorksheetRows(worksheet: ExcelJS.Worksheet, contacts: Contact[], columns: ExportColumn[]) {
  contacts.forEach((contact) => {
    worksheet.addRow(buildContactExportRow(contact, columns));
  });
}

export async function exportContactsFiltered({
  filters = {},
  filename = 'contatos',
  exportFormat = 'csv',
  organizationId,
}: ExportOptions) {
  const contacts = await fetchAllFilteredContacts(filters, organizationId);

  if (contacts.length === 0) {
    throw new Error('Nenhum contato encontrado para exportar');
  }

  const extrasByContactId = buildExportExtras(contacts);
  const columns = buildExportColumns(contacts, extrasByContactId);

  if (exportFormat === 'csv') {
    downloadCSV(contacts, filename, columns);
    return contacts.length;
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Contatos');

  worksheet.columns = columns;

  addContactWorksheetRows(worksheet, contacts, columns);
  styleHeader(worksheet);

  await downloadWorkbook(workbook, filename, exportFormat);
  return contacts.length;
}

async function fetchAllFilteredContacts(filters: ExportFilters, organizationId?: string | null) {
  const pageSize = 500;
  const contacts: Contact[] = [];
  let page = 1;
  let totalCount: number | null = null;

  while (page <= 10000) {
    const pageContacts = await contactsAPI.list({
      ...(filters as ContactListFilters),
      sortBy: 'created_at',
      sortDir: 'desc',
      page,
      limit: pageSize,
      mode: 'export',
    }, organizationId);

    if (pageContacts.length === 0) break;

    contacts.push(...pageContacts);
    totalCount = pageContacts[0]?.total_count ?? totalCount;

    if (pageContacts.length < pageSize) break;
    if (totalCount !== null && contacts.length >= totalCount) break;

    page += 1;
  }

  return contacts;
}

function downloadCSV(contacts: Contact[], filename: string, columns: ExportColumn[]) {
  const headers = columns.map((column) => column.header);
  const rows = contacts.map((contact) => {
    const row = buildContactExportRow(contact, columns);
    return columns.map((column) => row[column.key]);
  });
  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCSVCell).join(';'))
    .join('\r\n');

  downloadFile(['\uFEFF', csv], `${filename}.csv`, 'text/csv;charset=utf-8;');
}

function escapeCSVCell(value: string | number | boolean | null | undefined) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function styleHeader(worksheet: ExcelJS.Worksheet) {
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  };
}

async function downloadWorkbook(workbook: ExcelJS.Workbook, filename: string, exportFormat: 'xlsx' | 'csv') {
  if (exportFormat === 'csv') {
    const buffer = await workbook.csv.writeBuffer();
    downloadFile(['\uFEFF', buffer], `${filename}.csv`, 'text/csv;charset=utf-8;');
    return;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  downloadFile(buffer, `${filename}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

function downloadFile(buffer: ExcelJS.Buffer | string | Array<ExcelJS.Buffer | string>, filename: string, mimeType: string) {
  const parts = Array.isArray(buffer) ? buffer : [buffer];
  const blob = new Blob(parts as BlobPart[], { type: mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 10000);
}

export async function exportContacts({
  leads,
  filename = 'contatos',
  exportFormat = 'xlsx',
}: {
  leads: LegacyExportLead[];
  filename?: string;
  exportFormat?: 'xlsx' | 'csv';
}) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Contatos');

  worksheet.columns = [
    { header: 'Nome', key: 'nome', width: 25 },
    { header: 'Telefone', key: 'telefone', width: 18 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Estagio', key: 'estagio', width: 20 },
    { header: 'Responsavel', key: 'responsavel', width: 20 },
    { header: 'Tags', key: 'tags', width: 25 },
    { header: 'Fonte', key: 'fonte', width: 15 },
    { header: 'Mensagem', key: 'mensagem', width: 40 },
    { header: 'Data de Criacao', key: 'criacao', width: 18 },
  ];

  leads.forEach((lead) => {
    worksheet.addRow({
      nome: lead.name,
      telefone: lead.phone || '',
      email: lead.email || '',
      estagio: lead.stage?.name || '',
      responsavel: lead.assignee?.name || '',
      tags: formatTags(lead.tags),
      fonte: sourceLabel(lead.source),
      mensagem: lead.message || '',
      criacao: formatOptionalDate(lead.created_at),
    });
  });

  styleHeader(worksheet);
  await downloadWorkbook(workbook, filename, exportFormat);
}
