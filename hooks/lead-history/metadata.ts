import type { HistoryMetadata } from './types';


export function asMetadata(metadata: unknown): HistoryMetadata {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return metadata as HistoryMetadata;
}

export function metadataString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return null;
  return String(value);
}

export function metadataNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function metadataRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export const FORM_ANSWER_VALUE_KEYS = [
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

export function answerText(value: unknown): string | null {
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

export function normalizeFieldKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
