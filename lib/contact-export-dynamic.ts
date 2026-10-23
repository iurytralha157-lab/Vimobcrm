import { isExportJSONNumber, parseContactExportJSON, sanitizeContactExportDocuments, stringifyContactExportJSON, type ExportJSONBudget, type ExportJSONValue } from '@/lib/contact-export-json';
import { CONTACT_EXPORT_MAX_EXPANDED_COLUMNS, CONTACT_EXPORT_MAX_JSON_CHARACTERS, CONTACT_EXPORT_MAX_JSON_NODES, ContactExportExpansionError } from '@/lib/contact-export-limits';

type ExportJsonContact = {
  id: string;
  metadata_json?: string | null;
  meta_payload_json?: string | null;
  meta_raw_payload_json?: string | null;
};

export type ContactExportDynamicColumn = {
  header: string;
  key: string;
  width: number;
  value: (contact: ExportJsonContact) => string;
};

type Answer = { label: string; values: Set<string> };
type ExportExtras = {
  answers: Map<string, Map<string, Answer>>;
  flattened: Map<string, Map<string, { label: string; value: string }>>;
};

const sources = [
  { field: 'metadata_json', key: 'metadata', label: 'Metadado' },
  { field: 'meta_payload_json', key: 'meta_payload', label: 'Meta payload' },
  { field: 'meta_raw_payload_json', key: 'meta_raw', label: 'Meta raw' },
] as const;

const collator = new Intl.Collator('pt-BR');
const contextKeys = ['form_id', 'formId', 'survey_id', 'surveyId', 'section_id', 'sectionId'];

function isRecord(value: ExportJSONValue): value is Record<string, ExportJSONValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !isExportJSONNumber(value);
}

function textValue(value: ExportJSONValue | undefined): string {
  if (value == null) return '';
  if (isExportJSONNumber(value)) return value.raw;
  return typeof value === 'object' ? stringifyContactExportJSON(value) : String(value);
}

function scalarID(value: ExportJSONValue | undefined) {
  return typeof value === 'string' || isExportJSONNumber(value) ? textValue(value) : '';
}

function collectAnswers(
  value: ExportJSONValue,
  source: string,
  path: Array<string | number> = [],
  context: string[] = [],
  answers = new Map<string, Answer>(),
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectAnswers(item, source, [...path, index], context, answers));
  } else if (isRecord(value)) {
    const label = value.name ?? value.question ?? value.label ?? value.field_label
      ?? value.field_name ?? value.key ?? value.title;
    const response = value.values ?? value.value ?? value.answer ?? value.response
      ?? value.field_value ?? value.text;
    const ownContext = contextKeys.flatMap((key) => scalarID(value[key]) ? [`${key}=${scalarID(value[key])}`] : []);
    const nextContext = [...context, ...ownContext];
    if (typeof label === 'string' && response != null) {
      const answer = textValue(response);
      const fieldID = scalarID(value.question_id ?? value.questionId ?? value.field_id ?? value.fieldId ?? value.id);
      const parentPath = path.slice(0, -1);
      const identityPath = nextContext.length ? parentPath.filter((segment) => typeof segment === 'string') : parentPath;
      const key = fieldID
        ? JSON.stringify([source, 'id', nextContext, identityPath, fieldID])
        : nextContext.length
          ? JSON.stringify([source, 'context-label', nextContext, identityPath, label])
          : JSON.stringify([source, 'label', label]);
      const identityLabel = fieldID || nextContext.length
        ? ` [${fieldID ? `ID: ${fieldID}; ` : ''}contexto: ${JSON.stringify([nextContext, identityPath])}]`
        : '';
      if (answer) {
        const found = answers.get(key) ?? { label: `${label}${identityLabel}`, values: new Set<string>() };
        found.values.add(answer);
        answers.set(key, found);
      }
    } else if (scalarID(value.id) && /^(?:forms?|surveys?|sections?|groups?|question_groups?|questionnaires?)$/i.test(String(path.filter((part) => typeof part === 'string').at(-1) ?? ''))) {
      // Identified form/section containers keep questions stable if arrays
      // change order. A submission/contact ID is not a question context.
      nextContext.push(`${JSON.stringify(path.filter((part) => typeof part === 'string'))}.id=${scalarID(value.id)}`);
    }
    Object.entries(value).forEach(([key, item]) => {
      if (Array.isArray(item) || isRecord(item)) collectAnswers(item, source, [...path, key], nextContext, answers);
    });
  }
  return answers;
}

function flattenScalars(
  value: ExportJSONValue,
  path: Array<string | number> = [],
  output = new Map<string, { label: string; value: string }>(),
) {
  const primitive = value === null || typeof value !== 'object' || isExportJSONNumber(value);
  const primitiveArray = Array.isArray(value) && value.every((item) => item === null || typeof item !== 'object' || isExportJSONNumber(item));
  if (primitive || primitiveArray) {
      const identity = path.length ? path : ['valor'];
      output.set(JSON.stringify(identity), {
        label: identity.map((segment) => typeof segment === 'number'
          ? `[${segment}]`
          : JSON.stringify(segment)).join(' / '),
        value: textValue(value),
      });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => flattenScalars(item, [...path, index + 1], output));
  } else if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) => flattenScalars(item, [...path, key], output));
  }
  return output;
}

export function buildContactExportDynamicColumns(
  contacts: readonly ExportJsonContact[],
  budget: ExportJSONBudget = { nodes: CONTACT_EXPORT_MAX_JSON_NODES, characters: CONTACT_EXPORT_MAX_JSON_CHARACTERS },
): ContactExportDynamicColumn[] {
  const extras = new Map<string, ExportExtras>();
  const columns = new Map<string, ContactExportDynamicColumn>();
  const addColumn = (column: ContactExportDynamicColumn) => {
    if (!columns.has(column.key)) columns.set(column.key, column);
    if (columns.size > CONTACT_EXPORT_MAX_EXPANDED_COLUMNS) throw new ContactExportExpansionError();
  };
  contacts.forEach((contact) => {
    const contactExtras: ExportExtras = { answers: new Map(), flattened: new Map() };
    extras.set(contact.id, contactExtras);
    sources.forEach((source) => {
      const raw = contact[source.field];
      if (!raw || raw === '{}') return;
      const parsed = parseContactExportJSON(raw, budget);
      sanitizeContactExportDocuments(parsed);
      const answers = collectAnswers(parsed, source.key);
      const flattened = flattenScalars(parsed);
      contactExtras.answers.set(source.key, answers);
      contactExtras.flattened.set(source.key, flattened);
      answers.forEach(({ label }, identity) => {
        const key = `question_${identity}`;
        addColumn({
          key,
          header: `Pergunta (${source.label}): ${label}`,
          width: 34,
          value: (row) => {
            const values = extras.get(row.id)?.answers.get(source.key)?.get(identity)?.values;
            return !values ? '' : values.size === 1 ? [...values][0] : JSON.stringify([...values]);
          },
        });
      });
      flattened.forEach(({ label }, path) => {
        const key = `extra_${JSON.stringify([source.key, path])}`;
        addColumn({
          key,
          header: `${source.label}: ${label}`,
          width: 32,
          value: (row) => extras.get(row.id)?.flattened.get(source.key)?.get(path)?.value ?? '',
        });
      });
    });
  });
  return [...columns.values()].sort((a, b) => collator.compare(a.header, b.header) || collator.compare(a.key, b.key));
}
