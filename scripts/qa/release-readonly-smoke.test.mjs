import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertReadOnlyTarget,
  buildProtectedWebChecks,
  normalizeExpectedReleaseSha,
  routeFixturePath,
  runReleaseReadOnlySmoke,
  summarizeReleaseReadOnlySmoke,
} from './release-readonly-smoke.mjs';

test('refuses remote targets without an explicit read-risk acknowledgement', () => {
  assert.throws(
    () => assertReadOnlyTarget('https://app.example.test', false),
    /acknowledge-upstream-read-risk/,
  );
  assert.equal(
    assertReadOnlyTarget('https://app.example.test', true),
    'https://app.example.test',
  );
  assert.equal(assertReadOnlyTarget('http://127.0.0.1:3000', false), 'http://127.0.0.1:3000');
});

test('rejects origins with credentials or non-http protocols', () => {
  assert.throws(() => assertReadOnlyTarget('ftp://example.test', true), /protocol/);
  assert.throws(() => assertReadOnlyTarget('https://user:secret@example.test', true), /credentials/);
  assert.throws(() => assertReadOnlyTarget('https://example.test?token=secret', true), /query/);
});

test('accepts only a full expected release SHA', () => {
  const uppercaseSha = '0123456789ABCDEF0123456789ABCDEF01234567';
  assert.equal(normalizeExpectedReleaseSha(''), null);
  assert.equal(normalizeExpectedReleaseSha(` ${uppercaseSha} `), uppercaseSha.toLowerCase());
  assert.throws(() => normalizeExpectedReleaseSha('a'.repeat(39)), /40-character/);
  assert.throws(() => normalizeExpectedReleaseSha(`${'a'.repeat(39)}g`), /40-character/);
});

test('materializes dynamic route fixtures without escaping the intended path', () => {
  assert.equal(routeFixturePath('/properties/[id]/edit'), '/properties/00000000-0000-4000-8000-000000000000/edit');
  assert.equal(routeFixturePath('/sites/[slug]/[[...path]]'), '/sites/00000000-0000-4000-8000-000000000000/audit');
  assert.equal(routeFixturePath('/imoveis/[[...path]]'), '/imoveis/audit');
});

test('builds the complete protected authorization denominator from the inventory shape', () => {
  const checks = buildProtectedWebChecks([
    { access: 'protected', url: '/inicio' },
    { access: 'protected', url: '/properties/[id]' },
    { access: 'public', url: '/login' },
  ]);

  assert.deepEqual(checks.map((check) => check.route), ['/inicio', '/properties/[id]']);
  assert.equal(checks[1].path, '/properties/00000000-0000-4000-8000-000000000000');
  assert.deepEqual(checks[0].locations, ['/login']);
  assert.deepEqual(checks[0].locationPrefixes, ['/login?redirectTo=']);
});

test('uses GET only, keeps redirects manual, and reports contract drift without response bodies', async () => {
  const calls = [];
  const expectedReleaseSha = 'a'.repeat(40);
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const pathname = new URL(url).pathname;
    if (pathname === '/inicio') {
      return new Response('', {
        status: 307,
        headers: { location: '/login', 'x-vimob-release-sha': expectedReleaseSha },
      });
    }
    if (pathname === '/healthz') {
      return Response.json({ status: 'ok', release: expectedReleaseSha, secret: 'must-not-be-reported' });
    }
    if (pathname === '/readyz') return Response.json({ status: 'ready', release: expectedReleaseSha });
    if (pathname.startsWith('/v1/public/onboarding/')) {
      if (pathname.endsWith('/plans')) return Response.json([]);
      return new Response('', { status: 405, headers: { allow: 'POST' } });
    }
    if (pathname === '/marketing') {
      return new Response('missing', {
        status: 404,
        headers: { 'x-vimob-release-sha': expectedReleaseSha },
      });
    }
    if (pathname === '/onboarding') {
      return new Response('', {
        status: 307,
        headers: { location: '/cadastro', 'x-vimob-release-sha': expectedReleaseSha },
      });
    }
    return new Response('<html></html>', {
      status: 200,
      headers: {
        'content-type': 'text/html',
        'x-vimob-release-sha': expectedReleaseSha,
      },
    });
  };

  const report = await runReleaseReadOnlySmoke({
    webOrigin: 'http://127.0.0.1:3000',
    apiOrigin: 'http://127.0.0.1:8081',
    protectedRoutes: [
      { access: 'protected', url: '/inicio' },
      { access: 'protected', url: '/marketing' },
    ],
    fetchImpl,
    timeoutMs: 1_000,
    concurrency: 3,
    expectedReleaseSha,
  });

  assert.equal(report.counts.failed, 1);
  assert.equal(report.expectedReleaseSha, expectedReleaseSha);
  assert.equal(report.failures[0].route, '/marketing');
  assert.equal('body' in report.failures[0], false);
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.redirect, 'manual');
    assert.equal(call.init.headers.authorization, undefined);
  }
});

test('summary keeps release evidence and omits full successful results', () => {
  const report = {
    schemaVersion: 1,
    mode: 'GET-only',
    targets: { web: 'http://127.0.0.1:3000', api: 'http://127.0.0.1:8081' },
    expectedReleaseSha: null,
    counts: { total: 2, passed: 1, failed: 1, byGroup: {} },
    failures: [{ group: 'public-web', path: '/missing', pass: false }],
    results: [
      { group: 'public-web', path: '/', pass: true },
      { group: 'public-web', path: '/missing', pass: false },
    ],
  };

  const summary = summarizeReleaseReadOnlySmoke(report);

  assert.deepEqual(Object.keys(summary), [
    'schemaVersion',
    'mode',
    'targets',
    'expectedReleaseSha',
    'counts',
    'failures',
  ]);
  assert.deepEqual(summary.failures, report.failures);
  assert.equal('results' in summary, false);
});
