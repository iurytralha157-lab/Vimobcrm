/** User-entered BRL values and canonical decimal fields have different separators. */
export function normalizeLocaleNumberString(value: string, maxDecimals?: number) {
  const cleaned = value.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!cleaned) return '';
  // Preserve invalid input for Zod instead of silently changing its magnitude.
  if (!/^-?[\d,.]+$/.test(cleaned)) return value.trim();
  const sign = cleaned.startsWith('-') ? '-' : '';
  const unsigned = sign ? cleaned.slice(1) : cleaned;
  if (!/\d/.test(unsigned)) return value.trim();
  // Preserve pasted US-formatted numbers already accepted by the former parser.
  if (/^\d{1,3}(?:,\d{3})+\.\d*$/.test(unsigned)) {
    const [integer, fraction] = unsigned.split('.');
    const decimals = typeof maxDecimals === 'number' ? fraction.slice(0, maxDecimals) : fraction;
    return `${sign}${integer.replaceAll(',', '')}${decimals ? `.${decimals}` : ''}`;
  }
  const commas = (unsigned.match(/,/g) ?? []).length;
  const dots = (unsigned.match(/\./g) ?? []).length;
  if (commas > 1) return value.trim();
  const separator = commas ? ',' : dots === 1 ? '.' : '';
  const index = separator ? unsigned.lastIndexOf(separator) : -1;
  const integerSource = index >= 0 ? unsigned.slice(0, index) : unsigned;
  const fraction = index >= 0 ? unsigned.slice(index + 1) : '';
  const grouped = /^\d{1,3}(?:\.\d{3})+$/.test(unsigned);
  if (!commas && (dots > 1 || (dots === 1 && fraction.length === 3 && grouped))) {
    return grouped ? `${sign}${unsigned.replaceAll('.', '')}` : value.trim();
  }
  if ((integerSource && !/^\d+$/.test(integerSource) && !/^\d{1,3}(?:\.\d{3})+$/.test(integerSource))
    || (fraction && !/^\d+$/.test(fraction))) return value.trim();
  const integer = integerSource.replaceAll('.', '') || '0';
  const decimals = typeof maxDecimals === 'number' ? fraction.slice(0, maxDecimals) : fraction;
  return decimals ? `${sign}${integer}.${decimals}` : `${sign}${integer}`;
}

function normalizeCanonicalNumber(value: string) {
  const trimmed = value.trim();
  // Model/mapping use dot-decimal strings. Three decimal digits are not grouping.
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return trimmed;
  return normalizeLocaleNumberString(trimmed);
}

export function parseLocaleNumber(value: string) {
  if (!value.trim()) return null;
  const normalized = normalizeCanonicalNumber(value);
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return Number.NaN;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export const parseCurrencyInput = (value: string) => normalizeLocaleNumberString(value);
export const parseDecimalInput = (value: string) => value;

export function formatCurrencyEditable(value: string) {
  if (!value) return '';
  const normalized = normalizeCanonicalNumber(value);
  if (!Number.isFinite(parseLocaleNumber(value))) return value;
  const [integer = '0', fraction] = normalized.split('.');
  const formattedInteger = Number(integer || '0').toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  return fraction === undefined ? formattedInteger : `${formattedInteger},${fraction}`;
}
