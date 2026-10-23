import { CONTACT_EXPORT_MAX_JSON_DEPTH, ContactExportExpansionError } from '@/lib/contact-export-limits';

class ExportJSONNumber {
  readonly raw: string;
  constructor(raw: string) { this.raw = raw; }
}

export type ExportJSONValue = null | boolean | string | ExportJSONNumber
  | ExportJSONValue[] | { [key: string]: ExportJSONValue };
export type ExportJSONBudget = { nodes: number; characters: number };

export function isExportJSONNumber(value: unknown): value is ExportJSONNumber {
  return value instanceof ExportJSONNumber;
}

/** Numbers stay as their original JSON tokens, without converting to Number. */
export function parseContactExportJSON(text: string, budget: ExportJSONBudget): ExportJSONValue {
  budget.characters -= text.length;
  if (budget.characters < 0) throw new ContactExportExpansionError();
  let position = 0;
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(text[position] ?? '') && position < text.length) position += 1; };
  const fail = (): never => { throw new Error('Um JSON do contato é inválido. Nenhum campo foi cortado e nenhum arquivo foi gerado.'); };
  const string = () => {
    const start = position++;
    while (position < text.length) {
      if (text[position] === '\\') position += 2;
      else if (text[position++] === '"') {
        try { return JSON.parse(text.slice(start, position)) as string; } catch { return fail(); }
      }
    }
    return fail();
  };
  const read = (depth: number): ExportJSONValue => {
    if (depth > CONTACT_EXPORT_MAX_JSON_DEPTH || --budget.nodes < 0) throw new ContactExportExpansionError();
    whitespace();
    const token = text[position];
    if (token === '"') return string();
    if (token === '[' || token === '{') {
      const array = token === '[';
      const result: ExportJSONValue[] | { [key: string]: ExportJSONValue } = array ? [] : Object.create(null);
      position += 1;
      whitespace();
      const close = array ? ']' : '}';
      if (text[position] === close) { position += 1; return result; }
      while (position < text.length) {
        let key = '';
        if (!array) {
          whitespace();
          if (text[position] !== '"') return fail();
          key = string();
          whitespace();
          if (text[position++] !== ':') return fail();
        }
        const value = read(depth + 1);
        if (Array.isArray(result)) result.push(value);
        else result[key] = value;
        whitespace();
        if (text[position] === close) { position += 1; return result; }
        if (text[position++] !== ',') return fail();
      }
      return fail();
    }
    for (const [literal, value] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(literal, position)) { position += literal.length; return value; }
    }
    number.lastIndex = position;
    const matched = number.exec(text);
    if (!matched) return fail();
    position = number.lastIndex;
    return new ExportJSONNumber(matched[0]);
  };
  const result = read(0);
  whitespace();
  if (position !== text.length) return fail();
  return result;
}

export function stringifyContactExportJSON(value: ExportJSONValue): string {
  if (isExportJSONNumber(value)) return value.raw;
  if (Array.isArray(value)) return `[${value.map(stringifyContactExportJSON).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${stringifyContactExportJSON(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const responseKeys = ['values', 'value', 'answer', 'response', 'field_value', 'text'];
const labelKeys = ['name', 'question', 'label', 'field_label', 'field_name', 'key', 'title'];

function sensitiveDocument(label: string) {
  if (/^has(?:cpf|rg)$/i.test(label)) return false;
  return /(?:^|[^a-z0-9])(?:cpf|rg)(?:[^a-z0-9]|$)/i.test(label.replace(/([a-z])([A-Z])/g, '$1 $2'));
}

/** Defense in depth for expanded columns; raw fallback is sanitized by the API. */
export function sanitizeContactExportDocuments(value: ExportJSONValue): void {
  if (Array.isArray(value)) value.forEach(sanitizeContactExportDocuments);
  else if (value !== null && typeof value === 'object' && !isExportJSONNumber(value)) {
    if (labelKeys.some((key) => typeof value[key] === 'string' && sensitiveDocument(value[key] as string))) {
      responseKeys.forEach((key) => { delete value[key]; });
    }
    Object.entries(value).forEach(([key, item]) => {
      if (sensitiveDocument(key)) delete value[key];
      else sanitizeContactExportDocuments(item);
    });
  }
}
