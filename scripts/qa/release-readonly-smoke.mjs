#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const REDIRECT_STATUSES = new Set([302, 303, 307, 308]);
const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const RELEASE_HEADER = 'x-vimob-release-sha';

export const PUBLIC_WEB_CHECKS = Object.freeze([
  { path: '/', statuses: [200], contentType: 'text/html' },
  { path: '/cadastro', statuses: [200], contentType: 'text/html' },
  { path: '/confirmar-email', statuses: [200], contentType: 'text/html' },
  { path: '/contato', statuses: [200], contentType: 'text/html' },
  { path: '/exclusao-de-dados', statuses: [200], contentType: 'text/html' },
  { path: '/favoritos', statuses: [200], contentType: 'text/html' },
  { path: '/help', statuses: [200], contentType: 'text/html' },
  { path: '/help/invalid-audit-slug', statuses: [200], contentType: 'text/html' },
  { path: '/imoveis', statuses: [200], contentType: 'text/html' },
  { path: '/imovel/invalid-audit-code', statuses: [200], contentType: 'text/html' },
  { path: '/login', statuses: [200], contentType: 'text/html' },
  { path: '/onboarding', statuses: [307, 308], locationPrefix: '/cadastro' },
  { path: '/politica-de-privacidade', statuses: [200], contentType: 'text/html' },
  { path: '/reset-password', statuses: [200], contentType: 'text/html' },
  { path: '/sites/invalid-audit-slug', statuses: [200], contentType: 'text/html' },
  { path: '/sobre', statuses: [200], contentType: 'text/html' },
  { path: '/termos-de-uso', statuses: [200], contentType: 'text/html' },
  { path: '/convite/invalid-audit-token', statuses: [200], contentType: 'text/html' },
]);

export const PUBLIC_API_CHECKS = Object.freeze([
  { path: '/healthz', statuses: [200], jsonStatus: 'ok' },
  { path: '/readyz', statuses: [200], jsonStatus: 'ready' },
  { path: '/v1/public/onboarding/plans', statuses: [200] },
  { path: '/v1/public/onboarding/signup', statuses: [405], allow: 'POST' },
  { path: '/v1/public/onboarding/validate-step', statuses: [405], allow: 'POST' },
  { path: '/v1/public/onboarding/signup/recovery', statuses: [405], allow: 'POST' },
  { path: '/v1/public/onboarding/email-confirmation/resend', statuses: [405], allow: 'POST' },
]);

export function routeFixturePath(route) {
  return route
    .replace(/\[\[\.\.\.path\]\]/g, 'audit')
    .replace(/\[\.\.\.path\]/g, 'audit')
    .replace(/\[[^\]]+\]/g, '00000000-0000-4000-8000-000000000000');
}

export function buildProtectedWebChecks(routes) {
  return routes
    .filter((route) => route?.access === 'protected' && typeof route.url === 'string')
    .map((route) => ({
      path: routeFixturePath(route.url),
      route: route.url,
      statuses: [...REDIRECT_STATUSES],
      locations: ['/login'],
      locationPrefixes: ['/login?redirectTo='],
    }));
}

export function assertReadOnlyTarget(origin, acknowledged) {
  const parsed = new URL(origin);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported smoke target protocol: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Smoke target origins cannot contain credentials, query parameters, or fragments.');
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) && !acknowledged) {
    throw new Error(
      `Refusing remote read-only smoke against ${parsed.origin} without --acknowledge-upstream-read-risk.`,
    );
  }
  return parsed.origin;
}

export function normalizeExpectedReleaseSha(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('Expected release SHA must be a string.');

  const normalized = value.trim().toLowerCase();
  if (!RELEASE_SHA_PATTERN.test(normalized)) {
    throw new Error('Expected release SHA must be a full 40-character hexadecimal commit SHA.');
  }
  return normalized;
}

