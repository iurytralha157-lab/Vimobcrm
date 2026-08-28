import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const E2E_ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
export const E2E_TEAM_ID = '22222222-2222-4222-8222-222222222222';
export const E2E_PIPELINE_ID = '33333333-3333-4333-8333-333333333333';
export const E2E_STAGE_ID = '44444444-4444-4444-8444-444444444444';
export const E2E_STAGE_CADENCE_ID = '44444444-4444-4444-8444-444444444445';
export const E2E_STAGE_ATTENTION_ID = '44444444-4444-4444-8444-444444444446';
export const E2E_STAGE_FINAL_ID = '44444444-4444-4444-8444-444444444447';
export const E2E_OUTSIDE_TEAM_ID = '55555555-5555-4555-8555-555555555555';
export const E2E_PROPERTY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const E2E_ATTENTION_POLICY_ID = 'abababab-abab-4bab-8bab-abababababab';
export const E2E_ATTENTION_POLICY_KEY = 'acacacac-acac-4cac-8cac-acacacacacac';

export const E2E_ATTENTION_ITEMS = {
  acknowledge: 'adadadad-adad-4dad-8dad-adadadadadad',
  snooze: 'aeaeaeae-aeae-4eae-8eae-aeaeaeaeaeae',
  administrativeResolve: 'afafafaf-afaf-4faf-8faf-afafafafafaf',
  shadow: 'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0',
} as const;

export const E2E_LEADS = {
  leaderOwn: '66666666-6666-4666-8666-666666666666',
  team: '77777777-7777-4777-8777-777777777777',
  userOwn: '88888888-8888-4888-8888-888888888888',
  outside: '99999999-9999-4999-8999-999999999999',
} as const;

export const E2E_CADENCE_LEADS = {
  primary: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  lifecycle: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  legacy: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
} as const;

export const E2E_PASSWORD = 'VimobE2e!2026';

export const E2E_USERS = {
  admin: {
    email: 'admin.e2e@vimob.test',
    name: 'Administrador E2E',
    memberRole: 'admin',
    userRole: 'admin',
  },
  leader: {
    email: 'lider.e2e@vimob.test',
    name: 'Lider E2E',
    memberRole: 'user',
    userRole: 'user',
  },
  user: {
    email: 'usuario.e2e@vimob.test',
    name: 'Usuario E2E',
    memberRole: 'user',
    userRole: 'user',
  },
} as const;

export type E2EUserKey = keyof typeof E2E_USERS;

type E2EConfig = {
  baseURL: string;
  apiURL: string;
  supabaseURL: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  supabaseJWTSecret: string;
  databaseURL: string;
};

let envLoaded = false;
let localSupabaseStatus: LocalSupabaseStatus | null | undefined;

type LocalSupabaseStatus = {
  API_URL: string;
  DB_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
  JWT_SECRET?: string;
};

const REMOTE_E2E_CONFIRMATION = 'isolated-staging-only';
const PRODUCTION_E2E_HOSTS = new Set([
  'app.vimobcrm.com.br',
  'api.vimobcrm.com.br',
  'supabase.vimobcrm.com.br',
  'iemalzlfnbouobyjwlwi.supabase.co',
  'db.iemalzlfnbouobyjwlwi.supabase.co',
]);

