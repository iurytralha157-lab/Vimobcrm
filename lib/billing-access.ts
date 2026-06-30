const BILLING_BLOCKED_STATUSES = new Set([
  'suspended',
  'suspenso',
  'overdue',
  'past_due',
  'blocked',
  'cancelled',
  'canceled',
  'cancelado',
  'cancelada',
]);

export function isBillingBlockedStatus(status: unknown) {
  return BILLING_BLOCKED_STATUSES.has(String(status || '').trim().toLowerCase());
}

export function isBillingAccessRoute(pathname: string, search = '') {
  if (pathname.startsWith('/checkout/')) return true;
  if (pathname === '/assinatura') return true;
  if (pathname !== '/settings') return false;

  const params = new URLSearchParams(search);
  return params.get('tab') === 'subscription';
}
