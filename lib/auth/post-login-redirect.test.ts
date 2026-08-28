import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLoginPath,
  getSafeInvitationPostLoginPath,
  getPostLoginPathFromSearchParams,
  getSafePostLoginPath,
  getSafeProtectedAppPath,
  isProtectedAppPath,
} from './post-login-redirect';
import {
  initializeSignedInUserContext,
  runBestEffortAuthOperation,
  shouldWaitForPostLoginRouting,
  shouldShowOrganizationSelectionLoader,
} from './frontend-auth-reliability';

const FALLBACK = '/inicio';

test('preserva qualquer destino interno protegido com query e fragmento', () => {
  const destinations = [
    '/crm/contacts?view=mine',
    '/marketing?period=30d',
    '/properties/123/edit#details',
    '/settings?tab=subscription&billing=payments&payment=abc',
    '/admin/organizations/123',
  ];

  for (const destination of destinations) {
    assert.equal(getSafePostLoginPath(destination, FALLBACK), destination);
  }
});

test('reconhece rotas protegidas por segmento completo', () => {
  assert.equal(isProtectedAppPath('/marketing'), true);
  assert.equal(isProtectedAppPath('/marketing/campaigns'), true);
  assert.equal(isProtectedAppPath('/settings'), true);
  assert.equal(isProtectedAppPath('/settings-site'), false);
  assert.equal(isProtectedAppPath('/contato'), false);
  assert.equal(isProtectedAppPath('/api/payments'), false);
});

test('bloqueia open redirect, rotas publicas, loops de autenticacao e entradas malformadas', () => {
  const rejected = [
    'https://evil.example/crm',
    '//evil.example/crm',
    '/\\evil.example/crm',
    '/login?redirectTo=/crm',
    '/cadastro',
    '/reset-password',
    '/onboarding',
    '/select-organization?redirectTo=/crm',
    '/contato',
    '/settings\nInjected: true',
    `/${'a'.repeat(5000)}`,
  ];

  for (const value of rejected) {
    assert.equal(getSafePostLoginPath(value, FALLBACK), FALLBACK, value);
    assert.equal(getSafeProtectedAppPath(value), null, value);
  }
});

test('extrai e codifica o destino usando um unico contrato', () => {
  const destination = '/settings?tab=subscription&billing=payments';
  const searchParams = new URLSearchParams({ redirectTo: destination });

  assert.equal(
    getPostLoginPathFromSearchParams(searchParams, FALLBACK),
    destination,
  );
  assert.equal(
    createLoginPath(destination, FALLBACK),
    '/login?redirectTo=%2Fsettings%3Ftab%3Dsubscription%26billing%3Dpayments',
  );
});

test('permite somente o formato canonico de convite sem classifica-lo como rota protegida', () => {
  const token = 'a'.repeat(64);
  const invitationPath = `/convite/${token}`;

  assert.equal(getSafeInvitationPostLoginPath(invitationPath), invitationPath);
  assert.equal(getSafePostLoginPath(invitationPath, FALLBACK), invitationPath);
  assert.equal(isProtectedAppPath(invitationPath), false);
  assert.equal(
    createLoginPath(invitationPath, FALLBACK),
    `/login?redirectTo=%2Fconvite%2F${token}`,
  );
});

test('rejeita variacoes de convite que poderiam ampliar o redirecionamento publico', () => {
  const token = 'b'.repeat(64);
  const rejected = [
    '/convite',
    '/convite/token-curto',
    `/convite/${token}/outra-rota`,
    `/convite/${token}?next=/crm`,
    `/convite/${token}#fragmento`,
    `/convite/${'B'.repeat(64)}`,
    `/convite/${token}%2Fcrm`,
  ];

  for (const value of rejected) {
    assert.equal(getSafeInvitationPostLoginPath(value), null, value);
    assert.equal(getSafePostLoginPath(value, FALLBACK), FALLBACK, value);
  }
});

test('limita uma operacao de autenticacao pendente sem propagar falhas', { timeout: 1_000 }, async () => {
  assert.equal(
    await runBestEffortAuthOperation(() => Promise.resolve(), 100),
    'completed',
  );
  assert.equal(
    await runBestEffortAuthOperation(() => Promise.reject(new Error('offline')), 100),
    'failed',
  );
  assert.equal(
    await runBestEffortAuthOperation(() => {
      throw new Error('falha sincrona');
    }, 100),
    'failed',
  );
  assert.equal(
    await runBestEffortAuthOperation(() => new Promise(() => undefined), 5),
    'timed_out',
  );
});

test('resolve perfil antes das organizacoes para impedir desvio da selecao multi-organizacao', async () => {
  const order: string[] = [];

  await initializeSignedInUserContext(
    async () => {
      await Promise.resolve();
      order.push('profile');
    },
    async () => {
      order.push('organizations');
    },
  );

  assert.deepEqual(order, ['profile', 'organizations']);
});

test('aguarda toda a resolucao organizacional antes do redirecionamento pos-login', () => {
  const ready = {
    authInitialized: true,
    authLoading: false,
    isInitializingOrganization: false,
    organizationsLoaded: true,
  };

  assert.equal(shouldWaitForPostLoginRouting(ready), false);
  assert.equal(shouldWaitForPostLoginRouting({ ...ready, authInitialized: false }), true);
  assert.equal(shouldWaitForPostLoginRouting({ ...ready, authLoading: true }), true);
  assert.equal(shouldWaitForPostLoginRouting({ ...ready, organizationsLoaded: false }), true);
  assert.equal(shouldWaitForPostLoginRouting({ ...ready, isInitializingOrganization: true }), true);
});

test('um erro de selecao interrompe o loader e libera a recuperacao pela interface', () => {
  const baseState = {
    authLoading: false,
    isInitializingOrganization: false,
    organizationsLoaded: true,
    shouldAutoRouteSingleOrganization: true,
  };

  assert.equal(
    shouldShowOrganizationSelectionLoader({
      ...baseState,
      hasSelectionError: false,
    }),
    true,
  );
  assert.equal(
    shouldShowOrganizationSelectionLoader({
      ...baseState,
      hasSelectionError: true,
    }),
    false,
  );
  assert.equal(
    shouldShowOrganizationSelectionLoader({
      ...baseState,
      hasSelectionError: true,
      isInitializingOrganization: true,
    }),
    false,
  );
});
