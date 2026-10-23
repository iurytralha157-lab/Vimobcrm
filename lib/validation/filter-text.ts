import { z } from 'zod';

export const MAX_LEAD_SOURCE_FILTER_LENGTH = 4096;

// Go and OpenAPI count Unicode code points; String.length counts UTF-16 units.
export function filterTextSchema(maxLength: number, minLength = 0) {
  return z.string().trim().refine(
    (value) => Array.from(value).length >= minLength && Array.from(value).length <= maxLength && !value.includes('\0'),
    `Informe entre ${minLength} e ${maxLength} caracteres válidos`,
  );
}
