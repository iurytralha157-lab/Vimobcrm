import { formatPtBRNumber } from './utils/formatting'

/**
 * Mapeia tipos de imóvel para exibição pública.
 * Ex: "Condomínio" → "Casa", "Sobrado" → "Casa"
 */
const displayTypeMap: Record<string, string> = {
  'Condomínio': 'Casa',
  'Sobrado': 'Casa',
  'Kitnet': 'Apartamento',
  'Flat': 'Apartamento',
  'Loft': 'Apartamento',
  'Studio': 'Apartamento',
  'Sala Comercial': 'Comercial',
  'Loja': 'Comercial',
  'Lote': 'Terreno',
  'Chácara': 'Sítio',
};

export function getDisplayPropertyType(tipo: string | null | undefined): string {
  if (!tipo) return '';
  return displayTypeMap[tipo] || tipo;
}

export function formatPropertyCurrency(
  value: number | null | undefined,
  currency = 'BRL',
  missingLabel = 'Não informado',
) {
  if (value == null) return missingLabel;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPropertyArea(value: number | null | undefined) {
  return value == null
    ? 'Não informado'
    : `${formatPtBRNumber(value)} m²`
}

export function formatPropertyDate(
  value?: string | null,
  withTime = false,
  missingLabel = 'Não informado',
) {
  if (!value) return missingLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(
    'pt-BR',
    withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' },
  ).format(date);
}

export function formatPropertyBoolean(value: boolean | null | undefined) {
  if (value == null) return 'Não informado';
  return value ? 'Sim' : 'Não';
}

export function getPropertyMetadataString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

export function getNullablePropertyMetadataString(value: unknown) {
  return typeof value === 'string' ? value : null;
}
