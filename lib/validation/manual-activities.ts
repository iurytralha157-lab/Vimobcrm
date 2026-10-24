import { z } from 'zod';

const manualTypes = ['note', 'call', 'call_initiated', 'email', 'message'] as const;
// Match Go strings.TrimSpace: Unicode White_Space includes NEL, excludes BOM.
const trim = (value: string) => value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
const text = (limit: number) => z.string().transform(trim)
  .refine(value => !value.includes('\u0000'), 'Remova caracteres inválidos do texto.')
  .refine(value => Array.from(value).length <= limit, `Use até ${limit} caracteres.`)
  .refine(value => !Array.from(value).some(character => character.length === 1
    && character.charCodeAt(0) >= 0xD800 && character.charCodeAt(0) <= 0xDFFF), 'Texto Unicode inválido.');
const channel = <T extends [string, ...string[]]>(values: T) => z.string().transform(trim).pipe(z.enum(values));
const metadataByType = {
  note: z.object({}).strict(),
  call_initiated: z.object({ phone: text(80).optional(), channel: channel(['phone']).optional() }).strict(),
  call: z.object({ phone: text(80).optional(), channel: channel(['call', 'phone']).optional(),
    outcome: channel(['answered', 'not_answered', 'invalid_number', 'busy', 'scheduled']).optional(), notes: text(2000).optional() }).strict(),
  email: z.object({ channel: channel(['email']).optional(), outcome: channel(['replied', 'not_replied', 'bounced']).optional(),
    notes: text(2000).optional() }).strict(),
  message: z.object({ channel: channel(['message', 'whatsapp']).optional(),
    outcome: channel(['replied', 'seen_no_reply', 'not_seen', 'no_whatsapp', 'scheduled']).optional(), notes: text(2000).optional() }).strict(),
};

/** Public activity writes record manual contact facts, never system transitions.
 * Read schemas deliberately retain historical types and producer metadata. */
export const manualActivityCreateInputSchema = z.object({
  lead_id: z.string().transform(trim).pipe(z.string().regex(z.regexes.guid, "Invalid uuid")).transform(value => value.toLowerCase()),
  type: z.string().transform(trim).pipe(z.enum(manualTypes)),
  content: text(2000).nullish().transform(value => value || null),
  metadata: z.unknown().optional(),
}).strict().transform((value, context) => {
  const metadata = metadataByType[value.type].safeParse(value.metadata ?? {});
  if (!metadata.success) {
    for (const issue of metadata.error.issues) context.addIssue({ ...issue, path: ['metadata', ...issue.path] });
    return z.NEVER;
  }
  return { ...value, metadata: metadata.data };
});
export type ManualActivityCreateInput = z.infer<typeof manualActivityCreateInputSchema>;
