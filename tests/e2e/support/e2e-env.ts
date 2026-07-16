import fs from 'node:fs';
import path from 'node:path';

export const E2E_ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
export const E2E_TEAM_ID = '22222222-2222-4222-8222-222222222222';
export const E2E_PIPELINE_ID = '33333333-3333-4333-8333-333333333333';
export const E2E_STAGE_ID = '44444444-4444-4444-8444-444444444444';
export const E2E_OUTSIDE_TEAM_ID = '55555555-5555-4555-8555-555555555555';

export const E2E_LEADS = {
  leaderOwn: '66666666-6666-4666-8666-666666666666',
  team: '77777777-7777-4777-8777-777777777777',
  userOwn: '88888888-8888-4888-8888-888888888888',
  outside: '99999999-9999-4999-8999-999999999999',
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
  supabaseAdminAccessToken: string;
  supabaseJWTSecret: string;
  databaseURL: string;
};

let envLoaded = false;

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

  return {
    baseURL: readEnv('E2E_BASE_URL', 'http://127.0.0.1:3000'),
    apiURL: readEnv('E2E_VIMOB_API_URL', 'http://127.0.0.1:8081'),
    supabaseURL: readEnv('E2E_SUPABASE_URL', 'http://127.0.0.1:54321'),
    supabaseAnonKey: readEnv('E2E_SUPABASE_ANON_KEY'),
    supabaseServiceRoleKey: readEnv('E2E_SUPABASE_SERVICE_ROLE_KEY'),
    supabaseAdminAccessToken: readEnv('E2E_SUPABASE_ADMIN_ACCESS_TOKEN'),
    supabaseJWTSecret: readEnv('E2E_SUPABASE_JWT_SECRET'),
    databaseURL: readEnv('E2E_DATABASE_URL', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'),
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

  assertSafeSupabaseTarget(config.supabaseURL);
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

function assertSafeSupabaseTarget(value: string) {
  const allowRemote = process.env.E2E_ALLOW_REMOTE === 'true';
  const { hostname } = new URL(value);
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';

  if (!allowRemote && !isLocalHost) {
    throw new Error(
      `Refusing to run E2E seed against non-local Supabase URL "${value}". ` +
        'Set E2E_ALLOW_REMOTE=true only for an isolated staging project.',
    );
  }
}