export function loadE2EEnvFiles(rootDir = process.cwd()) {
  if (envLoaded) return;
  envLoaded = true;

  for (const fileName of ['.env.e2e.local', '.env.e2e']) {
    const filePath = path.join(rootDir, fileName);
    if (!fs.existsSync(filePath)) continue;

    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = normalizeEnvValue(trimmed.slice(separatorIndex + 1));
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

export function getE2EConfig(): E2EConfig {
  loadE2EEnvFiles();

  const baseURL = readEnv('E2E_BASE_URL', 'http://127.0.0.1:3100');
  const apiURL = readEnv('E2E_VIMOB_API_URL', 'http://127.0.0.1:8181');
  const configuredSupabaseURL = readEnv('E2E_SUPABASE_URL', 'http://127.0.0.1:55321');
  const configuredDatabaseURL = readEnv(
    'E2E_DATABASE_URL',
    'postgresql://postgres:postgres@127.0.0.1:55322/postgres',
  );
  assertSafeE2ETargets({
    baseURL,
    apiURL,
    supabaseURL: configuredSupabaseURL,
    databaseURL: configuredDatabaseURL,
  });

  const status = isLoopbackURL(configuredSupabaseURL)
    ? getLocalSupabaseStatus()
    : null;

  return {
    baseURL,
    apiURL,
    supabaseURL: status?.API_URL || configuredSupabaseURL,
    supabaseAnonKey: status?.ANON_KEY || readEnv('E2E_SUPABASE_ANON_KEY'),
    supabaseServiceRoleKey: status?.SERVICE_ROLE_KEY || readEnv('E2E_SUPABASE_SERVICE_ROLE_KEY'),
    // Prefer the local JWKS endpoint. The legacy JWT secret can coexist with
    // asymmetric signing keys and must be used only when explicitly requested.
    supabaseJWTSecret: readEnv('E2E_SUPABASE_JWT_SECRET'),
    databaseURL: status?.DB_URL || configuredDatabaseURL,
  };
}

export function requireE2ESupabaseConfig() {
  const config = getE2EConfig();
  const missing = [
    ['E2E_SUPABASE_ANON_KEY', config.supabaseAnonKey],
    ['E2E_SUPABASE_SERVICE_ROLE_KEY', config.supabaseServiceRoleKey],
  ].flatMap(([name, value]) => (value ? [] : [name]));

  if (missing.length > 0) {
    throw new Error(
      [
        `Missing E2E environment values: ${missing.join(', ')}.`,
        'Create .env.e2e.local with values from `supabase status -o env` before running Playwright.',
      ].join(' '),
    );
  }

  assertSafeE2ETargets(config);
  return config;
}

export function buildE2EProcessEnv(): Record<string, string> {
  const config = getE2EConfig();
  const trimmedSupabaseURL = config.supabaseURL.replace(/\/+$/, '');
  const env: Record<string, string | undefined> = {
    ...process.env,
    API_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: new URL(config.apiURL).port || '8081',
    API_CORS_ALLOWED_ORIGINS: `${config.baseURL},http://localhost:3000,http://127.0.0.1:3000`,
    AUTOMATION_RUNTIME_WORKER_ENABLED: 'false',
    AUTOMATION_INACTIVITY_WORKER_ENABLED: 'false',
    ASAAS_RECONCILIATION_ENABLED: 'false',
    GRUPO_OLX_IMPORT_REPORT_WORKER_ENABLED: 'false',
    META_CONVERSION_FEEDBACK_WORKER_ENABLED: 'false',
    META_WEBHOOK_WORKER_ENABLED: 'false',
    NOTIFICATION_DISPATCH_WORKER_ENABLED: 'false',
    PROPERTY_DEVELOPMENT_RESERVATION_WORKER_ENABLED: 'false',
    PROPERTY_PUBLICATION_WORKER_ENABLED: 'false',
    WHATSAPP_AI_WORKER_ENABLED: 'false',
    WHATSAPP_AI_FOLLOW_UP_WORKER_ENABLED: 'false',
    WHATSAPP_OUTBOX_WORKER_ENABLED: 'false',
    WHATSAPP_WEBHOOK_WORKER_ENABLED: 'false',
    WHATSAPP_SESSION_SUPERVISOR_ENABLED: 'false',
    NEXT_PUBLIC_VIMOB_API_URL: config.apiURL,
    VIMOB_API_URL: config.apiURL,
    NEXT_DIST_DIR: '.next-e2e',
    NEXT_PUBLIC_SUPABASE_URL: config.supabaseURL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: config.supabaseAnonKey,
    SUPABASE_PROJECT_URL: config.supabaseURL,
    SUPABASE_URL: config.supabaseURL,
    SUPABASE_SERVICE_ROLE_KEY: config.supabaseServiceRoleKey,
    SUPABASE_SECRET_KEY: config.supabaseServiceRoleKey,
    SUPABASE_JWT_ISSUER: `${trimmedSupabaseURL}/auth/v1`,
    SUPABASE_JWT_AUDIENCE: 'authenticated',
    DATABASE_URL: config.databaseURL,
    FINANCIAL_ORGANIZATION_IDS: E2E_ORGANIZATION_ID,
    NEXT_PUBLIC_FINANCIAL_ORGANIZATION_IDS: E2E_ORGANIZATION_ID,
  };

  if (config.supabaseJWTSecret) {
    env.SUPABASE_JWT_SECRET = config.supabaseJWTSecret;
  } else {
    env.SUPABASE_JWKS_URL = `${trimmedSupabaseURL}/auth/v1/.well-known/jwks.json`;
  }

  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function readEnv(name: string, fallback = '') {
  return (process.env[name] || fallback).trim();
}

function normalizeEnvValue(value: string) {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;

  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed[trimmed.length - 1] === quote) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function getLocalSupabaseStatus(): LocalSupabaseStatus {
  if (localSupabaseStatus) return localSupabaseStatus;

  const isWindows = process.platform === 'win32';
  const executable = isWindows ? process.env.ComSpec || 'cmd.exe' : 'npx';
  const args = isWindows
    ? ['/d', '/s', '/c', 'npx.cmd supabase status -o json']
    : ['supabase', 'status', '-o', 'json'];
  let output = '';
  try {
    output = execFileSync(executable, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
  } catch {
    throw new Error(
      'Local Supabase is not available. Start it before running the isolated E2E suite.',
    );
  }

  const status = JSON.parse(output) as Partial<LocalSupabaseStatus>;
  if (!status.API_URL || !status.DB_URL || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
    throw new Error('Local Supabase status did not return the required E2E credentials.');
  }

  assertSafeE2ETargets({
    baseURL: readEnv('E2E_BASE_URL', 'http://127.0.0.1:3100'),
    apiURL: readEnv('E2E_VIMOB_API_URL', 'http://127.0.0.1:8181'),
    supabaseURL: status.API_URL,
    databaseURL: status.DB_URL,
  });
  localSupabaseStatus = status as LocalSupabaseStatus;
  return localSupabaseStatus;
}

function isLoopbackURL(value: string) {
  const { hostname } = new URL(value);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
}

function assertSafeE2ETargets(targets: Pick<E2EConfig, 'baseURL' | 'apiURL' | 'supabaseURL' | 'databaseURL'>) {
  const { baseURL, apiURL, supabaseURL, databaseURL } = targets;
  const allowRemote = process.env.E2E_ALLOW_REMOTE === 'true';
  const isLocalSupabase = isLoopbackURL(supabaseURL);
  const isLocalDatabase = isLoopbackURL(databaseURL);

  const targetHosts = [baseURL, apiURL, supabaseURL, databaseURL]
    .map((value) => new URL(value).hostname.toLowerCase());
  const productionHost = targetHosts.find((hostname) => PRODUCTION_E2E_HOSTS.has(hostname));
  if (productionHost) {
    throw new Error(
      `Refusing E2E against production host "${productionHost}". ` +
        'The persona seed is destructive and is permitted only on local or isolated staging targets.',
    );
  }

  if (isLocalSupabase !== isLocalDatabase) {
    throw new Error(
      'Refusing mixed E2E targets: Supabase and PostgreSQL must both be local or both belong to the isolated staging environment.',
    );
  }

  if (!allowRemote && !isLocalSupabase) {
    throw new Error(
      `Refusing to run E2E seed against non-local Supabase URL "${supabaseURL}". ` +
        'Set E2E_ALLOW_REMOTE=true only for an isolated staging project.',
    );
  }

  if (
    !isLocalSupabase &&
    process.env.E2E_REMOTE_CONFIRMATION !== REMOTE_E2E_CONFIRMATION
  ) {
    throw new Error(
      'Refusing remote E2E without E2E_REMOTE_CONFIRMATION=isolated-staging-only. ' +
        'This second confirmation must never be configured for production.',
    );
  }

  if (!isLocalSupabase) {
    const supabaseHost = new URL(supabaseURL).hostname.toLowerCase();
    const databaseHost = new URL(databaseURL).hostname.toLowerCase();
    const confirmedSupabaseHost = readEnv('E2E_REMOTE_SUPABASE_HOST').toLowerCase();
    const confirmedDatabaseHost = readEnv('E2E_REMOTE_DATABASE_HOST').toLowerCase();

    if (
      confirmedSupabaseHost !== supabaseHost ||
      confirmedDatabaseHost !== databaseHost
    ) {
      throw new Error(
        'Refusing remote E2E because the exact staging hosts were not confirmed. ' +
          'Set E2E_REMOTE_SUPABASE_HOST and E2E_REMOTE_DATABASE_HOST to the parsed staging hostnames.',
      );
    }
  }
}
