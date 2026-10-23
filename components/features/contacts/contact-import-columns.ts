import { resolveContactImportSource } from '@/components/features/contacts/contact-import-source';

export interface ParsedContact {
  rowNumber: number;
  importRequestKey?: string;
  nome: string;
  telefone?: string;
  email?: string;
  status?: string;
  pipeline?: string;
  pipeline_id?: string;
  estagio?: string;
  stage_id?: string;
  responsavel?: string;
  assigned_user_id?: string;
  tags?: string;
  fonte?: string;
  motivo_perda?: string;
  mensagem?: string;
}

/** Keep the execution identity when preparing confirmed failures for another attempt. */
export function assignContactImportKeys(rows: readonly ParsedContact[], createKey: () => string): ParsedContact[] {
  return rows.map((row) => ({ ...row, importRequestKey: row.importRequestKey || createKey() }));
}

const COLUMN_ALIASES: Readonly<Record<string, keyof Omit<ParsedContact, 'rowNumber'>>> = {
  nome: 'nome', name: 'nome', telefone: 'telefone', phone: 'telefone', tel: 'telefone',
  email: 'email', 'e-mail': 'email', status: 'status', situacao: 'status', situação: 'status',
  pipeline: 'pipeline', funil: 'pipeline', pipeline_id: 'pipeline_id', 'id da pipeline': 'pipeline_id', 'id do funil': 'pipeline_id',
  estagio: 'estagio', estágio: 'estagio', stage: 'estagio', fase: 'estagio', 'atendimento/estágio': 'estagio',
  stage_id: 'stage_id', estagio_id: 'stage_id', 'id do estágio': 'stage_id', 'id do estagio': 'stage_id',
  responsavel: 'responsavel', responsável: 'responsavel', corretor: 'responsavel', assignee: 'responsavel',
  assigned_user_id: 'assigned_user_id', responsavel_id: 'assigned_user_id', 'id do responsável': 'assigned_user_id', 'id do responsavel': 'assigned_user_id',
  tags: 'tags', etiquetas: 'tags', fonte: 'fonte', origem: 'fonte', source: 'fonte',
  'motivo de perda': 'motivo_perda', motivo_perda: 'motivo_perda', loss_reason: 'motivo_perda',
  mensagem: 'mensagem', message: 'mensagem', observacao: 'mensagem', observação: 'mensagem', note: 'mensagem', 'mensagem do lead': 'mensagem',
};

export const normalizeContactImportLookup = (value: string) => value.trim().toLocaleLowerCase('pt-BR');

export function contactImportColumn(header: string) {
  const normalized = normalizeContactImportLookup(header);
  return Object.hasOwn(COLUMN_ALIASES, normalized) ? COLUMN_ALIASES[normalized] : undefined;
}

export class ContactImportFileError extends Error {}

/** Reject equivalent aliases before converting cells to objects, where duplicate values would disappear. */
export function validateContactImportHeaders(headers: readonly string[], rowNumber = 1) {
  const seen = new Set<string>();
  for (const header of headers) {
    const normalized = normalizeContactImportLookup(header);
    if (!normalized) continue;
    const identity = contactImportColumn(header) || normalized;
    if (seen.has(identity)) throw new ContactImportFileError(`Linha ${rowNumber}: coluna duplicada ou equivalente "${header}"`);
    seen.add(identity);
  }
}

export function ignoredContactImportColumns(headers: readonly string[]) {
  return headers.filter((header) => header.trim() && !contactImportColumn(header));
}

export function normalizeContactImportSource(value: string) {
  const result = resolveContactImportSource(value);
  // Keep an invalid value so the row-level validator can report its physical row.
  return result.success ? result.value : value.trim();
}

export function normalizeContactImportRows(rows: readonly { rowNumber: number; values: Record<string, string> }[]): ParsedContact[] {
  return rows.map(({ rowNumber, values }) => {
    const row: ParsedContact = { rowNumber, nome: '' };
    for (const [header, value] of Object.entries(values)) {
      const column = contactImportColumn(header);
      if (column) row[column] = column === 'fonte' ? normalizeContactImportSource(value) : value.trim();
    }
    return row;
  });
}

type ImportReference = { id: string; name: string; email?: string | null };

export function resolveContactImportReference(
  value: string | undefined,
  explicitId: string | undefined,
  references: readonly ImportReference[],
  label: string,
): { id?: string; error?: string } {
  const text = value?.trim() || '';
  const id = explicitId?.trim() || '';
  if (!text && !id) return {};
  if (id) {
    const reference = references.find((entry) => entry.id === id);
    if (!reference) return { error: `${label}: ID "${id}" não encontrado no destino disponível` };
    if (text && ![reference.id, reference.name, reference.email || ''].some((candidate) => normalizeContactImportLookup(candidate) === normalizeContactImportLookup(text))) {
      return { error: `${label}: nome ou e-mail não corresponde ao ID informado` };
    }
    return { id: reference.id };
  }
  const exactId = references.find((entry) => entry.id === text);
  if (exactId) return { id: exactId.id };
  const matches = references.filter((entry) => [entry.name, entry.email || ''].some((candidate) => normalizeContactImportLookup(candidate) === normalizeContactImportLookup(text)));
  if (matches.length === 1) return { id: matches[0].id };
  return { error: matches.length > 1 ? `${label} "${text}" é ambíguo. Informe o ID ou um e-mail único.` : `${label} "${text}" não encontrado` };
}
