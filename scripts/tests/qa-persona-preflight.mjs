#!/usr/bin/env node

const DEFAULT_TIMEOUT_MS = 10_000;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseAPIOrigin(rawURL) {
  const url = new URL(rawURL);
  const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);

  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('QA_API_URL must be an origin without credentials, path, query, or fragment.');
  }
  if (!isLoopback && url.protocol !== 'https:') {
    throw new Error('QA_API_URL must use HTTPS outside loopback development.');
  }

  return url.origin;
}

async function readJSON(origin, path, { token, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers({ Accept: 'application/json' });
  if (token) headers.set('Authorization', `Bearer ${token}`);

  try {
    const response = await fetch(new URL(path, origin), {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code = payload && typeof payload === 'object' && typeof payload.code === 'string'
        ? ` (${payload.code})`
        : '';
      throw new Error(`GET ${path} returned HTTP ${response.status}${code}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function assertStatus(payload, expected, endpoint) {
  if (!payload || payload.status !== expected) {
    throw new Error(`${endpoint} did not report status=${expected}`);
  }
}

function assertSuperAdmin(payload) {
  if (!payload?.context || payload.context.isSuperAdmin !== true) {
    throw new Error('/v1/me did not confirm context.isSuperAdmin=true');
  }
  if (typeof payload.context.userId !== 'string' || !payload.context.userId) {
    throw new Error('/v1/me did not return an authenticated userId');
  }
}

function assertNoRunLabelCollision(payload, runLabel) {
  if (!payload || !Array.isArray(payload.data)) {
    throw new Error('/v1/admin/organizations returned an invalid envelope');
  }

  const normalizedLabel = runLabel.trim().toLocaleLowerCase('pt-BR');
  const collision = payload.data.some((organization) => (
    typeof organization?.name === 'string'
      && organization.name.trim().toLocaleLowerCase('pt-BR') === normalizedLabel
  ));
  if (collision) {
    throw new Error(`Run label collision: an organization named "${runLabel}" already exists`);
  }
}

export async function runPreflight({
  apiURL = requiredEnv('QA_API_URL'),
  accessToken = requiredEnv('QA_SUPERADMIN_ACCESS_TOKEN'),
  runLabel = requiredEnv('QA_PERSONA_RUN_LABEL'),
} = {}) {
  const origin = parseAPIOrigin(apiURL);
  if (runLabel.length < 12 || runLabel.length > 180) {
    throw new Error('QA_PERSONA_RUN_LABEL must contain 12 to 180 characters.');
  }

  const health = await readJSON(origin, '/healthz');
  assertStatus(health, 'ok', '/healthz');

  const readiness = await readJSON(origin, '/readyz');
  assertStatus(readiness, 'ready', '/readyz');

  const me = await readJSON(origin, '/v1/me', { token: accessToken });
  assertSuperAdmin(me);

  const organizations = await readJSON(
    origin,
    `/v1/admin/organizations?search=${encodeURIComponent(runLabel)}`,
    { token: accessToken },
  );
  assertNoRunLabelCollision(organizations, runLabel);

  return {
    ok: true,
    apiOrigin: origin,
    runLabel,
    gates: {
      health: 'ok',
      readiness: 'ready',
      superadmin: true,
      runLabelAvailable: true,
    },
  };
}

const isCLI = process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href;

if (isCLI) {
  runPreflight()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`QA persona preflight failed: ${message}\n`);
      process.exitCode = 1;
    });
}

