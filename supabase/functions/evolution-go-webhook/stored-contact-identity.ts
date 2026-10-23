type AliasRead = PromiseLike<{ data: unknown; error: unknown }> & {
  eq(column: string, value: unknown): AliasRead;
  limit(limit: number): AliasRead;
};
type AliasClient = { from(table: 'whatsapp_contact_identity_aliases'): { select(columns: string): AliasRead } };
type RecordValue = Record<string, unknown>;
const pnReason = 'whatsapp_contact_pn_conflict';
const maxIdentityAliases = 128;

export function isStoredContactPNConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as RecordValue;
  return value.message === pnReason && (value.code === '23514' || error instanceof Error);
}

// Exact physical-JID references only. Neither phone nor raw provider metadata
// discovers a route/card. Bounded reads fail closed on oversized legacy graphs.
export async function guardStoredContactIdentity(
  client: AliasClient,
  session: RecordValue,
  conversation: RecordValue,
  incomingValues: unknown[],
  conflicts: (values: unknown[]) => boolean,
) {
  const values: unknown[] = [...incomingValues, conversation.remote_jid, conversation.contact_phone];
  if (conflicts(values)) throw new Error(pnReason);
  const read = (column: string) => client.from('whatsapp_contact_identity_aliases')
    .select('alias_jid,canonical_jid,contact_phone')
    .eq('organization_id', session.organization_id).eq('session_id', session.id)
    .eq(column, conversation.remote_jid).limit(maxIdentityAliases + 1);
  const results = await Promise.all([read('alias_jid'), read('canonical_jid')]);
  for (const result of results) {
    if (result.error) throw result.error;
    if (!Array.isArray(result.data) || result.data.length > maxIdentityAliases) {
      throw new Error('whatsapp_contact_identity_evidence_invalid');
    }
    for (const row of result.data) {
      if (!row || typeof row !== 'object') throw new Error('whatsapp_contact_identity_evidence_invalid');
      const alias = row as RecordValue;
      for (const value of [alias.alias_jid, alias.canonical_jid]) {
        if (typeof value === 'string' && /@(s\.whatsapp\.net|c\.us)$/i.test(value.trim())) values.push(value);
      }
      values.push(alias.contact_phone);
    }
  }
  if (conflicts(values)) throw new Error(pnReason);
}