async function probe(fetchImpl, origin, check, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = new URL(check.path, `${origin}/`);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      headers: {
        accept: check.jsonStatus ? 'application/json' : 'text/html,application/json;q=0.8',
        'user-agent': 'VimobReleaseReadOnlySmoke/1.0',
      },
      signal: controller.signal,
    });
    const location = response.headers.get('location') || '';
    const contentType = response.headers.get('content-type') || '';
    const allow = response.headers.get('allow') || '';
    const releaseHeader = response.headers.get(RELEASE_HEADER) || '';
    const failures = [];

    if (!check.statuses.includes(response.status)) {
      failures.push(`status ${response.status}; expected ${check.statuses.join('/')}`);
    }
    const expectedLocations = Array.isArray(check.locations) ? check.locations : [];
    const expectedLocationPrefixes = [
      ...(check.locationPrefix ? [check.locationPrefix] : []),
      ...(Array.isArray(check.locationPrefixes) ? check.locationPrefixes : []),
    ];
    const hasLocationContract = expectedLocations.length > 0 || expectedLocationPrefixes.length > 0;
    const locationMatches = expectedLocations.includes(location)
      || expectedLocationPrefixes.some((prefix) => location.startsWith(prefix));
    if (hasLocationContract && !locationMatches) {
      const expected = [
        ...expectedLocations.map((value) => `exact ${value}`),
        ...expectedLocationPrefixes.map((value) => `prefix ${value}`),
      ].join(' or ');
      failures.push(`location ${location || '<missing>'}; expected ${expected}`);
    }
    if (check.contentType && !contentType.toLowerCase().includes(check.contentType)) {
      failures.push(`content-type ${contentType || '<missing>'}; expected ${check.contentType}`);
    }
    if (check.allow && !allow.toUpperCase().split(/\s*,\s*/).includes(check.allow)) {
      failures.push(`allow ${allow || '<missing>'}; expected ${check.allow}`);
    }
    if (check.releaseHeader && releaseHeader.toLowerCase() !== check.releaseHeader) {
      failures.push(
        `${RELEASE_HEADER} ${releaseHeader || '<missing>'}; expected ${check.releaseHeader}`,
      );
    }
    if ((check.jsonStatus || check.jsonRelease) && response.ok) {
      const payload = await response.json().catch(() => null);
      if (payload?.status !== check.jsonStatus) {
        failures.push(`json status ${String(payload?.status)}; expected ${check.jsonStatus}`);
      }
      if (check.jsonRelease && payload?.release !== check.jsonRelease) {
        failures.push(`json release ${String(payload?.release)}; expected ${check.jsonRelease}`);
      }
    }

    return {
      group: check.group,
      route: check.route,
      path: check.path,
      status: response.status,
      location,
      pass: failures.length === 0,
      failures,
    };
  } catch (error) {
    return {
      group: check.group,
      route: check.route,
      path: check.path,
      status: 0,
      location: '',
      pass: false,
      failures: [error instanceof Error ? error.message : 'request failed'],
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function runReleaseReadOnlySmoke({
  webOrigin,
  apiOrigin,
  protectedRoutes,
  acknowledged = false,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000,
  concurrency = 6,
  expectedReleaseSha,
}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  const normalizedWebOrigin = assertReadOnlyTarget(webOrigin, acknowledged);
  const normalizedAPIOrigin = assertReadOnlyTarget(apiOrigin, acknowledged);
  const normalizedExpectedReleaseSha = normalizeExpectedReleaseSha(expectedReleaseSha);
  const checks = [
    ...PUBLIC_WEB_CHECKS.map((check) => ({
      ...check,
      group: 'public-web',
      origin: normalizedWebOrigin,
      releaseHeader: normalizedExpectedReleaseSha,
    })),
    ...buildProtectedWebChecks(protectedRoutes).map((check) => ({
      ...check,
      group: 'protected-auth-boundary',
      origin: normalizedWebOrigin,
      releaseHeader: normalizedExpectedReleaseSha,
    })),
    ...PUBLIC_API_CHECKS.map((check) => ({
      ...check,
      group: 'public-api',
      origin: normalizedAPIOrigin,
      jsonRelease: check.jsonStatus ? normalizedExpectedReleaseSha : null,
    })),
  ];
  const results = await mapWithConcurrency(checks, concurrency, (check) => (
    probe(fetchImpl, check.origin, check, timeoutMs)
  ));
  const failures = results.filter((result) => !result.pass);

  return {
    schemaVersion: 1,
    mode: 'GET-only',
    targets: {
      web: normalizedWebOrigin,
      api: normalizedAPIOrigin,
    },
    expectedReleaseSha: normalizedExpectedReleaseSha,
    counts: {
      total: results.length,
      passed: results.length - failures.length,
      failed: failures.length,
      byGroup: Object.fromEntries(
        ['public-web', 'protected-auth-boundary', 'public-api'].map((group) => {
          const grouped = results.filter((result) => result.group === group);
          return [group, {
            total: grouped.length,
            passed: grouped.filter((result) => result.pass).length,
            failed: grouped.filter((result) => !result.pass).length,
          }];
        }),
      ),
    },
    failures,
    results,
  };
}

export function summarizeReleaseReadOnlySmoke(report) {
  return {
    schemaVersion: report.schemaVersion,
    mode: report.mode,
    targets: report.targets,
    expectedReleaseSha: report.expectedReleaseSha,
    counts: report.counts,
    failures: report.failures,
  };
}

function parseArguments(argv) {
  const values = {
    webOrigin: '',
    apiOrigin: '',
    inventory: path.resolve('docs/audits/crm-surface-inventory.json'),
    acknowledged: false,
    summary: false,
    expectedReleaseSha: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--web-origin') values.webOrigin = argv[++index] || '';
    else if (argument === '--api-origin') values.apiOrigin = argv[++index] || '';
    else if (argument === '--inventory') values.inventory = path.resolve(argv[++index] || '');
    else if (argument === '--acknowledge-upstream-read-risk') values.acknowledged = true;
    else if (argument === '--summary') values.summary = true;
    else if (argument === '--expected-release-sha') values.expectedReleaseSha = argv[++index] || '';
    else if (argument === '--help') values.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return values;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/qa/release-readonly-smoke.mjs --web-origin URL --api-origin URL [options]',
    '',
    'Options:',
    '  --inventory PATH                      CRM surface inventory JSON',
    '  --acknowledge-upstream-read-risk      Required for non-loopback targets',
    '  --summary                             Emit compact JSON without successful results',
    '  --expected-release-sha SHA            Require the same full SHA from Web and API',
    '  --help                                Show this help',
    '',
    'The smoke sends GET requests only, never follows redirects, and never sends credentials.',
  ].join('\n');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.webOrigin || !options.apiOrigin) throw new Error('Both --web-origin and --api-origin are required.');

  const inventory = JSON.parse(await readFile(options.inventory, 'utf8'));
  const report = await runReleaseReadOnlySmoke({
    webOrigin: options.webOrigin,
    apiOrigin: options.apiOrigin,
    protectedRoutes: Array.isArray(inventory.routes) ? inventory.routes : [],
    acknowledged: options.acknowledged,
    expectedReleaseSha: options.expectedReleaseSha,
  });
  const output = options.summary ? summarizeReleaseReadOnlySmoke(report) : report;
  process.stdout.write(`${JSON.stringify(output, null, options.summary ? undefined : 2)}\n`);
  if (report.counts.failed > 0) process.exitCode = 1;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
