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
}

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

function addContactWorksheetRows(worksheet: ExcelJS.Worksheet, contacts: Contact[]) {
  contacts.forEach((contact) => {
    worksheet.addRow({
      nome: contact.name,
      telefone: contact.phone || '',
      email: contact.email || '',
      origem: sourceLabel(contact.source),
      status: dealStatusLabel(contact.deal_status),
      pipeline: contact.pipeline_name || '',
      estagio: contact.stage_name || '',
      responsavel: contact.assignee_name || '',
      tags: formatTags(contact.tags),
      motivo_perda: contact.lost_reason || '',
      ultima_interacao: formatOptionalDate(contact.last_interaction_at),
      ultima_interacao_canal: contact.last_interaction_channel || '',
      ultima_interacao_preview: contact.last_interaction_preview || '',
      criacao: formatOptionalDate(contact.created_at),
      reentradas: contact.reentry_count || 0,
    });
  });
}

export async function exportContactsFiltered({
  filters = {},
  filename = 'contatos',
  exportFormat = 'xlsx',
}: ExportOptions) {
  const contacts = await contactsAPI.list({
    ...(filters as ContactListFilters),
    sortBy: 'created_at',
    sortDir: 'desc',
    page: 1,
    limit: 10000,
  });

  if (contacts.length === 0) {
    throw new Error('Nenhum contato encontrado para exportar');
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Contatos');

  worksheet.columns = [
    { header: 'Nome', key: 'nome', width: 25 },
    { header: 'Telefone', key: 'telefone', width: 18 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Origem', key: 'origem', width: 18 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Pipeline', key: 'pipeline', width: 20 },
    { header: 'Estagio', key: 'estagio', width: 20 },
    { header: 'Responsavel', key: 'responsavel', width: 20 },
    { header: 'Tags', key: 'tags', width: 25 },
    { header: 'Motivo Perda', key: 'motivo_perda', width: 30 },
    { header: 'Ultima Interacao', key: 'ultima_interacao', width: 18 },
    { header: 'Canal Ultima Interacao', key: 'ultima_interacao_canal', width: 22 },
    { header: 'Preview Ultima Interacao', key: 'ultima_interacao_preview', width: 42 },
    { header: 'Data de Criacao', key: 'criacao', width: 18 },
    { header: 'Reentradas', key: 'reentradas', width: 12 },
  ];

  addContactWorksheetRows(worksheet, contacts);
  styleHeader(worksheet);

  await downloadWorkbook(workbook, filename, exportFormat);
  return contacts.length;
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
    downloadFile(buffer, `${filename}.csv`, 'text/csv;charset=utf-8;');
    return;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  downloadFile(buffer, `${filename}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

function downloadFile(buffer: ExcelJS.Buffer, filename: string, mimeType: string) {
  const blob = new Blob([buffer], { type: mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
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
