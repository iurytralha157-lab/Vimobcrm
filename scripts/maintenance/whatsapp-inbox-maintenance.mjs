// This legacy maintenance tool never owns server-split receipt families.
// Their TTL and all-or-nothing deletion belong to CleanupExpiredWebhookInbox.
// Unknown/partial markers are retained too, rather than guessing eligibility.
const outsideReceiptFamily = `
  payload #> '{__vimob_ingress,receipt_effect}' is null
  and coalesce(payload #>> '{__vimob_ingress,routing_key}', '') not like 'receipt-target:%'
`;

export const inboxMaintenanceClasses = Object.freeze({
  stale_qrcode: Object.freeze({
    predicate: `event_type = 'qrcode' and status in ('pending', 'retry')
      and created_at < $1::timestamptz and (${outsideReceiptFamily})`,
    order: 'created_at, id', cutoffKey: 'qrcode_cutoff',
  }),
  processed_older_24h: Object.freeze({
    predicate: `status = 'processed' and processed_at < $1::timestamptz
      and expires_at < now() and (${outsideReceiptFamily})`,
    order: 'processed_at, id', cutoffKey: 'processed_cutoff',
  }),
});

function definition(name) {
  if (!Object.hasOwn(inboxMaintenanceClasses, name)) throw new Error('Unknown inbox maintenance class');
  return inboxMaintenanceClasses[name];
}

export function inboxMaintenancePredicate(name, cutoffParameter = 1) {
  if (!Number.isSafeInteger(cutoffParameter) || cutoffParameter < 1 || cutoffParameter > 3)
    throw new Error('Unexpected cutoff binding');
  return definition(name).predicate.replaceAll('$1::timestamptz', `$${cutoffParameter}::timestamptz`);
}

export function buildInboxMaintenanceDeleteQuery(name) {
  const selected = definition(name);
  return `with candidates as materialized (
    select id from public.whatsapp_webhook_inbox
    where ${selected.predicate}
    order by ${selected.order} limit $2 for update skip locked
  ), deleted as (
    delete from public.whatsapp_webhook_inbox inbox using candidates
    where inbox.id = candidates.id returning inbox.id
  ) select count(*)::integer as deleted from deleted`;
}
