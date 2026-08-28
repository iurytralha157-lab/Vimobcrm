import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import * as nodeModule from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

import { Pool, type PoolClient } from 'pg';

const e2eEnvModuleURL = new URL(
  '../../tests/e2e/support/e2e-env.ts',
  import.meta.url,
);
type E2EEnvModule = typeof import('../../tests/e2e/support/e2e-env');
const {
  E2E_ORGANIZATION_ID,
  E2E_PASSWORD,
  E2E_PIPELINE_ID,
  E2E_PROPERTY_ID,
  E2E_STAGE_ID,
  E2E_TEAM_ID,
  E2E_USERS,
  loadE2EEnvFiles,
  requireE2ESupabaseConfig,
} = (await import(e2eEnvModuleURL.href)) as E2EEnvModule;
import {
  MetricsCollector,
  evaluateMetricGates,
  runWorkerPool,
} from './load-metrics.mjs';

const REQUIRED_CONFIRMATION = 'LOCAL_WRITE_TEST';
const EXPECTED_E2E_ORGANIZATION_NAME = 'Vimob E2E Teste';
const RUN_ID_PATTERN = /^load-\d{8}T\d{9}Z-[a-f0-9]{8}$/;
const RESOURCE_PREFIX = 'VIMOB_LOAD:';
const INTAKE_METRIC = 'POST /v1/public/site/contact';
const LEAD_READ_METRIC = 'GET /v1/leads/{id}';
const FIRST_RESPONSE_METRIC = 'POST /v1/leads/{id}/first-response';
const FEEDBACK_METRIC = 'PATCH /v1/leads/{id} feedback';
const OUTCOME_METRIC = 'PATCH /v1/leads/{id} outcome';
const AUTOMATION_START_METRIC = 'POST /v1/automations/{id}/start';
const AUTOMATION_LIST_METRIC = 'GET /v1/automation-executions';
const MANIFEST_VERSION = 2;
const REQUIRED_DATABASE_MIGRATION = '20260728190000';
const EXPECTED_E2E_USER_EMAILS = Object.values(E2E_USERS).map((user) => user.email.toLowerCase());
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ProfileName = 'smoke' | 'ramp' | 'full';

type ProfileConfig = {
  name: ProfileName;
  rampLevels: number[];
  rampItemsPerLevel: number;
  idempotencyCopies: number;
  reentryCopies: number;
  lifecycleCount: number;
  intakeConcurrency: number;
  mutationConcurrency: number;
  automationConcurrency: number;
  dashboardConcurrency: number;
  dashboardRequestsPerEndpoint: number;
  requestTimeoutMs: number;
  automationDeadlineMs: number;
};

const PROFILES: Record<ProfileName, ProfileConfig> = {
  smoke: {
    name: 'smoke',
    rampLevels: [1, 2],
    rampItemsPerLevel: 4,
    idempotencyCopies: 5,
    reentryCopies: 5,
    lifecycleCount: 8,
    intakeConcurrency: 2,
    mutationConcurrency: 2,
    automationConcurrency: 2,
    dashboardConcurrency: 2,
    dashboardRequestsPerEndpoint: 4,
    requestTimeoutMs: 10_000,
    automationDeadlineMs: 30_000,
  },
  ramp: {
    name: 'ramp',
    rampLevels: [1, 2, 5, 10, 25],
    rampItemsPerLevel: 25,
    idempotencyCopies: 25,
    reentryCopies: 15,
    lifecycleCount: 40,
    intakeConcurrency: 10,
    mutationConcurrency: 10,
    automationConcurrency: 10,
    dashboardConcurrency: 10,
    dashboardRequestsPerEndpoint: 20,
    requestTimeoutMs: 10_000,
    automationDeadlineMs: 30_000,
  },
  full: {
    name: 'full',
    rampLevels: [1, 2, 5, 10, 25],
    rampItemsPerLevel: 50,
    idempotencyCopies: 50,
    reentryCopies: 25,
    lifecycleCount: 200,
    intakeConcurrency: 25,
    mutationConcurrency: 25,
    automationConcurrency: 20,
    dashboardConcurrency: 25,
    dashboardRequestsPerEndpoint: 100,
    requestTimeoutMs: 10_000,
    automationDeadlineMs: 30_000,
  },
};

type LocalConfig = ReturnType<E2EEnvModule['getE2EConfig']>;
type UserKey = keyof typeof E2E_USERS;
type SeededUserIDs = Record<UserKey, string>;
type Tokens = Record<UserKey, string>;

type AvailabilityItem = {
  id?: string;
  team_member_id: string;
  day_of_week: number;
  start_time: string | null;
  end_time: string | null;
  is_all_day: boolean;
  is_active: boolean;
};

type RunManifest = {
  version: number;
  runId: string;
  organizationId: string;
  createdAt: string;
  profile: ProfileName;
  queueIds: string[];
  automationId: string | null;
  tagId: string | null;
  leadIds: string[];
  executionIds: string[];
  availabilitySnapshots: Record<string, AvailabilityItem[]>;
  teamPipelineCreated: boolean;
};

type RunContext = {
  config: LocalConfig;
  profile: ProfileConfig;
  runId: string;
  pool: Pool;
  collector: MetricsCollector;
  gates: GateBook;
  manifest: RunManifest;
  manifestPath: string;
  tokens: Tokens;
  userIds: SeededUserIDs;
  tokenByUserId: Map<string, string>;
  requestSequence: number;
  phoneSequence: number;
  runtimeIssueBaseline: RuntimeIssueSummary | null;
};

type ApiOptions = {
  token?: string;
  body?: unknown;
  metricName?: string;
  phase?: string;
  expectedStatuses?: number[];
  validateResponse?: (status: number, payload: unknown) => void;
  timeoutMs?: number;
  recordMetrics?: boolean;
};

type IntakeSpec = {
  campaign: string;
  submissionId: string;
  sessionId: string;
  phone: string;
  index: number;
};

type PublicContactResult = {
  success?: boolean;
  lead_id?: string;
  reentry?: boolean;
  idempotent?: boolean;
  filtered?: boolean;
};

type LeadPayload = {
  id: string;
  assignedUserId?: string;
  teamId?: string;
  dealStatus?: string;
  feedback?: string;
};

type DistributionInspection = {
  total: number;
  assigned: number;
  expectedTeam: number;
  assignments: number;
  wrongQueueAssignments: number;
  noMatchingQueue: number;
  noAvailableMembers: number;
  assignmentCounts: Record<string, number>;
};

type RuntimeIssueSummary = {
  deadLetters: number;
  failedEvents: number;
  failedEffects: number;
  openCircuits: number;
  duplicateDecisions: number;
  unknownEffects: number;
  staleSendingEffects: number;
};

type DatabaseSnapshot = {
  deadlocks: number;
  connections: number;
};

type GateResult = {
  name: string;
  passed: boolean;
  actual: unknown;
  expected: unknown;
};

class GateBook {
  results: GateResult[] = [];

  check(name: string, passed: boolean, actual: unknown, expected: unknown) {
    this.results.push({ name, passed, actual, expected });
    return passed;
  }

  mark() {
    return this.results.length;
  }

  throwIfFailedSince(mark: number, phase: string) {
    const failures = this.results.slice(mark).filter((result) => !result.passed);
    if (failures.length === 0) return;
    throw new Error(
      `${phase} failed: ${failures.map((failure) => `${failure.name} (${String(failure.actual)})`).join(', ')}`,
    );
  }

  failures() {
    return this.results.filter((result) => !result.passed);
  }
}

class HTTPError extends Error {
  status: number;
  path: string;

  constructor(method: string, requestPath: string, status: number, responseBody: string) {
    const safeBody = responseBody.replace(/\s+/g, ' ').slice(0, 400);
    super(`${method} ${requestPath} returned ${status}${safeBody ? `: ${safeBody}` : ''}`);
    this.name = 'HTTPError';
    this.status = status;
    this.path = requestPath;
  }
}

async function runCommand(commandOptions: {
  profile: ProfileName;
  cleanupRun?: string;
  preflightOnly: boolean;
}) {
  const config = hardSafetyPreflight();
  const profile = resolveProfile(commandOptions.profile);
  const runId = commandOptions.cleanupRun || createRunId();
  validateRunId(runId);

  const pool = new Pool({
    connectionString: config.databaseURL,
    max: 4,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
    application_name: `vimob-local-load:${runId}`,
  });
  let lockClient: PoolClient | null = null;

  try {
    lockClient = await acquireHarnessLock(pool);
    await assertDedicatedE2EDatabase(pool, commandOptions.cleanupRun ? 'cleanup' : 'fresh');
    if (commandOptions.preflightOnly) {
      console.log(JSON.stringify({
        success: true,
        mode: 'preflight',
        databaseState: commandOptions.cleanupRun ? 'cleanup' : 'fresh',
      }));
      return;
    }

    if (commandOptions.cleanupRun) {
      await assertE2EOrganization(pool);
      const manifest = await readRunManifest(runId);
      const adminToken = await tryAuthenticateAdmin(config);
      const cleanup = await cleanupRunArtifacts({
        config,
        pool,
        runId,
        manifest,
        adminToken,
        requestTimeoutMs: profile.requestTimeoutMs,
      });
      console.log(JSON.stringify({ success: true, mode: 'cleanup', runId, cleanup }, null, 2));
      return;
    }

    await assertAPIReady(config);
    await assertAutomationFunctionReady(config);
    logPhase(runId, `perfil ${profile.name}: preparando seed E2E`);
    const userIds = await seedLocalE2EData();
    await assertE2EOrganization(pool);
    await assertIsolatedE2EConfiguration(pool);
    const tokens = await authenticateUsers(config, userIds);

    const manifestPath = manifestPathFor(runId);
    const manifest: RunManifest = {
      version: MANIFEST_VERSION,
      runId,
      organizationId: E2E_ORGANIZATION_ID,
      createdAt: await databaseTimestamp(pool),
      profile: profile.name,
      queueIds: [],
      automationId: null,
      tagId: null,
      leadIds: [],
      executionIds: [],
      availabilitySnapshots: {},
      teamPipelineCreated: false,
    };
    await persistManifest(manifestPath, manifest);

    const context: RunContext = {
      config,
      profile,
      runId,
      pool,
      collector: new MetricsCollector(),
      gates: new GateBook(),
      manifest,
      manifestPath,
      tokens,
      userIds,
      tokenByUserId: new Map([
        [userIds.admin, tokens.admin],
        [userIds.leader, tokens.leader],
        [userIds.user, tokens.user],
      ]),
      requestSequence: 0,
      phoneSequence: phoneSeed(runId),
      runtimeIssueBaseline: null,
    };

    let databaseBefore: DatabaseSnapshot | null = null;
    let primaryError: unknown = null;
    let cleanupResult: unknown = null;
    let databaseAfter: DatabaseSnapshot | null = null;
    let statements: unknown[] = [];

    try {
      databaseBefore = await captureDatabaseSnapshot(pool);
      await setupRunResources(context);
      await runIdempotencyScenario(context);
      await runReentryScenario(context);
      await runDistributionRamp(context);
      await runLifecycleScenario(context);

      databaseAfter = await captureDatabaseSnapshot(pool);
      context.gates.check(
        'database.deadlocks_delta',
        databaseAfter.deadlocks - databaseBefore.deadlocks === 0,
        databaseAfter.deadlocks - databaseBefore.deadlocks,
        0,
      );
      statements = await readRelevantStatementStats(pool);

      const metrics = context.collector.snapshot();
      const metricFailures = evaluateMetricGates(metrics, metricGateConfig());
      for (const failure of metricFailures) {
        context.gates.check(`metrics.${failure.gate}`, false, failure.actual, failure.expected);
      }
      if (context.gates.failures().length > 0) {
        throw new Error(
          `acceptance gates failed: ${context.gates.failures().map((failure) => failure.name).join(', ')}`,
        );
      }
    } catch (error) {
      primaryError = error;
    } finally {
      try {
        cleanupResult = await cleanupRunArtifacts({
          config,
          pool,
          runId,
          manifest: context.manifest,
          adminToken: tokens.admin,
          requestTimeoutMs: profile.requestTimeoutMs,
        });
      } catch (error) {
        cleanupResult = { success: false, error: safeErrorMessage(error) };
        if (primaryError) {
          primaryError = new AggregateError([primaryError, error], 'load and cleanup failed');
        } else {
          primaryError = error;
        }
      }
    }

    const report = {
      success: primaryError === null,
      mode: 'lifecycle',
      runId,
      profile: profile.name,
      metrics: context.collector.snapshot(),
      gates: context.gates.results,
      database: {
        before: databaseBefore,
        after: databaseAfter,
        relevantStatements: statements,
      },
      cleanup: cleanupResult,
      errors: primaryError
        ? primaryError instanceof AggregateError
          ? primaryError.errors.map(safeErrorMessage)
          : [safeErrorMessage(primaryError)]
        : [],
    };
    console.log(JSON.stringify(report, null, 2));
    if (primaryError) process.exitCode = 1;
  } finally {
    try {
      if (lockClient) await releaseHarnessLock(lockClient);
    } finally {
      await pool.end();
    }
  }
}

function parseCommandLine(argumentsList: string[]) {
  let profile = (process.env.VIMOB_LOAD_PROFILE || 'smoke').trim().toLowerCase();
  let cleanupRun: string | undefined;
  let preflightOnly = false;

  for (const argument of argumentsList) {
    if (argument.startsWith('--profile=')) profile = argument.slice('--profile='.length).trim().toLowerCase();
    else if (argument.startsWith('--cleanup-run=')) cleanupRun = argument.slice('--cleanup-run='.length).trim();
    else if (argument === '--preflight-only') preflightOnly = true;
    else throw new Error(`Unknown argument "${argument}".`);
  }

  if (!isProfileName(profile)) {
    throw new Error(`VIMOB load profile must be one of: ${Object.keys(PROFILES).join(', ')}.`);
  }
  if (cleanupRun) validateRunId(cleanupRun);
  return { profile, cleanupRun, preflightOnly };
}

function isProfileName(value: string): value is ProfileName {
  return Object.hasOwn(PROFILES, value);
}

function resolveProfile(name: ProfileName): ProfileConfig {
  const base = PROFILES[name];
  return {
    ...base,
    lifecycleCount: positiveEnv('VIMOB_LOAD_LIFECYCLE_COUNT', base.lifecycleCount),
    intakeConcurrency: positiveEnv('VIMOB_LOAD_CONCURRENCY', base.intakeConcurrency),
    dashboardRequestsPerEndpoint: positiveEnv(
      'VIMOB_LOAD_DASHBOARD_REQUESTS_PER_ENDPOINT',
      base.dashboardRequestsPerEndpoint,
    ),
    requestTimeoutMs: positiveEnv('VIMOB_LOAD_REQUEST_TIMEOUT_MS', base.requestTimeoutMs),
    automationDeadlineMs: positiveEnv(
      'VIMOB_LOAD_AUTOMATION_DEADLINE_MS',
      base.automationDeadlineMs,
    ),
  };
}

function positiveEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function hardSafetyPreflight() {
  loadE2EEnvFiles();
  if (process.env.VIMOB_LOAD_CONFIRM !== REQUIRED_CONFIRMATION) {
    throw new Error(`Refusing local writes: VIMOB_LOAD_CONFIRM must equal ${REQUIRED_CONFIRMATION}.`);
  }
  if (Object.hasOwn(process.env, 'E2E_ALLOW_REMOTE')) {
    throw new Error('Refusing to run while E2E_ALLOW_REMOTE is defined.');
  }

  const config = requireE2ESupabaseConfig();
  assertLoopbackURL('E2E_VIMOB_API_URL', config.apiURL);
  assertLoopbackURL('E2E_SUPABASE_URL', config.supabaseURL);
  assertLoopbackURL('E2E_DATABASE_URL', config.databaseURL);
  return config;
}

let seedResolverRegistered = false;

async function seedLocalE2EData(): Promise<SeededUserIDs> {
  if (!seedResolverRegistered) {
    type ResolveHook = (
      specifier: string,
      context: unknown,
      nextResolve: (nextSpecifier: string, nextContext: unknown) => unknown,
    ) => unknown;
    const runtimeModule = nodeModule as typeof nodeModule & {
      registerHooks?: (hooks: { resolve: ResolveHook }) => void;
    };
    if (typeof runtimeModule.registerHooks !== 'function') {
      throw new Error('Node.js 22.15 or newer is required to load the shared E2E seed.');
    }
    runtimeModule.registerHooks({
      resolve(specifier, context, nextResolve) {
        try {
          return nextResolve(specifier, context);
        } catch (error) {
          const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
          const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ERR_MODULE_NOT_FOUND' &&
            isRelative &&
            !hasExtension
          ) {
            return nextResolve(`${specifier}.ts`, context);
          }
          throw error;
        }
      },
    });
    seedResolverRegistered = true;
  }

  const seedModulePath = '../../tests/e2e/support/' + 'seed.ts';
  const { seedE2EData } = await import(seedModulePath) as {
    seedE2EData: () => Promise<SeededUserIDs>;
  };
  return seedE2EData();
}

function assertLoopbackURL(name: string, value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
  if (!allowed.has(host)) {
    throw new Error(`Refusing non-loopback ${name} host "${host}".`);
  }
}

function createRunId() {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
  return `load-${timestamp}-${randomBytes(4).toString('hex')}`;
}

function validateRunId(runId: string) {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`Invalid load run id "${runId}".`);
  }
}

async function acquireHarnessLock(pool: Pool) {
  const client = await pool.connect();
  try {
    const result = await client.query<{ locked: boolean }>(
      `select pg_try_advisory_lock(hashtextextended($1, 0)) as locked`,
      ['vimob:local-lifecycle-load'],
    );
    if (!result.rows[0]?.locked) {
      throw new Error('Another Vimob local lifecycle harness is already running.');
    }
    return client;
  } catch (error) {
    client.release();
    throw error;
  }
}

async function releaseHarnessLock(client: PoolClient) {
  try {
    await client.query(`select pg_advisory_unlock(hashtextextended($1, 0))`, [
      'vimob:local-lifecycle-load',
    ]);
  } finally {
    client.release();
  }
}

async function assertDedicatedE2EDatabase(pool: Pool, mode: 'fresh' | 'cleanup') {
  const result = await pool.query<{
    database_name: string;
    database_user: string;
    migration_present: boolean;
    distribution_contract_present: boolean;
    organization_count: string;
    expected_organization_count: string;
    auth_user_count: string;
    unexpected_auth_user_count: string;
    unmarked_e2e_auth_user_count: string;
  }>(
    `
      select
        current_database() as database_name,
        current_user as database_user,
        exists (
          select 1
          from supabase_migrations.schema_migrations
          where version = $1
        ) as migration_present,
        to_regprocedure(
          'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamp with time zone)'
        ) is not null as distribution_contract_present,
        (select count(*) from public.organizations)::text as organization_count,
        (
          select count(*)
          from public.organizations
          where id = $2::uuid and name = $3
        )::text as expected_organization_count,
        (select count(*) from auth.users)::text as auth_user_count,
        (
          select count(*)
          from auth.users
          where not (lower(coalesce(email, '')) = any($4::text[]))
        )::text as unexpected_auth_user_count,
        (
          select count(*)
          from auth.users
          where lower(coalesce(email, '')) = any($4::text[])
            and lower(coalesce(raw_app_meta_data->>'e2e', 'false')) <> 'true'
        )::text as unmarked_e2e_auth_user_count
    `,
    [
      REQUIRED_DATABASE_MIGRATION,
      E2E_ORGANIZATION_ID,
      EXPECTED_E2E_ORGANIZATION_NAME,
      EXPECTED_E2E_USER_EMAILS,
    ],
  );
  const identity = result.rows[0];
  if (
    identity.database_name !== 'postgres' ||
    identity.database_user !== 'postgres' ||
    !identity.migration_present ||
    !identity.distribution_contract_present
  ) {
    throw new Error(
      `Refusing writes: database identity is not the dedicated, migrated local Supabase target ` +
      `(database=${identity.database_name}, user=${identity.database_user}, ` +
      `migration=${identity.migration_present}, distribution=${identity.distribution_contract_present}).`,
    );
  }

  const organizationCount = Number(identity.organization_count);
  const expectedOrganizationCount = Number(identity.expected_organization_count);
  const authUserCount = Number(identity.auth_user_count);
  const unexpectedAuthUserCount = Number(identity.unexpected_auth_user_count);
  const unmarkedE2EAuthUserCount = Number(identity.unmarked_e2e_auth_user_count);

  if (mode === 'fresh') {
    if (organizationCount !== 0 || authUserCount !== 0) {
      throw new Error(
        `Refusing writes: the local database is not freshly reset ` +
        `(organizations=${organizationCount}, auth_users=${authUserCount}). ` +
        'Run `npx supabase db reset` and reapply local migrations before the harness.',
      );
    }
    return;
  }

  if (
    organizationCount !== 1 ||
    expectedOrganizationCount !== 1 ||
    authUserCount > EXPECTED_E2E_USER_EMAILS.length ||
    unexpectedAuthUserCount !== 0 ||
    unmarkedE2EAuthUserCount !== 0
  ) {
    throw new Error(
      `Refusing cleanup: the database is not exclusively owned by the Vimob E2E fixture ` +
      `(organizations=${organizationCount}, expected_org=${expectedOrganizationCount}, ` +
      `auth_users=${authUserCount}, unexpected_auth=${unexpectedAuthUserCount}, ` +
      `unmarked_e2e_auth=${unmarkedE2EAuthUserCount}).`,
    );
  }
}

async function assertIsolatedE2EConfiguration(pool: Pool) {
  const result = await pool.query<{
    active_automations: string;
    queues: string;
    team_pipelines: string;
    availability: string;
    gamification_enabled: string;
  }>(
    `
      select
        (select count(*) from public.automations
          where organization_id = $1::uuid)::text as active_automations,
        (select count(*) from public.round_robins
          where organization_id = $1::uuid)::text as queues,
        (select count(*) from public.team_pipelines
          where organization_id = $1::uuid)::text as team_pipelines,
        (select count(*) from public.member_availability
          where organization_id = $1::uuid)::text as availability,
        (select count(*) from public.organization_modules
          where organization_id = $1::uuid
            and module_name = 'gamification'
            and is_enabled = true)::text as gamification_enabled
    `,
    [E2E_ORGANIZATION_ID],
  );
  const state = Object.fromEntries(
    Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)]),
  ) as Record<string, number>;
  const dirtyEntries = Object.entries(state).filter(([, count]) => count !== 0);
  if (dirtyEntries.length > 0) {
    throw new Error(
      `Refusing load: E2E seed is not isolated (${dirtyEntries
        .map(([key, count]) => `${key}=${count}`)
        .join(', ')}). Reset the local database instead of reusing mutable fixtures.`,
    );
  }
}

async function databaseTimestamp(pool: Pool) {
  const result = await pool.query<{ now: string }>(
    `select clock_timestamp()::text as now`,
  );
  return new Date(result.rows[0].now).toISOString();
}

async function assertE2EOrganization(pool: Pool) {
  const result = await pool.query<{ id: string; name: string }>(
    `select id::text, name from public.organizations where id = $1::uuid`,
    [E2E_ORGANIZATION_ID],
  );
  const organization = result.rows[0];
  if (
    !organization ||
    organization.id !== E2E_ORGANIZATION_ID ||
    organization.name !== EXPECTED_E2E_ORGANIZATION_NAME
  ) {
    throw new Error('Refusing writes: the fixed E2E organization is missing or has an unexpected name.');
  }
}

async function assertAPIReady(config: LocalConfig) {
  const response = await fetch(`${stripTrailingSlash(config.apiURL)}/readyz`, {
    signal: AbortSignal.timeout(5_000),
  });
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`Local API readiness returned ${response.status}.`);
}

async function assertAutomationFunctionReady(config: LocalConfig) {
  const executorResponse = await fetch(
    `${stripTrailingSlash(config.supabaseURL)}/functions/v1/automation-executor`,
    {
      method: 'POST',
      headers: {
        apikey: config.supabaseServiceRoleKey,
        Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
        'content-type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(5_000),
    },
  );
  const executorPayload = await executorResponse.json().catch(() => null) as { error?: string } | null;
  if (executorResponse.status !== 400 || executorPayload?.error !== 'execution_id_only') {
    throw new Error(
      `Local automation-executor is not ready ` +
      `(expected authenticated execution_id_only/400 probe, got HTTP ${executorResponse.status}).`,
    );
  }

  const runnerResponse = await fetch(
    `${stripTrailingSlash(config.supabaseURL)}/functions/v1/automation-runner`,
    {
      method: 'POST',
      headers: {
        apikey: config.supabaseServiceRoleKey,
        Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        event_batch_size: 1,
        execution_batch_size: 1,
        delay_batch_size: 1,
        run_inactivity: false,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const runnerPayload = await runnerResponse.json().catch(() => null) as { ok?: boolean } | null;
  if (!runnerResponse.ok || runnerPayload?.ok !== true) {
    throw new Error(
      `Local automation-runner is not ready ` +
      `(expected authenticated ok/200 probe, got HTTP ${runnerResponse.status}).`,
    );
  }
}

async function authenticateUsers(config: LocalConfig, userIds: SeededUserIDs): Promise<Tokens> {
  const entries = await Promise.all(
    (Object.keys(E2E_USERS) as UserKey[]).map(async (key) => [
      key,
      await authenticateUser(config, key, userIds[key]),
    ] as const),
  );
  return Object.fromEntries(entries) as Tokens;
}

async function authenticateUser(config: LocalConfig, key: UserKey, expectedUserId?: string) {
  const response = await fetch(
    `${stripTrailingSlash(config.supabaseURL)}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        apikey: config.supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: E2E_USERS[key].email, password: E2E_PASSWORD }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const payload = await response.json().catch(() => ({})) as {
    access_token?: string;
    user?: { id?: string };
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(`Local E2E authentication failed for role ${key} with HTTP ${response.status}.`);
  }
  if (expectedUserId && payload.user?.id !== expectedUserId) {
    throw new Error(`Local E2E authentication returned an unexpected user for role ${key}.`);
  }
  return payload.access_token;
}

async function tryAuthenticateAdmin(config: LocalConfig) {
  try {
    return await authenticateUser(config, 'admin');
  } catch {
    return undefined;
  }
}

async function apiRequest<T>(
  context: RunContext,
  method: string,
  requestPath: string,
  options: ApiOptions = {},
): Promise<T> {
  return rawApiRequest<T>({
    config: context.config,
    organizationId: E2E_ORGANIZATION_ID,
    collector: options.recordMetrics === false ? undefined : context.collector,
    method,
    requestPath,
    token: options.token,
    body: options.body,
    metricName: options.metricName,
    phase: options.phase,
    expectedStatuses: options.expectedStatuses,
    validateResponse: options.validateResponse,
    timeoutMs: options.timeoutMs || context.profile.requestTimeoutMs,
    requestId: `${context.runId}:${options.phase || 'request'}:${++context.requestSequence}`,
  });
}

async function rawApiRequest<T>({
  config,
  organizationId,
  collector,
  method,
  requestPath,
  token,
  body,
  metricName,
  phase,
  expectedStatuses,
  validateResponse,
  timeoutMs,
  requestId,
}: {
  config: LocalConfig;
  organizationId: string;
  collector?: MetricsCollector;
  method: string;
  requestPath: string;
  token?: string;
  body?: unknown;
  metricName?: string;
  phase?: string;
  expectedStatuses?: number[];
  validateResponse?: (status: number, payload: unknown) => void;
  timeoutMs: number;
  requestId: string;
}): Promise<T> {
  const startedAt = performance.now();
  let status = 0;
  let successful = false;
  const label = metricName || `${method} ${requestPath.split('?')[0]}`;
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'vimob-local-lifecycle-load/1.0',
      'X-Organization-ID': organizationId,
      'X-Request-ID': requestId,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (requestPath.split('?')[0] === '/v1/public/site/contact') {
      headers['X-Forwarded-For'] = syntheticLoadClientIP(requestId);
    }

    const response = await fetch(`${stripTrailingSlash(config.apiURL)}${requestPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    status = response.status;
    const text = await response.text();
    const acceptedStatus = expectedStatuses ? expectedStatuses.includes(status) : response.ok;
    if (!acceptedStatus) throw new HTTPError(method, requestPath, status, text);
    if (!text) {
      validateResponse?.(status, undefined);
      successful = true;
      return undefined as T;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`${method} ${requestPath} returned invalid JSON.`);
    }
    validateResponse?.(status, payload);
    successful = true;
    return payload as T;
  } finally {
    collector?.record(label, {
      durationMs: performance.now() - startedAt,
      status,
      ok: successful,
    });
    void phase;
  }
}

function syntheticLoadClientIP(requestId: string) {
  const sequence = Number(requestId.match(/:(\d+)$/)?.[1] || 0);
  const normalized = Math.max(1, sequence);
  const thirdOctet = Math.floor(normalized / 254) % 256;
  const fourthOctet = (normalized % 254) + 1;
  return `198.18.${thirdOctet}.${fourthOctet}`;
}

async function setupRunResources(context: RunContext) {
  logPhase(context.runId, 'configurando escala e recursos descartáveis');
  await setupTeamScale(context);

  const directQueue = await createQueue(context, 'direct', `${context.runId}:direct`, [
    { type: 'user', entityId: context.userIds.leader, weight: 1 },
    { type: 'user', entityId: context.userIds.user, weight: 1 },
  ]);
  context.manifest.queueIds.push(directQueue.id);
  await persistContextManifest(context);

  const teamQueue = await createQueue(context, 'team', `${context.runId}:team`, [
    { type: 'team', entityId: E2E_TEAM_ID, weight: 1 },
  ]);
  context.manifest.queueIds.push(teamQueue.id);
  await persistContextManifest(context);

  const tagEnvelope = await apiRequest<{ data: { id: string } }>(context, 'POST', '/v1/tags', {
    token: context.tokens.admin,
    phase: 'setup-tag',
    body: {
      name: `${RESOURCE_PREFIX}${context.runId}:processed`,
      color: '#f97316',
    },
  });
  context.manifest.tagId = tagEnvelope.data.id;
  await persistContextManifest(context);

  const automationEnvelope = await apiRequest<{ data: { id: string } }>(
    context,
    'POST',
    '/v1/automations',
    {
      token: context.tokens.admin,
      phase: 'setup-automation',
      body: automationPayload(context.runId, context.manifest.tagId),
    },
  );
  context.manifest.automationId = automationEnvelope.data.id;
  await persistContextManifest(context);

  const issues = await apiRequest<{ data: { summary: RuntimeIssueSummary } }>(
    context,
    'GET',
    '/v1/automation-runtime/issues',
    {
      token: context.tokens.admin,
      phase: 'runtime-baseline',
    },
  );
  context.runtimeIssueBaseline = issues.data.summary;
}

async function setupTeamScale(context: RunContext) {
  const teamsEnvelope = await apiRequest<{
    data: Array<{
      id: string;
      members: Array<{ id: string; user_id: string }>;
    }>;
  }>(context, 'GET', '/v1/teams', {
    token: context.tokens.admin,
    phase: 'setup-teams',
  });
  const team = teamsEnvelope.data.find((item) => item.id === E2E_TEAM_ID);
  if (!team) throw new Error('E2E team was not returned by the local API.');
  const targetMembers = team.members.filter((member) =>
    member.user_id === context.userIds.leader || member.user_id === context.userIds.user,
  );
  if (targetMembers.length !== 2) throw new Error('E2E team must contain leader and common user.');

  for (const member of targetMembers) {
    const availability = await apiRequest<{ data: AvailabilityItem[] }>(
      context,
      'GET',
      `/v1/team-members/${member.id}/availability`,
      {
        token: context.tokens.admin,
        phase: 'setup-availability-snapshot',
      },
    );
    context.manifest.availabilitySnapshots[member.id] = availability.data;
  }
  await persistContextManifest(context);

  for (const member of targetMembers) {
    await apiRequest(context, 'PUT', `/v1/team-members/${member.id}/availability`, {
      token: context.tokens.admin,
      phase: 'setup-availability',
      body: {
        availability: Array.from({ length: 7 }, (_, day) => ({
          team_member_id: member.id,
          day_of_week: day,
          start_time: null,
          end_time: null,
          is_all_day: true,
          is_active: true,
        })),
      },
    });
  }

  const relations = await apiRequest<{
    data: Array<{ team_id: string; pipeline_id: string }>;
  }>(
    context,
    'GET',
    `/v1/team-pipelines?teamId=${encodeURIComponent(E2E_TEAM_ID)}`,
    {
      token: context.tokens.admin,
      phase: 'setup-team-pipeline-read',
    },
  );
  const exists = relations.data.some(
    (relation) => relation.team_id === E2E_TEAM_ID && relation.pipeline_id === E2E_PIPELINE_ID,
  );
  if (!exists) {
    context.manifest.teamPipelineCreated = true;
    await persistContextManifest(context);
    await apiRequest(context, 'POST', '/v1/team-pipelines', {
      token: context.tokens.admin,
      phase: 'setup-team-pipeline',
      body: { teamId: E2E_TEAM_ID, pipelineId: E2E_PIPELINE_ID },
    });
  }
}

async function createQueue(
  context: RunContext,
  suffix: string,
  campaignPrefix: string,
  members: Array<{ type: 'user' | 'team'; entityId: string; weight: number }>,
) {
  const response = await apiRequest<{ data: { id: string } }>(
    context,
    'POST',
    '/v1/round-robins',
    {
      token: context.tokens.admin,
      phase: `setup-queue-${suffix}`,
      body: {
        name: `${RESOURCE_PREFIX}${context.runId}:queue:${suffix}`,
        strategy: 'simple',
        targetPipelineId: E2E_PIPELINE_ID,
        targetStageId: E2E_STAGE_ID,
        isActive: true,
        settings: {
          ignore_availability: false,
          enable_redistribution: false,
        },
        reentryBehavior: 'keep_assignee',
        conditions: [{ type: 'campaign_contains', values: [campaignPrefix] }],
        members,
      },
    },
  );
  return response.data;
}

function automationPayload(runId: string, tagId: string) {
  return {
    name: `${RESOURCE_PREFIX}${runId}:automation`,
    description: 'Carga local descartavel',
    trigger_type: 'manual',
    trigger_config: { trigger_type: 'manual' },
    is_active: true,
    flow_definition: {
      nodes: [
        {
          id: 'trigger-manual',
          type: 'trigger',
          position: { x: 0, y: 0 },
          config: { trigger_type: 'manual' },
        },
        {
          id: 'tag-terminal',
          type: 'action',
          action_type: 'add_tag',
          position: { x: 240, y: 0 },
          config: { tag_id: tagId },
        },
      ],
      connections: [{ source: 'trigger-manual', target: 'tag-terminal' }],
      settings: { timezone: 'America/Sao_Paulo' },
    },
  };
}

async function runIdempotencyScenario(context: RunContext) {
  logPhase(context.runId, 'validando tempestade de idempotência');
  const mark = context.gates.mark();
  const campaign = `${context.runId}:direct:idempotency`;
  const spec: IntakeSpec = {
    campaign,
    submissionId: `load:${context.runId}:idempotency:submission`,
    sessionId: `load:${context.runId}:idempotency:session`,
    phone: nextPhone(context),
    index: 0,
  };
  const requests = Array.from({ length: context.profile.idempotencyCopies }, (_, index) => index);
  const responses = await runWorkerPool(
    requests,
    Math.min(context.profile.intakeConcurrency, requests.length),
    () => submitIntake(context, spec, 'idempotency'),
  ) as PublicContactResult[];
  const leadIds = responses.map((response) => response.lead_id || '');
  const uniqueLeadIds = new Set(leadIds.filter(Boolean));
  const leadId = [...uniqueLeadIds][0];
  if (leadId) rememberLeadIDs(context, [leadId]);

  const database = leadId
    ? await context.pool.query<{
      submissions: string;
      assignments: string;
      leads: string;
    }>(
      `
        select
          (select count(*) from public.site_lead_submissions
            where organization_id = $1::uuid and submission_id = $2)::text as submissions,
          (select count(*) from public.assignments_log
            where organization_id = $1::uuid and lead_id = $3::uuid)::text as assignments,
          (select count(*) from public.leads
            where organization_id = $1::uuid and id = $3::uuid)::text as leads
      `,
      [E2E_ORGANIZATION_ID, spec.submissionId, leadId],
    )
    : null;
  const counts = database?.rows[0];

  context.gates.check(
    'idempotency.all_responses_have_lead',
    leadIds.every(Boolean),
    leadIds.filter(Boolean).length,
    requests.length,
  );
  context.gates.check('idempotency.single_lead_id', uniqueLeadIds.size === 1, uniqueLeadIds.size, 1);
  context.gates.check('idempotency.single_submission', Number(counts?.submissions) === 1, Number(counts?.submissions), 1);
  context.gates.check('idempotency.single_lead', Number(counts?.leads) === 1, Number(counts?.leads), 1);
  context.gates.check('idempotency.single_assignment', Number(counts?.assignments) === 1, Number(counts?.assignments), 1);
  await persistContextManifest(context);
  context.gates.throwIfFailedSince(mark, 'idempotency');
}

async function runReentryScenario(context: RunContext) {
  logPhase(context.runId, 'validando reentrada concorrente por telefone');
  const mark = context.gates.mark();
  const campaign = `${context.runId}:direct:reentry`;
  const phone = nextPhone(context);
  const specs = Array.from({ length: context.profile.reentryCopies }, (_, index) => ({
    campaign,
    submissionId: `load:${context.runId}:reentry:submission:${index}`,
    sessionId: `load:${context.runId}:reentry:session:${index}`,
    phone,
    index,
  }));
  const responses = await runWorkerPool(
    specs,
    Math.min(context.profile.intakeConcurrency, specs.length),
    (spec) => submitIntake(context, spec, 'reentry'),
  );
  const uniqueLeadIds = new Set(responses.map((response) => response.lead_id).filter(Boolean) as string[]);
  const leadId = [...uniqueLeadIds][0];
  if (leadId) rememberLeadIDs(context, [leadId]);

  const database = leadId
    ? await context.pool.query<{
      reentry_count: number;
      assignments: string;
      submissions: string;
      entries: string;
    }>(
      `
        select
          l.reentry_count,
          (select count(*) from public.assignments_log a
            where a.organization_id = l.organization_id and a.lead_id = l.id)::text as assignments,
          (select count(*) from public.site_lead_submissions s
            where s.organization_id = l.organization_id and s.lead_id = l.id)::text as submissions,
          (select count(*) from public.lead_entry_events e
            where e.organization_id = l.organization_id and e.lead_id = l.id
              and e.is_countable = true)::text as entries
        from public.leads l
        where l.organization_id = $1::uuid and l.id = $2::uuid
      `,
      [E2E_ORGANIZATION_ID, leadId],
    )
    : null;
  const row = database?.rows[0];

  context.gates.check('reentry.single_lead_id', uniqueLeadIds.size === 1, uniqueLeadIds.size, 1);
  context.gates.check(
    'reentry.response_flags',
    responses.filter((response) => response.reentry === true).length === specs.length - 1,
    responses.filter((response) => response.reentry === true).length,
    specs.length - 1,
  );
  context.gates.check('reentry.persisted_count', Number(row?.reentry_count) === specs.length - 1, Number(row?.reentry_count), specs.length - 1);
  context.gates.check('reentry.single_assignment', Number(row?.assignments) === 1, Number(row?.assignments), 1);
  context.gates.check('reentry.submission_count', Number(row?.submissions) === specs.length, Number(row?.submissions), specs.length);
  context.gates.check('reentry.entry_event_count', Number(row?.entries) === specs.length, Number(row?.entries), specs.length);
  await persistContextManifest(context);
  context.gates.throwIfFailedSince(mark, 'reentry');
}

async function runDistributionRamp(context: RunContext) {
  logPhase(context.runId, `executando rampa ${context.profile.rampLevels.join('/')}`);
  const directQueueId = context.manifest.queueIds[0];
  for (const concurrency of context.profile.rampLevels) {
    const mark = context.gates.mark();
    const campaign = `${context.runId}:direct:ramp:${concurrency}`;
    const specs = Array.from({ length: context.profile.rampItemsPerLevel }, (_, index) => ({
      campaign,
      submissionId: `load:${context.runId}:ramp:${concurrency}:submission:${index}`,
      sessionId: `load:${context.runId}:ramp:${concurrency}:session:${index}`,
      phone: nextPhone(context),
      index,
    }));
    const responses = await runWorkerPool(specs, concurrency, (spec) =>
      submitIntake(context, spec, `ramp-${concurrency}`),
    );
    const leadIds = responses.map((response) => response.lead_id).filter(Boolean) as string[];
    rememberLeadIDs(context, leadIds);
    context.gates.check(
      `ramp.c${concurrency}.unique_leads`,
      new Set(leadIds).size === specs.length,
      new Set(leadIds).size,
      specs.length,
    );
    await assertDistribution(context, {
      gatePrefix: `ramp.c${concurrency}`,
      leadIds,
      queueId: directQueueId,
      expectTeam: false,
    });
    await persistContextManifest(context);
    context.gates.throwIfFailedSince(mark, `distribution ramp c=${concurrency}`);
  }
}

async function runLifecycleScenario(context: RunContext) {
  logPhase(context.runId, 'executando ciclo equipe -> atendimento -> resultado -> automação -> dashboard');
  const mark = context.gates.mark();
  const teamQueueId = context.manifest.queueIds[1];
  const campaign = `${context.runId}:team:lifecycle`;
  const dashboardFrom = new Date(Date.now() - 2_000);
  const specs = Array.from({ length: context.profile.lifecycleCount }, (_, index) => ({
    campaign,
    submissionId: `load:${context.runId}:lifecycle:submission:${index}`,
    sessionId: `load:${context.runId}:lifecycle:session:${index}`,
    phone: nextPhone(context),
    index,
  }));
  const responses = await runWorkerPool(
    specs,
    context.profile.intakeConcurrency,
    (spec) => submitIntake(context, spec, 'lifecycle-intake'),
  );
  const leadIds = responses.map((response) => response.lead_id).filter(Boolean) as string[];
  rememberLeadIDs(context, leadIds);
  context.gates.check(
    'lifecycle.unique_leads',
    new Set(leadIds).size === specs.length,
    new Set(leadIds).size,
    specs.length,
  );
  const distribution = await assertDistribution(context, {
    gatePrefix: 'lifecycle.distribution',
    leadIds,
    queueId: teamQueueId,
    expectTeam: true,
  });
  await persistContextManifest(context);
  context.gates.throwIfFailedSince(mark, 'team lifecycle distribution');

  const leads = await runWorkerPool(
    leadIds,
    context.profile.mutationConcurrency,
    async (leadId, index) => {
      const envelope = await apiRequest<{ data: LeadPayload }>(
        context,
        'GET',
        `/v1/leads/${leadId}`,
        {
          token: context.tokens.admin,
          metricName: LEAD_READ_METRIC,
          phase: `lead-read-${index}`,
        },
      );
      return envelope.data;
    },
  );
  const unknownAssignees = leads.filter(
    (lead) => !lead.assignedUserId || !context.tokenByUserId.has(lead.assignedUserId),
  );
  context.gates.check('lifecycle.known_assignees', unknownAssignees.length === 0, unknownAssignees.length, 0);
  context.gates.throwIfFailedSince(mark, 'lead assignee resolution');

  await assertRoleVisibility(context, leads);
  context.gates.throwIfFailedSince(mark, 'role visibility');

  await runWorkerPool(leads, context.profile.mutationConcurrency, async (lead, index) => {
    await apiRequest(context, 'POST', `/v1/leads/${lead.id}/first-response`, {
      token: context.tokenByUserId.get(lead.assignedUserId!)!,
      metricName: FIRST_RESPONSE_METRIC,
      phase: `first-response-${index}`,
      body: { channel: 'manual', is_automation: false },
    });
  });

  await runWorkerPool(leads, context.profile.mutationConcurrency, async (lead, index) => {
    await apiRequest(context, 'PATCH', `/v1/leads/${lead.id}`, {
      token: context.tokenByUserId.get(lead.assignedUserId!)!,
      metricName: FEEDBACK_METRIC,
      phase: `feedback-${index}`,
      body: { feedback: `Atendimento de carga ${context.runId}:${index}` },
    });
  });

  const expectedReservationTargetCount =
    (await countOpenPropertyReservationAudience(context.pool)) - 1;
  const wonContenders = leads.filter((_, index) => index % 2 === 0);
  const wonContenderIds = new Set(wonContenders.map((lead) => lead.id));
  const contenderOutcomes = await runWorkerPool(
    wonContenders,
    context.profile.mutationConcurrency,
    async (lead, index): Promise<{
      lead: LeadPayload;
      outcome: 'won' | 'property_conflict';
    }> => {
      let outcome: 'won' | 'property_conflict' | null = null;
      await apiRequest(context, 'PATCH', `/v1/leads/${lead.id}`, {
        token: context.tokenByUserId.get(lead.assignedUserId!)!,
        metricName: OUTCOME_METRIC,
        phase: `outcome-contender-${index}`,
        expectedStatuses: [200, 409],
        validateResponse(status, payload) {
          outcome = classifySharedPropertyOutcome(status, payload, lead.id);
        },
        body: { dealStatus: 'won', interestValue: '750000' },
      });
      if (!outcome) {
        throw new Error(`Shared-property outcome was not classified for lead ${lead.id}.`);
      }
      return { lead, outcome };
    },
  );

  const wonOutcomes = contenderOutcomes.filter((result) => result.outcome === 'won');
  const conflictOutcomes = contenderOutcomes.filter(
    (result) => result.outcome === 'property_conflict',
  );
  context.gates.check(
    'lifecycle.shared_property.single_winner',
    wonOutcomes.length === 1,
    wonOutcomes.length,
    1,
  );
  context.gates.check(
    'lifecycle.shared_property.expected_conflicts',
    conflictOutcomes.length === wonContenderIds.size - 1,
    conflictOutcomes.length,
    wonContenderIds.size - 1,
  );
  context.gates.throwIfFailedSince(mark, 'shared property contention');

  const winnerLeadId = wonOutcomes[0].lead.id;
  const losingLeads = leads.filter((lead) => lead.id !== winnerLeadId);
  await runWorkerPool(
    losingLeads,
    context.profile.mutationConcurrency,
    async (lead, index) => {
      await apiRequest(context, 'PATCH', `/v1/leads/${lead.id}`, {
        token: context.tokenByUserId.get(lead.assignedUserId!)!,
        metricName: OUTCOME_METRIC,
        phase: `outcome-loser-${index}`,
        body: {
          dealStatus: 'lost',
          lostReason: wonContenderIds.has(lead.id)
            ? 'Imovel compartilhado reservado por outro atendimento'
            : 'Sem interesse',
        },
      });
    },
  );

  const wonLeadIds = new Set(wonOutcomes.map(({ lead }) => lead.id));

  const persisted = await inspectLifecyclePersistence(context.pool, leadIds);
  const wonCount = wonLeadIds.size;
  const lostCount = leadIds.length - wonCount;
  context.gates.check('lifecycle.first_response', persisted.firstResponses === leadIds.length, persisted.firstResponses, leadIds.length);
  context.gates.check('lifecycle.feedback', persisted.feedbacks === leadIds.length, persisted.feedbacks, leadIds.length);
  context.gates.check('lifecycle.won', persisted.won === wonCount, persisted.won, wonCount);
  context.gates.check('lifecycle.lost', persisted.lost === lostCount, persisted.lost, lostCount);
  context.gates.check('lifecycle.won_timestamp', persisted.wonTimestamps === wonCount, persisted.wonTimestamps, wonCount);
  context.gates.check('lifecycle.lost_timestamp', persisted.lostTimestamps === lostCount, persisted.lostTimestamps, lostCount);
  const reservation = await waitForSharedPropertyReservation(
    context.pool,
    leadIds,
    context.manifest.createdAt,
  );
  context.gates.check(
    'lifecycle.shared_property.reserved',
    reservation.propertyStatus === 'reserved',
    reservation.propertyStatus,
    'reserved',
  );
  context.gates.check(
    'lifecycle.shared_property.single_reservation_event',
    reservation.reservationEvents === 1,
    reservation.reservationEvents,
    1,
  );
  context.gates.check(
    'lifecycle.shared_property.reserved_by_winner',
    reservation.reservedByLeadId === winnerLeadId,
    reservation.reservedByLeadId,
    winnerLeadId,
  );
  context.gates.check(
    'lifecycle.shared_property.notification_event_processed',
    reservation.eventStatus === 'processed',
    reservation.eventStatus,
    'processed',
  );
  context.gates.check(
    'lifecycle.shared_property.notification_target_snapshot',
    reservation.targetCount === expectedReservationTargetCount,
    reservation.targetCount,
    expectedReservationTargetCount,
  );
  context.gates.check(
    'lifecycle.shared_property.notification_fanout',
    reservation.deliveredCount === expectedReservationTargetCount,
    reservation.deliveredCount,
    expectedReservationTargetCount,
  );
  context.gates.throwIfFailedSince(mark, 'lifecycle persistence');

  const automationId = context.manifest.automationId;
  if (!automationId) throw new Error('Automation id is missing from the run manifest.');
  const starts = await runWorkerPool(
    leadIds,
    context.profile.automationConcurrency,
    async (leadId, index) => {
      const envelope = await apiRequest<{
        data: { executionId: string; executorStarted: boolean; dispatchPending: boolean };
      }>(context, 'POST', `/v1/automations/${automationId}/start`, {
        token: context.tokens.admin,
        metricName: AUTOMATION_START_METRIC,
        phase: `automation-start-${index}`,
        body: { leadId },
      });
      return envelope.data;
    },
  );
  const executionIds = starts.map((start) => start.executionId);
  context.manifest.executionIds.push(...executionIds);
  await persistContextManifest(context);
  context.gates.check('automation.execution_ids', new Set(executionIds).size === leadIds.length, new Set(executionIds).size, leadIds.length);
  context.gates.check(
    'automation.initial_dispatch',
    starts.every((start) => start.executorStarted || start.dispatchPending),
    starts.filter((start) => start.executorStarted || start.dispatchPending).length,
    starts.length,
  );

  const automationState = await waitForAutomationCompletion(context, automationId, executionIds, leadIds);
  context.gates.check('automation.completed', automationState.completed === leadIds.length, automationState.completed, leadIds.length);
  context.gates.check('automation.failed', automationState.failed === 0, automationState.failed, 0);
  context.gates.check('automation.active', automationState.active === 0, automationState.active, 0);
  context.gates.check('automation.tags', automationState.tags === leadIds.length, automationState.tags, leadIds.length);
  context.gates.check('automation.duplicate_tags', automationState.duplicateTags === 0, automationState.duplicateTags, 0);
  context.gates.check('automation.effects', automationState.effects === leadIds.length, automationState.effects, leadIds.length);
  context.gates.check('automation.failed_effects', automationState.failedEffects === 0, automationState.failedEffects, 0);
  context.gates.check('automation.outbox_backlog', automationState.outboxBacklog === 0, automationState.outboxBacklog, 0);

  const issues = await apiRequest<{
    data: { summary: RuntimeIssueSummary; issues: Array<{ automationId?: string; leadId?: string }> };
  }>(context, 'GET', '/v1/automation-runtime/issues', {
    token: context.tokens.admin,
    phase: 'runtime-after',
  });
  const leadIdSet = new Set(leadIds);
  const currentRunIssues = issues.data.issues.filter(
    (issue) => issue.automationId === automationId || (issue.leadId && leadIdSet.has(issue.leadId)),
  );
  context.gates.check('automation.runtime_issues', currentRunIssues.length === 0, currentRunIssues.length, 0);
  if (context.runtimeIssueBaseline) {
    for (const key of ['deadLetters', 'failedEvents', 'failedEffects', 'unknownEffects'] as const) {
      context.gates.check(
        `automation.runtime_delta.${key}`,
        issues.data.summary[key] <= context.runtimeIssueBaseline[key],
        issues.data.summary[key] - context.runtimeIssueBaseline[key],
        '<= 0',
      );
    }
  }
  context.gates.throwIfFailedSince(mark, 'automation lifecycle');

  const dashboardTo = new Date(Date.now() + 2_000);
  await validateDashboard(context, {
    campaign,
    from: dashboardFrom,
    to: dashboardTo,
    total: leadIds.length,
    won: wonCount,
    lost: lostCount,
    assignmentCounts: distribution.assignmentCounts,
  });
  await runDashboardReadLoad(context, campaign, dashboardFrom, dashboardTo);
  context.gates.throwIfFailedSince(mark, 'dashboard lifecycle');
}

async function submitIntake(context: RunContext, spec: IntakeSpec, phase: string) {
  return apiRequest<PublicContactResult>(context, 'POST', '/v1/public/site/contact', {
    metricName: INTAKE_METRIC,
    phase,
    body: {
      organization_id: E2E_ORGANIZATION_ID,
      submission_id: spec.submissionId,
      session_id: spec.sessionId,
      name: `Carga ${context.runId} ${spec.index}`,
      email: `load+${context.runId}-${spec.index}@vimob.test`,
      phone: spec.phone,
      message: 'Ciclo local de confiabilidade.',
      privacy_accepted: true,
      privacy_url: 'http://127.0.0.1:3000/privacidade',
      property_id: E2E_PROPERTY_ID,
      property_code: 'E2E-SITE-001',
      landing_page: '/imoveis/E2E-SITE-001',
      utm_source: 'vimob-load',
      utm_medium: 'local',
      utm_campaign: spec.campaign,
    },
  });
}

async function assertDistribution(
  context: RunContext,
  {
    gatePrefix,
    leadIds,
    queueId,
    expectTeam,
  }: {
    gatePrefix: string;
    leadIds: string[];
    queueId: string;
    expectTeam: boolean;
  },
) {
  const inspection = await inspectDistribution(
    context.pool,
    leadIds,
    queueId,
    expectTeam,
    [context.userIds.leader, context.userIds.user],
  );
  const counts = [
    inspection.assignmentCounts[context.userIds.leader] || 0,
    inspection.assignmentCounts[context.userIds.user] || 0,
  ];
  const fairnessDelta = Math.max(...counts) - Math.min(...counts);

  context.gates.check(`${gatePrefix}.total`, inspection.total === leadIds.length, inspection.total, leadIds.length);
  context.gates.check(`${gatePrefix}.assigned`, inspection.assigned === leadIds.length, inspection.assigned, leadIds.length);
  context.gates.check(`${gatePrefix}.assignment_log`, inspection.assignments === leadIds.length, inspection.assignments, leadIds.length);
  context.gates.check(`${gatePrefix}.queue`, inspection.wrongQueueAssignments === 0, inspection.wrongQueueAssignments, 0);
  context.gates.check(`${gatePrefix}.no_matching_queue`, inspection.noMatchingQueue === 0, inspection.noMatchingQueue, 0);
  context.gates.check(`${gatePrefix}.no_available_members`, inspection.noAvailableMembers === 0, inspection.noAvailableMembers, 0);
  context.gates.check(`${gatePrefix}.fairness`, fairnessDelta <= 1, fairnessDelta, '<= 1');
  if (expectTeam) {
    context.gates.check(`${gatePrefix}.team_id`, inspection.expectedTeam === leadIds.length, inspection.expectedTeam, leadIds.length);
  }
  return inspection;
}

async function inspectDistribution(
  pool: Pool,
  leadIds: string[],
  queueId: string,
  expectTeam: boolean,
  expectedUserIds: string[],
): Promise<DistributionInspection> {
  if (leadIds.length === 0) {
    return {
      total: 0,
      assigned: 0,
      expectedTeam: 0,
      assignments: 0,
      wrongQueueAssignments: 0,
      noMatchingQueue: 0,
      noAvailableMembers: 0,
      assignmentCounts: Object.fromEntries(expectedUserIds.map((id) => [id, 0])),
    };
  }
  const aggregate = await pool.query<{
    total: string;
    assigned: string;
    expected_team: string;
    assignments: string;
    wrong_queue_assignments: string;
    no_matching_queue: string;
    no_available_members: string;
  }>(
    `
      select
        count(*)::text as total,
        count(*) filter (where l.assigned_user_id is not null)::text as assigned,
        count(*) filter (where l.team_id = $4::uuid)::text as expected_team,
        (select count(*) from public.assignments_log a
          where a.organization_id = $1::uuid and a.lead_id = any($2::uuid[]))::text as assignments,
        (select count(*) from public.assignments_log a
          where a.organization_id = $1::uuid and a.lead_id = any($2::uuid[])
            and a.round_robin_id is distinct from $3::uuid)::text as wrong_queue_assignments,
        (select count(*) from public.round_robin_logs r
          where r.organization_id = $1::uuid and r.lead_id = any($2::uuid[])
            and r.reason = 'no_matching_queue')::text as no_matching_queue,
        (select count(*) from public.round_robin_logs r
          where r.organization_id = $1::uuid and r.lead_id = any($2::uuid[])
            and r.reason = 'no_available_members')::text as no_available_members
      from public.leads l
      where l.organization_id = $1::uuid and l.id = any($2::uuid[])
    `,
    [E2E_ORGANIZATION_ID, leadIds, queueId, E2E_TEAM_ID],
  );
  const grouped = await pool.query<{ assigned_user_id: string; count: string }>(
    `
      select assigned_user_id::text, count(*)::text
      from public.leads
      where organization_id = $1::uuid and id = any($2::uuid[])
        and assigned_user_id is not null
      group by assigned_user_id
    `,
    [E2E_ORGANIZATION_ID, leadIds],
  );
  const assignmentCounts = Object.fromEntries(expectedUserIds.map((id) => [id, 0]));
  for (const row of grouped.rows) assignmentCounts[row.assigned_user_id] = Number(row.count);
  const row = aggregate.rows[0];
  return {
    total: Number(row.total),
    assigned: Number(row.assigned),
    expectedTeam: expectTeam ? Number(row.expected_team) : 0,
    assignments: Number(row.assignments),
    wrongQueueAssignments: Number(row.wrong_queue_assignments),
    noMatchingQueue: Number(row.no_matching_queue),
    noAvailableMembers: Number(row.no_available_members),
    assignmentCounts,
  };
}

async function assertRoleVisibility(context: RunContext, leads: LeadPayload[]) {
  const userLead = leads.find((lead) => lead.assignedUserId === context.userIds.user);
  const leaderLead = leads.find((lead) => lead.assignedUserId === context.userIds.leader);
  if (!userLead || !leaderLead) {
    context.gates.check('roles.both_assignees_present', false, {
      user: Boolean(userLead),
      leader: Boolean(leaderLead),
    }, { user: true, leader: true });
    return;
  }

  await apiRequest(context, 'GET', `/v1/leads/${leaderLead.id}`, {
    token: context.tokens.user,
    metricName: `${LEAD_READ_METRIC} unauthorized`,
    phase: 'visibility-user-denied',
    expectedStatuses: [404],
  });
  context.gates.check('roles.user_cannot_view_leader_lead', true, 404, 404);

  const visible = await apiRequest<{ data: LeadPayload }>(
    context,
    'GET',
    `/v1/leads/${userLead.id}`,
    {
      token: context.tokens.leader,
      metricName: `${LEAD_READ_METRIC} leader`,
      phase: 'visibility-leader-team',
    },
  );
  context.gates.check('roles.leader_can_view_team_lead', visible.data.id === userLead.id, visible.data.id, userLead.id);
}

function classifySharedPropertyOutcome(
  status: number,
  payload: unknown,
  expectedLeadId: string,
): 'won' | 'property_conflict' {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Shared-property outcome ${status} returned an invalid payload.`);
  }
  const envelope = payload as Record<string, unknown>;
  if (status === 200) {
    const data = envelope.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Shared-property winner response is missing data.');
    }
    if ((data as Record<string, unknown>).id !== expectedLeadId) {
      throw new Error('Shared-property winner response returned an unexpected lead.');
    }
    return 'won';
  }
  if (status === 409) {
    const apiError = envelope.error;
    const code = apiError && typeof apiError === 'object' && !Array.isArray(apiError)
      ? (apiError as Record<string, unknown>).code
      : undefined;
    if (code !== 'lead_property_unavailable') {
      throw new Error(
        `Unexpected shared-property conflict code "${String(code || 'missing')}".`,
      );
    }
    return 'property_conflict';
  }
  throw new Error(`Unexpected shared-property outcome status ${status}.`);
}

async function inspectLifecyclePersistence(pool: Pool, leadIds: string[]) {
  const result = await pool.query<{
    first_responses: string;
    feedbacks: string;
    won: string;
    lost: string;
    won_timestamps: string;
    lost_timestamps: string;
  }>(
    `
      select
        count(*) filter (where first_response_at is not null
          and first_response_is_automation = false)::text as first_responses,
        count(*) filter (where nullif(feedback, '') is not null)::text as feedbacks,
        count(*) filter (where deal_status = 'won')::text as won,
        count(*) filter (where deal_status = 'lost')::text as lost,
        count(*) filter (where deal_status = 'won' and won_at is not null)::text as won_timestamps,
        count(*) filter (where deal_status = 'lost' and lost_at is not null)::text as lost_timestamps
      from public.leads
      where organization_id = $1::uuid and id = any($2::uuid[])
    `,
    [E2E_ORGANIZATION_ID, leadIds],
  );
  const row = result.rows[0];
  return {
    firstResponses: Number(row.first_responses),
    feedbacks: Number(row.feedbacks),
    won: Number(row.won),
    lost: Number(row.lost),
    wonTimestamps: Number(row.won_timestamps),
    lostTimestamps: Number(row.lost_timestamps),
  };
}

async function inspectSharedPropertyReservation(
  pool: Pool,
  leadIds: string[],
  runStartedAt: string,
) {
  const result = await pool.query<{
    property_status: string;
    reservation_events: string;
    reserved_by_lead_id: string;
    event_status: string;
    target_count: string;
    delivered_count: string;
  }>(
    `
      select
        coalesce(p.status, '')::text as property_status,
        (
          select count(*)::text
          from public.events e
          where e.organization_id = $1::uuid
            and e.entity_type = 'property'
            and e.entity_id = $2::uuid
            and e.event_type = 'property_reserved_by_won_lead'
            and e.created_at >= $4::timestamptz
            and e.payload->>'reserved_by_lead_id' = any($3::text[])
        ) as reservation_events,
        coalesce((
          select e.payload->>'reserved_by_lead_id'
          from public.events e
          where e.organization_id = $1::uuid
            and e.entity_type = 'property'
            and e.entity_id = $2::uuid
            and e.event_type = 'property_reserved_by_won_lead'
            and e.created_at >= $4::timestamptz
            and e.payload->>'reserved_by_lead_id' = any($3::text[])
          order by e.created_at desc
          limit 1
        ), '') as reserved_by_lead_id,
        coalesce((
          select e.status
          from public.events e
          where e.organization_id = $1::uuid
            and e.entity_type = 'property'
            and e.entity_id = $2::uuid
            and e.event_type = 'property_reserved_by_won_lead'
            and e.created_at >= $4::timestamptz
            and e.payload->>'reserved_by_lead_id' = any($3::text[])
          order by e.created_at desc
          limit 1
        ), '') as event_status,
        coalesce((
          select e.payload->>'target_count'
          from public.events e
          where e.organization_id = $1::uuid
            and e.entity_type = 'property'
            and e.entity_id = $2::uuid
            and e.event_type = 'property_reserved_by_won_lead'
            and e.created_at >= $4::timestamptz
            and e.payload->>'reserved_by_lead_id' = any($3::text[])
          order by e.created_at desc
          limit 1
        ), '-1') as target_count,
        coalesce((
          select e.payload->>'delivered_count'
          from public.events e
          where e.organization_id = $1::uuid
            and e.entity_type = 'property'
            and e.entity_id = $2::uuid
            and e.event_type = 'property_reserved_by_won_lead'
            and e.created_at >= $4::timestamptz
            and e.payload->>'reserved_by_lead_id' = any($3::text[])
          order by e.created_at desc
          limit 1
        ), '-1') as delivered_count
      from public.properties p
      where p.organization_id = $1::uuid
        and p.id = $2::uuid
    `,
    [E2E_ORGANIZATION_ID, E2E_PROPERTY_ID, leadIds, runStartedAt],
  );
  const row = result.rows[0];
  if (!row) {
    return {
      propertyStatus: '',
      reservationEvents: 0,
      reservedByLeadId: '',
      eventStatus: '',
      targetCount: -1,
      deliveredCount: -1,
    };
  }
  return {
    propertyStatus: row.property_status,
    reservationEvents: Number(row.reservation_events),
    reservedByLeadId: row.reserved_by_lead_id,
    eventStatus: row.event_status,
    targetCount: Number(row.target_count),
    deliveredCount: Number(row.delivered_count),
  };
}

async function countOpenPropertyReservationAudience(pool: Pool) {
  const result = await pool.query<{ count: string }>(
    `
      select count(*)::text
      from public.leads lead
      where lead.organization_id = $1::uuid
        and lead.assigned_user_id is not null
        and coalesce(lead.deal_status, 'open') not in ('won', 'lost')
        and (
          lead.interest_property_id = $2::uuid
          or lead.property_id = $2::uuid
        )
    `,
    [E2E_ORGANIZATION_ID, E2E_PROPERTY_ID],
  );
  return Number(result.rows[0]?.count || 0);
}

async function waitForSharedPropertyReservation(
  pool: Pool,
  leadIds: string[],
  runStartedAt: string,
) {
  const deadline = Date.now() + 20_000;
  let state = await inspectSharedPropertyReservation(pool, leadIds, runStartedAt);
  while (Date.now() < deadline) {
    if (
      state.reservationEvents === 1 &&
      state.eventStatus === 'processed' &&
      state.deliveredCount === state.targetCount
    ) {
      return state;
    }
    await delay(250);
    state = await inspectSharedPropertyReservation(pool, leadIds, runStartedAt);
  }
  return state;
}

async function waitForAutomationCompletion(
  context: RunContext,
  automationId: string,
  executionIds: string[],
  leadIds: string[],
) {
  const deadline = Date.now() + context.profile.automationDeadlineMs;
  let lastState = await inspectAutomationState(context.pool, executionIds, leadIds, context.manifest.tagId!);
  while (Date.now() < deadline) {
    await apiRequest(context, 'GET', `/v1/automation-executions?automationId=${automationId}&limit=200`, {
      token: context.tokens.admin,
      metricName: AUTOMATION_LIST_METRIC,
      phase: 'automation-poll',
    });
    lastState = await inspectAutomationState(
      context.pool,
      executionIds,
      leadIds,
      context.manifest.tagId!,
    );
    if (
      lastState.completed === executionIds.length &&
      lastState.active === 0 &&
      lastState.outboxBacklog === 0
    ) {
      return lastState;
    }
    await delay(500);
  }
  return lastState;
}

async function inspectAutomationState(
  pool: Pool,
  executionIds: string[],
  leadIds: string[],
  tagId: string,
) {
  const result = await pool.query<{
    completed: string;
    failed: string;
    active: string;
    tags: string;
    duplicate_tags: string;
    effects: string;
    failed_effects: string;
    outbox_backlog: string;
  }>(
    `
      select
        (select count(*) from public.automation_executions e
          where e.organization_id = $1::uuid and e.id = any($2::uuid[])
            and e.status = 'completed')::text as completed,
        (select count(*) from public.automation_executions e
          where e.organization_id = $1::uuid and e.id = any($2::uuid[])
            and e.status in ('failed', 'cancelled', 'canceled'))::text as failed,
        (select count(*) from public.automation_executions e
          where e.organization_id = $1::uuid and e.id = any($2::uuid[])
            and e.status in ('queued', 'running', 'waiting'))::text as active,
        (select count(*) from public.lead_tags lt
          where lt.organization_id = $1::uuid and lt.lead_id = any($3::uuid[])
            and lt.tag_id = $4::uuid)::text as tags,
        (select count(*) from (
          select lead_id, tag_id, count(*)
          from public.lead_tags
          where organization_id = $1::uuid and lead_id = any($3::uuid[]) and tag_id = $4::uuid
          group by lead_id, tag_id having count(*) > 1
        ) duplicates)::text as duplicate_tags,
        (select count(*) from public.automation_effect_dispatches d
          where d.organization_id = $1::uuid and d.execution_id = any($2::uuid[])
            and d.effect_type = 'add_tag' and d.status = 'succeeded')::text as effects,
        (select count(*) from public.automation_effect_dispatches d
          where d.organization_id = $1::uuid and d.execution_id = any($2::uuid[])
            and d.status in ('failed', 'unknown', 'sending'))::text as failed_effects,
        (select count(*) from public.automation_event_outbox o
          where o.organization_id = $1::uuid and o.lead_id = any($3::uuid[])
            and o.status in ('pending', 'processing', 'failed', 'dead_letter'))::text as outbox_backlog
    `,
    [E2E_ORGANIZATION_ID, executionIds, leadIds, tagId],
  );
  const row = result.rows[0];
  return {
    completed: Number(row.completed),
    failed: Number(row.failed),
    active: Number(row.active),
    tags: Number(row.tags),
    duplicateTags: Number(row.duplicate_tags),
    effects: Number(row.effects),
    failedEffects: Number(row.failed_effects),
    outboxBacklog: Number(row.outbox_backlog),
  };
}

async function validateDashboard(
  context: RunContext,
  expected: {
    campaign: string;
    from: Date;
    to: Date;
    total: number;
    won: number;
    lost: number;
    assignmentCounts: Record<string, number>;
  },
) {
  const query = dashboardQuery(expected.campaign, expected.from, expected.to);
  const adminStats = await waitForDashboardStats(context, query, expected);
  const leaderStats = dataOf<DashboardStats>(
    await apiRequest(context, 'GET', `/v1/dashboard/stats?${query}`, {
      token: context.tokens.leader,
      metricName: 'GET /v1/dashboard/stats',
      phase: 'dashboard-leader',
    }),
  );
  const userStats = dataOf<DashboardStats>(
    await apiRequest(context, 'GET', `/v1/dashboard/stats?${query}`, {
      token: context.tokens.user,
      metricName: 'GET /v1/dashboard/stats',
      phase: 'dashboard-user',
    }),
  );
  const funnel = dataOf<Array<{ value: number }>>(
    await apiRequest(context, 'GET', `/v1/dashboard/funnel?${query}`, {
      token: context.tokens.admin,
      metricName: 'GET /v1/dashboard/funnel',
      phase: 'dashboard-funnel',
    }),
  );
  const sources = dataOf<Array<{ rawSource: string; value: number }>>(
    await apiRequest(context, 'GET', `/v1/dashboard/sources?${query}`, {
      token: context.tokens.admin,
      metricName: 'GET /v1/dashboard/sources',
      phase: 'dashboard-sources',
    }),
  );
  const topBrokers = dataOf<{ brokers: Array<{ closedLeads: number }> }>(
    await apiRequest(context, 'GET', `/v1/dashboard/top-brokers?${query}`, {
      token: context.tokens.admin,
      metricName: 'GET /v1/dashboard/top-brokers',
      phase: 'dashboard-top-brokers',
    }),
  );
  const evolution = dataOf<Array<{ ganhos: number; perdas: number }>>(
    await apiRequest(context, 'GET', `/v1/dashboard/deals-evolution?${query}&granularity=hour`, {
      token: context.tokens.admin,
      metricName: 'GET /v1/dashboard/deals-evolution',
      phase: 'dashboard-evolution',
    }),
  );
  const extra = dataOf<{ propertyCount: number; siteVisits: number; scheduledVisits: number }>(
    await apiRequest(context, 'GET', `/v1/dashboard/extra-counts?${query}`, {
      token: context.tokens.admin,
      metricName: 'GET /v1/dashboard/extra-counts',
      phase: 'dashboard-extra',
    }),
  );

  context.gates.check('dashboard.admin.total', adminStats.totalLeads === expected.total, adminStats.totalLeads, expected.total);
  context.gates.check('dashboard.admin.open', adminStats.openLeads === 0, adminStats.openLeads, 0);
  context.gates.check('dashboard.admin.won', adminStats.closedLeads === expected.won, adminStats.closedLeads, expected.won);
  context.gates.check('dashboard.admin.lost', adminStats.lostLeads === expected.lost, adminStats.lostLeads, expected.lost);
  const expectedConversion = expected.total === 0 ? 0 : (expected.won / expected.total) * 100;
  context.gates.check(
    'dashboard.admin.conversion',
    Math.abs(adminStats.conversionRate - expectedConversion) < 0.01,
    adminStats.conversionRate,
    expectedConversion,
  );
  context.gates.check('dashboard.leader.total', leaderStats.totalLeads === expected.total, leaderStats.totalLeads, expected.total);
  context.gates.check(
    'dashboard.user.total',
    userStats.totalLeads === (expected.assignmentCounts[context.userIds.user] || 0),
    userStats.totalLeads,
    expected.assignmentCounts[context.userIds.user] || 0,
  );
  context.gates.check(
    'dashboard.funnel',
    funnel.reduce((sum, item) => sum + item.value, 0) === expected.total,
    funnel.reduce((sum, item) => sum + item.value, 0),
    expected.total,
  );
  const siteSource = sources.find((source) => source.rawSource === 'site');
  context.gates.check('dashboard.source_site', siteSource?.value === expected.total, siteSource?.value, expected.total);
  context.gates.check(
    'dashboard.top_brokers',
    topBrokers.brokers.reduce((sum, broker) => sum + broker.closedLeads, 0) === expected.won,
    topBrokers.brokers.reduce((sum, broker) => sum + broker.closedLeads, 0),
    expected.won,
  );
  context.gates.check(
    'dashboard.evolution_won',
    evolution.reduce((sum, point) => sum + point.ganhos, 0) === expected.won,
    evolution.reduce((sum, point) => sum + point.ganhos, 0),
    expected.won,
  );
  context.gates.check(
    'dashboard.evolution_lost',
    evolution.reduce((sum, point) => sum + point.perdas, 0) === expected.lost,
    evolution.reduce((sum, point) => sum + point.perdas, 0),
    expected.lost,
  );
  context.gates.check(
    'dashboard.extra_shape',
    [extra.propertyCount, extra.siteVisits, extra.scheduledVisits].every(
      (value) => Number.isFinite(value) && value >= 0,
    ),
    extra,
    'non-negative counters',
  );
}

type DashboardStats = {
  totalLeads: number;
  openLeads: number;
  closedLeads: number;
  lostLeads: number;
  conversionRate: number;
};

async function waitForDashboardStats(
  context: RunContext,
  query: string,
  expected: { total: number; won: number; lost: number },
) {
  const deadline = Date.now() + 10_000;
  let stats: DashboardStats = {
    totalLeads: -1,
    openLeads: -1,
    closedLeads: -1,
    lostLeads: -1,
    conversionRate: -1,
  };
  do {
    stats = dataOf<DashboardStats>(
      await apiRequest(context, 'GET', `/v1/dashboard/stats?${query}`, {
        token: context.tokens.admin,
        metricName: 'GET /v1/dashboard/stats',
        phase: 'dashboard-convergence',
      }),
    );
    if (
      stats.totalLeads === expected.total &&
      stats.closedLeads === expected.won &&
      stats.lostLeads === expected.lost
    ) {
      return stats;
    }
    await delay(250);
  } while (Date.now() < deadline);
  return stats;
}

async function runDashboardReadLoad(
  context: RunContext,
  campaign: string,
  from: Date,
  to: Date,
) {
  const query = dashboardQuery(campaign, from, to);
  const endpoints = [
    { path: `/v1/dashboard/stats?${query}`, metric: 'GET /v1/dashboard/stats' },
    { path: `/v1/dashboard/funnel?${query}`, metric: 'GET /v1/dashboard/funnel' },
    { path: `/v1/dashboard/sources?${query}`, metric: 'GET /v1/dashboard/sources' },
    { path: `/v1/dashboard/top-brokers?${query}`, metric: 'GET /v1/dashboard/top-brokers' },
    {
      path: `/v1/dashboard/deals-evolution?${query}&granularity=hour`,
      metric: 'GET /v1/dashboard/deals-evolution',
    },
    { path: `/v1/dashboard/extra-counts?${query}`, metric: 'GET /v1/dashboard/extra-counts' },
  ];
  const jobs = endpoints.flatMap((endpoint) =>
    Array.from({ length: context.profile.dashboardRequestsPerEndpoint }, () => endpoint),
  );
  await runWorkerPool(jobs, context.profile.dashboardConcurrency, (job, index) =>
    apiRequest(context, 'GET', job.path, {
      token: context.tokens.admin,
      metricName: job.metric,
      phase: `dashboard-load-${index}`,
    }),
  );
}

function dashboardQuery(campaign: string, from: Date, to: Date) {
  return new URLSearchParams({
    source: 'site',
    campaignId: campaign,
    pipelineId: E2E_PIPELINE_ID,
    dateFrom: from.toISOString(),
    dateTo: to.toISOString(),
  }).toString();
}

function metricGateConfig() {
  const dashboardThreshold = { maxErrorRate: 0, maxP95Ms: 500, maxP99Ms: 1_000 };
  return {
    maxErrorRate: 0.005,
    requireNoServerErrors: true,
    endpointThresholds: {
      [INTAKE_METRIC]: { maxErrorRate: 0, maxP95Ms: 750, maxP99Ms: 1_500 },
      [LEAD_READ_METRIC]: { maxErrorRate: 0, maxP95Ms: 500, maxP99Ms: 1_000 },
      [FIRST_RESPONSE_METRIC]: { maxErrorRate: 0, maxP95Ms: 500, maxP99Ms: 1_000 },
      [FEEDBACK_METRIC]: { maxErrorRate: 0, maxP95Ms: 500, maxP99Ms: 1_000 },
      [OUTCOME_METRIC]: { maxErrorRate: 0, maxP95Ms: 500, maxP99Ms: 1_000 },
      [AUTOMATION_START_METRIC]: { maxErrorRate: 0, maxP95Ms: 1_000, maxP99Ms: 2_000 },
      'GET /v1/dashboard/stats': dashboardThreshold,
      'GET /v1/dashboard/funnel': dashboardThreshold,
      'GET /v1/dashboard/sources': dashboardThreshold,
      'GET /v1/dashboard/top-brokers': dashboardThreshold,
      'GET /v1/dashboard/deals-evolution': dashboardThreshold,
      'GET /v1/dashboard/extra-counts': dashboardThreshold,
    },
  };
}

async function captureDatabaseSnapshot(pool: Pool): Promise<DatabaseSnapshot> {
  const result = await pool.query<{ deadlocks: string; numbackends: number }>(
    `
      select deadlocks::text, numbackends
      from pg_stat_database
      where datname = current_database()
    `,
  );
  return {
    deadlocks: Number(result.rows[0]?.deadlocks || 0),
    connections: Number(result.rows[0]?.numbackends || 0),
  };
}

async function readRelevantStatementStats(pool: Pool) {
  try {
    const extension = await pool.query<{ installed: boolean }>(
      `select exists(select 1 from pg_extension where extname = 'pg_stat_statements') as installed`,
    );
    if (!extension.rows[0]?.installed) return [];
    const result = await pool.query<{
      calls: string;
      total_exec_time: number;
      mean_exec_time: number;
      query: string;
    }>(
      `
        select calls::text, total_exec_time, mean_exec_time,
               left(regexp_replace(query, '\\s+', ' ', 'g'), 500) as query
        from pg_stat_statements
        where query ilike any(array[
          '%handle_lead_intake%',
          '%dashboard%',
          '%automation_executions%',
          '%lead_entry_events%'
        ])
        order by total_exec_time desc
        limit 10
      `,
    );
    return result.rows.map((row) => ({
      calls: Number(row.calls),
      totalExecMs: Number(Number(row.total_exec_time).toFixed(2)),
      meanExecMs: Number(Number(row.mean_exec_time).toFixed(2)),
      query: row.query,
    }));
  } catch {
    return [];
  }
}

async function cleanupRunArtifacts({
  config,
  pool,
  runId,
  manifest,
  adminToken,
  requestTimeoutMs,
}: {
  config: LocalConfig;
  pool: Pool;
  runId: string;
  manifest: RunManifest | null;
  adminToken?: string;
  requestTimeoutMs: number;
}) {
  validateRunId(runId);
  await assertE2EOrganization(pool);
  const discovered = await discoverRunArtifacts(pool, runId);
  const expectedMemberIds = await discoverExpectedE2EMemberIDs(pool);
  const warnings: string[] = [];
  const availabilitySnapshots: Record<string, AvailabilityItem[]> = {};
  if (manifest) {
    for (const [memberId, availability] of Object.entries(manifest.availabilitySnapshots)) {
      if (!expectedMemberIds.includes(memberId)) {
        warnings.push(`Ignored availability snapshot for non-E2E member ${memberId}.`);
        continue;
      }
      if (availability.length !== 0) {
        throw new Error(
          `Refusing cleanup: run ${runId} contains a non-empty pre-run availability snapshot, ` +
          'which violates the freshly-reset database invariant.',
        );
      }
      availabilitySnapshots[memberId] = [];
    }
  }
  let teamPipelineCreated = false;
  if (manifest?.teamPipelineCreated) {
    teamPipelineCreated = await hasRunTeamPipelineAudit(pool, manifest.createdAt);
    if (!teamPipelineCreated) {
      warnings.push('Ignored teamPipelineCreated without matching run-window audit evidence.');
    }
  }
  const merged: RunManifest = {
    version: MANIFEST_VERSION,
    runId,
    organizationId: E2E_ORGANIZATION_ID,
    createdAt: manifest?.createdAt || new Date(0).toISOString(),
    profile: manifest?.profile || 'smoke',
    queueIds: discovered.queueIds,
    automationId: discovered.automationIds[0] || null,
    tagId: discovered.tagIds[0] || null,
    leadIds: discovered.leadIds,
    executionIds: discovered.executionIds,
    availabilitySnapshots,
    teamPipelineCreated,
  };

  if (!manifest && Object.keys(merged.availabilitySnapshots).length === 0) {
    warnings.push('Manifesto ausente: escala e vinculo equipe-pipeline nao serao alterados.');
  }
  await assertNoProcessedGamificationArtifacts(pool, merged.leadIds);

  if (adminToken) {
    await bestEffortAPICleanup({
      config,
      manifest: merged,
      adminToken,
      requestTimeoutMs,
      warnings,
    });
  } else {
    warnings.push('API cleanup skipped because the local admin session was unavailable.');
  }

  const hardCleanup = await hardDeleteRunArtifacts(pool, merged);
  const verification = await verifyRunCleanup(pool, merged);
  if (Object.values(verification).some((count) => count !== 0)) {
    throw new Error(`Cleanup verification failed for run ${runId}.`);
  }

  const manifestPath = manifestPathFor(runId);
  await unlink(manifestPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  return { success: true, warnings, deleted: hardCleanup, verification };
}

async function assertNoProcessedGamificationArtifacts(pool: Pool, leadIds: string[]) {
  if (leadIds.length === 0) return;
  const result = await pool.query<{
    processed_outbox: string;
    events: string;
    activity_logs: string;
  }>(
    `
      select
        (select count(*) from public.gamification_outbox
          where organization_id = $1::uuid
            and reference_id = any($2::text[])
            and processed_event_id is not null)::text as processed_outbox,
        (select count(*) from public.gamification_events
          where organization_id = $1::uuid
            and reference_id = any($2::text[]))::text as events,
        (select count(*) from public.gamification_activity_logs
          where organization_id = $1::uuid
            and reference_id = any($2::uuid[]))::text as activity_logs
    `,
    [E2E_ORGANIZATION_ID, leadIds],
  );
  const derivedCount = Object.values(result.rows[0]).reduce(
    (sum, value) => sum + Number(value),
    0,
  );
  if (derivedCount !== 0) {
    throw new Error(
      `Refusing cleanup: ${derivedCount} processed gamification artifact(s) reference this run. ` +
      'Reset the dedicated local database to avoid corrupting aggregate scores.',
    );
  }
}

async function bestEffortAPICleanup({
  config,
  manifest,
  adminToken,
  requestTimeoutMs,
  warnings,
}: {
  config: LocalConfig;
  manifest: RunManifest;
  adminToken: string;
  requestTimeoutMs: number;
  warnings: string[];
}) {
  const request = async (method: string, requestPath: string, body?: unknown) => {
    try {
      await rawApiRequest({
        config,
        organizationId: E2E_ORGANIZATION_ID,
        method,
        requestPath,
        token: adminToken,
        body,
        expectedStatuses: method === 'DELETE' ? [204, 404] : undefined,
        timeoutMs: requestTimeoutMs,
        requestId: `${manifest.runId}:cleanup:${randomBytes(3).toString('hex')}`,
      });
    } catch (error) {
      warnings.push(`${method} ${requestPath.split('?')[0]}: ${safeErrorMessage(error)}`);
    }
  };

  if (manifest.automationId) {
    await request('POST', `/v1/automations/${manifest.automationId}/executions/cancel`);
    await request('DELETE', `/v1/automations/${manifest.automationId}`);
  }
  if (manifest.tagId) await request('DELETE', `/v1/tags/${manifest.tagId}`);
  for (const queueId of manifest.queueIds) await request('DELETE', `/v1/round-robins/${queueId}`);

  for (const [memberId, availability] of Object.entries(manifest.availabilitySnapshots)) {
    await request('PUT', `/v1/team-members/${memberId}/availability`, {
      availability: availability.map((item) => ({
        team_member_id: memberId,
        day_of_week: item.day_of_week,
        start_time: item.start_time,
        end_time: item.end_time,
        is_all_day: item.is_all_day,
        is_active: item.is_active,
      })),
    });
  }
  if (manifest.teamPipelineCreated) {
    const query = new URLSearchParams({
      teamId: E2E_TEAM_ID,
      pipelineId: E2E_PIPELINE_ID,
    });
    await request('DELETE', `/v1/team-pipelines?${query}`);
  }
}

async function discoverRunArtifacts(pool: Pool, runId: string) {
  const namePrefix = `${RESOURCE_PREFIX}${runId}:%`;
  const campaignPrefix = `${runId}:%`;
  const submissionPrefix = `load:${runId}:%`;
  const [queues, automations, executions, tags, leads] = await Promise.all([
    pool.query<{ id: string }>(
      `select id::text from public.round_robins where organization_id = $1::uuid and name like $2`,
      [E2E_ORGANIZATION_ID, namePrefix],
    ),
    pool.query<{ id: string }>(
      `select id::text from public.automations where organization_id = $1::uuid and name like $2`,
      [E2E_ORGANIZATION_ID, namePrefix],
    ),
    pool.query<{ id: string }>(
      `
        select execution.id::text
        from public.automation_executions as execution
        join public.automations as automation
          on automation.organization_id = execution.organization_id
         and automation.id = execution.automation_id
        where automation.organization_id = $1::uuid
          and automation.name like $2
      `,
      [E2E_ORGANIZATION_ID, namePrefix],
    ),
    pool.query<{ id: string }>(
      `select id::text from public.tags where organization_id = $1::uuid and name like $2`,
      [E2E_ORGANIZATION_ID, namePrefix],
    ),
    pool.query<{ id: string }>(
      `
        select distinct id::text
        from public.leads
        where organization_id = $1::uuid
          and (
            utm_campaign like $2
            or metadata->>'submission_id' like $3
            or id in (
              select lead_id from public.site_lead_submissions
              where organization_id = $1::uuid
                and submission_id like $3 and lead_id is not null
            )
          )
      `,
      [E2E_ORGANIZATION_ID, campaignPrefix, submissionPrefix],
    ),
  ]);
  return {
    queueIds: queues.rows.map((row) => row.id),
    automationIds: automations.rows.map((row) => row.id),
    executionIds: executions.rows.map((row) => row.id),
    tagIds: tags.rows.map((row) => row.id),
    leadIds: leads.rows.map((row) => row.id),
  };
}

async function discoverExpectedE2EMemberIDs(pool: Pool) {
  const result = await pool.query<{ id: string }>(
    `
      select member.id::text
      from public.team_members as member
      join public.users as app_user
        on app_user.organization_id = member.organization_id
       and app_user.id = member.user_id
      where member.organization_id = $1::uuid
        and member.team_id = $2::uuid
        and lower(app_user.email) = any($3::text[])
        and member.is_active = true
      order by member.id
    `,
    [E2E_ORGANIZATION_ID, E2E_TEAM_ID, EXPECTED_E2E_USER_EMAILS],
  );
  if (result.rows.length !== 2) {
    throw new Error(
      `Refusing cleanup: expected exactly two active E2E team members, found ${result.rows.length}.`,
    );
  }
  return result.rows.map((row) => row.id);
}

async function hasRunTeamPipelineAudit(pool: Pool, createdAt: string) {
  const result = await pool.query<{ present: boolean }>(
    `
      select exists (
        select 1
        from public.audit_logs
        where organization_id = $1::uuid
          and created_at >= $2::timestamptz
          and entity_type = 'team_pipeline'
          and coalesce(new_data->>'team_id', old_data->>'team_id', '') = $3
          and coalesce(new_data->>'pipeline_id', old_data->>'pipeline_id', '') = $4
      ) as present
    `,
    [E2E_ORGANIZATION_ID, createdAt, E2E_TEAM_ID, E2E_PIPELINE_ID],
  );
  return result.rows[0]?.present === true;
}

async function hardDeleteRunArtifacts(pool: Pool, manifest: RunManifest) {
  const client = await pool.connect();
  const deleted: Record<string, number> = {};
  try {
    await client.query('begin');
    await client.query(`set local lock_timeout = '5s'`);
    const namePrefix = `${RESOURCE_PREFIX}${manifest.runId}:%`;
    const campaignPrefix = `${manifest.runId}:%`;
    const submissionPrefix = `load:${manifest.runId}:%`;
    const leadIds = unique(manifest.leadIds);
    deleted.automationEffectDispatches = 0;
    deleted.automationExecutionSteps = 0;
    deleted.automationMessageDispatches = 0;
    deleted.automationExecutions = 0;
    deleted.automations = 0;
    deleted.propertyReservationEvents = 0;

    const automationIDs = await client.query<{ id: string }>(
      `select id::text from public.automations where organization_id = $1::uuid and name like $2 for update`,
      [E2E_ORGANIZATION_ID, namePrefix],
    );
    const automationIdValues = automationIDs.rows.map((row) => row.id);
    if (automationIdValues.length > 0) {
      const executions = await client.query<{ id: string }>(
        `
          update public.automation_executions
          set cancellation_requested_at = coalesce(cancellation_requested_at, now()),
              status = case when status in ('queued', 'waiting') then 'cancelled' else status end,
              completed_at = case when status in ('queued', 'waiting') then coalesce(completed_at, now()) else completed_at end
          where organization_id = $1::uuid and automation_id = any($2::uuid[])
          returning id::text
        `,
        [E2E_ORGANIZATION_ID, automationIdValues],
      );
      const executionIdValues = executions.rows.map((row) => row.id);
      if (executionIdValues.length > 0) {
        const effectDispatches = await client.query(
          `
            delete from public.automation_effect_dispatches
            where organization_id = $1::uuid and execution_id = any($2::uuid[])
          `,
          [E2E_ORGANIZATION_ID, executionIdValues],
        );
        deleted.automationEffectDispatches = effectDispatches.rowCount || 0;

        const executionSteps = await client.query(
          `
            delete from public.automation_execution_steps
            where organization_id = $1::uuid and execution_id = any($2::uuid[])
          `,
          [E2E_ORGANIZATION_ID, executionIdValues],
        );
        deleted.automationExecutionSteps = executionSteps.rowCount || 0;

        const messageDispatches = await client.query(
          `
            delete from public.automation_message_dispatches
            where organization_id = $1::uuid and execution_id = any($2::uuid[])
          `,
          [E2E_ORGANIZATION_ID, executionIdValues],
        );
        deleted.automationMessageDispatches = messageDispatches.rowCount || 0;

        const deletedExecutions = await client.query(
          `
            delete from public.automation_executions
            where organization_id = $1::uuid
              and automation_id = any($2::uuid[])
              and id = any($3::uuid[])
          `,
          [E2E_ORGANIZATION_ID, automationIdValues, executionIdValues],
        );
        deleted.automationExecutions = deletedExecutions.rowCount || 0;

        const verification = await client.query<{
          effect_dispatches: string;
          execution_steps: string;
          message_dispatches: string;
          executions: string;
        }>(
          `
            select
              (select count(*) from public.automation_effect_dispatches
                where organization_id = $1::uuid
                  and execution_id = any($2::uuid[]))::text as effect_dispatches,
              (select count(*) from public.automation_execution_steps
                where organization_id = $1::uuid
                  and execution_id = any($2::uuid[]))::text as execution_steps,
              (select count(*) from public.automation_message_dispatches
                where organization_id = $1::uuid
                  and execution_id = any($2::uuid[]))::text as message_dispatches,
              (select count(*) from public.automation_executions
                where organization_id = $1::uuid
                  and automation_id = any($3::uuid[])
                  and id = any($2::uuid[]))::text as executions
          `,
          [E2E_ORGANIZATION_ID, executionIdValues, automationIdValues],
        );
        if (Object.values(verification.rows[0]).some((count) => Number(count) !== 0)) {
          throw new Error(
            `Cleanup verification failed for automation executions in run ${manifest.runId}.`,
          );
        }
      }

      const result = await client.query(
        `delete from public.automations where organization_id = $1::uuid and id = any($2::uuid[])`,
        [E2E_ORGANIZATION_ID, automationIdValues],
      );
      deleted.automations = result.rowCount || 0;
    }

    const analytics = await client.query(
      `
        delete from public.site_analytics_events
        where organization_id = $1::uuid
          and (session_id like $2 or utm_campaign like $3 or lead_id = any($4::uuid[]))
      `,
      [E2E_ORGANIZATION_ID, submissionPrefix, campaignPrefix, leadIds],
    );
    deleted.siteAnalytics = analytics.rowCount || 0;
    const submissions = await client.query(
      `
        delete from public.site_lead_submissions
        where organization_id = $1::uuid
          and (submission_id like $2 or session_id like $2 or lead_id = any($3::uuid[]))
      `,
      [E2E_ORGANIZATION_ID, submissionPrefix, leadIds],
    );
    deleted.siteSubmissions = submissions.rowCount || 0;

    if (leadIds.length > 0) {
      const propertyReservationEvents = await client.query(
        `
          delete from public.events
          where organization_id = $1::uuid
            and event_type = 'property_reserved_by_won_lead'
            and entity_type = 'property'
            and entity_id = $2::uuid
            and payload->>'reserved_by_lead_id' = any($3::text[])
        `,
        [E2E_ORGANIZATION_ID, E2E_PROPERTY_ID, leadIds],
      );
      deleted.propertyReservationEvents = propertyReservationEvents.rowCount || 0;

      const pendingGamification = await client.query(
        `
          delete from public.gamification_outbox
          where organization_id = $1::uuid
            and reference_id = any($2::text[])
            and processed_event_id is null
        `,
        [E2E_ORGANIZATION_ID, leadIds],
      );
      deleted.gamificationOutbox = pendingGamification.rowCount || 0;
      const leads = await client.query(
        `delete from public.leads where organization_id = $1::uuid and id = any($2::uuid[])`,
        [E2E_ORGANIZATION_ID, leadIds],
      );
      deleted.leads = leads.rowCount || 0;
    } else {
      deleted.gamificationOutbox = 0;
      deleted.leads = 0;
    }

    const tags = await client.query(
      `delete from public.tags where organization_id = $1::uuid and name like $2`,
      [E2E_ORGANIZATION_ID, namePrefix],
    );
    deleted.tags = tags.rowCount || 0;

    const queueIDs = await client.query<{ id: string }>(
      `select id::text from public.round_robins where organization_id = $1::uuid and name like $2`,
      [E2E_ORGANIZATION_ID, namePrefix],
    );
    const queueIdValues = queueIDs.rows.map((row) => row.id);
    if (queueIdValues.length > 0) {
      for (const table of ['round_robin_logs', 'round_robin_members', 'round_robin_rules']) {
        await client.query(
          `delete from public.${table} where organization_id = $1::uuid and round_robin_id = any($2::uuid[])`,
          [E2E_ORGANIZATION_ID, queueIdValues],
        );
      }
      const queues = await client.query(
        `delete from public.round_robins where organization_id = $1::uuid and id = any($2::uuid[])`,
        [E2E_ORGANIZATION_ID, queueIdValues],
      );
      deleted.queues = queues.rowCount || 0;
    } else {
      deleted.queues = 0;
    }

    if (manifest.teamPipelineCreated) {
      const relation = await client.query(
        `
          delete from public.team_pipelines
          where organization_id = $1::uuid and team_id = $2::uuid and pipeline_id = $3::uuid
        `,
        [E2E_ORGANIZATION_ID, E2E_TEAM_ID, E2E_PIPELINE_ID],
      );
      deleted.teamPipelines = relation.rowCount || 0;
    }

    for (const [memberId, availability] of Object.entries(manifest.availabilitySnapshots)) {
      await client.query(
        `delete from public.member_availability where organization_id = $1::uuid and team_member_id = $2::uuid`,
        [E2E_ORGANIZATION_ID, memberId],
      );
      for (const item of availability) {
        await client.query(
          `
            insert into public.member_availability (
              organization_id, team_member_id, day_of_week, start_time, end_time, is_all_day, is_active
            ) values ($1::uuid, $2::uuid, $3, $4::time, $5::time, $6, $7)
          `,
          [
            E2E_ORGANIZATION_ID,
            memberId,
            item.day_of_week,
            item.start_time,
            item.end_time,
            item.is_all_day,
            item.is_active,
          ],
        );
      }
    }

    const realtimeTable = await client.query<{ present: boolean }>(
      `select to_regclass('private.realtime_events') is not null as present`,
    );
    if (realtimeTable.rows[0]?.present && leadIds.length > 0) {
      const realtime = await client.query(
        `
          delete from private.realtime_events
          where organization_id = $1::uuid
            and coalesce(data->>'leadId', data->>'lead_id', '') = any($2::text[])
        `,
        [E2E_ORGANIZATION_ID, leadIds],
      );
      deleted.realtimeEvents = realtime.rowCount || 0;
    }

    const availabilityMemberIds = Object.keys(manifest.availabilitySnapshots);
    const audit = await client.query<{ id: string }>(
      `
        delete from public.audit_logs
        where organization_id = $1::uuid
          and created_at >= $2::timestamptz
          and (
            entity_id = any($3::text[])
            or (
              entity_type in (
                'distribution_queue',
                'distribution_queue_member',
                'distribution_queue_rule'
              )
              and (
                entity_id = any($4::text[])
                or coalesce(
                  new_data->>'round_robin_id',
                  old_data->>'round_robin_id',
                  ''
                ) = any($4::text[])
                or coalesce(new_data->>'name', old_data->>'name', '') like $5
              )
            )
            or (
              entity_type = 'team_member_availability'
              and coalesce(
                new_data->>'team_member_id',
                old_data->>'team_member_id',
                ''
              ) = any($6::text[])
            )
            or (
              $7::boolean
              and entity_type = 'team_pipeline'
              and coalesce(new_data->>'team_id', old_data->>'team_id', '') = $8
              and coalesce(new_data->>'pipeline_id', old_data->>'pipeline_id', '') = $9
            )
          )
        returning id::text
      `,
      [
        E2E_ORGANIZATION_ID,
        manifest.createdAt,
        leadIds,
        manifest.queueIds,
        namePrefix,
        availabilityMemberIds,
        manifest.teamPipelineCreated,
        E2E_TEAM_ID,
        E2E_PIPELINE_ID,
      ],
    );
    deleted.auditLogs = audit.rowCount || 0;
    const auditIds = audit.rows.map((row) => row.id);
    if (auditIds.length > 0) {
      const realtimeAudit = await client.query(
        `
          delete from realtime.messages
          where topic = $1
            and event = 'audit.log.created'
            and payload->>'auditId' = any($2::text[])
        `,
        [`audit:${E2E_ORGANIZATION_ID}:feed`, auditIds],
      );
      deleted.realtimeAuditMessages = realtimeAudit.rowCount || 0;
    } else {
      deleted.realtimeAuditMessages = 0;
    }

    await client.query('commit');
    return deleted;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function verifyRunCleanup(pool: Pool, manifest: RunManifest) {
  const namePrefix = `${RESOURCE_PREFIX}${manifest.runId}:%`;
  const campaignPrefix = `${manifest.runId}:%`;
  const submissionPrefix = `load:${manifest.runId}:%`;
  const availabilityMemberIds = Object.keys(manifest.availabilitySnapshots);
  const result = await pool.query<{
    automations: string;
    automation_executions: string;
    automation_effect_dispatches: string;
    automation_execution_steps: string;
    automation_message_dispatches: string;
    queues: string;
    tags: string;
    leads: string;
    submissions: string;
    analytics: string;
    audit_logs: string;
    gamification_outbox: string;
    gamification_events: string;
    gamification_activity_logs: string;
    property_reservation_events: string;
    availability: string;
    team_pipelines: string;
    realtime_events: string;
    realtime_audit_messages: string;
  }>(
    `
      select
        (select count(*) from public.automations
          where organization_id = $1::uuid and name like $2)::text as automations,
        (select count(*) from public.automation_executions
          where organization_id = $1::uuid
            and id = any($14::uuid[]))::text as automation_executions,
        (select count(*) from public.automation_effect_dispatches
          where organization_id = $1::uuid
            and execution_id = any($14::uuid[]))::text as automation_effect_dispatches,
        (select count(*) from public.automation_execution_steps
          where organization_id = $1::uuid
            and execution_id = any($14::uuid[]))::text as automation_execution_steps,
        (select count(*) from public.automation_message_dispatches
          where organization_id = $1::uuid
            and execution_id = any($14::uuid[]))::text as automation_message_dispatches,
        (select count(*) from public.round_robins
          where organization_id = $1::uuid and name like $2)::text as queues,
        (select count(*) from public.tags
          where organization_id = $1::uuid and name like $2)::text as tags,
        (select count(*) from public.leads
          where organization_id = $1::uuid
            and (utm_campaign like $3 or metadata->>'submission_id' like $4))::text as leads,
        (select count(*) from public.site_lead_submissions
          where organization_id = $1::uuid
            and (submission_id like $4 or session_id like $4))::text as submissions,
        (select count(*) from public.site_analytics_events
          where organization_id = $1::uuid
            and (session_id like $4 or utm_campaign like $3))::text as analytics,
        (select count(*) from public.audit_logs
          where organization_id = $1::uuid
            and created_at >= $5::timestamptz
            and (
              entity_id = any($6::text[])
              or (
                entity_type in (
                  'distribution_queue',
                  'distribution_queue_member',
                  'distribution_queue_rule'
                )
                and (
                  entity_id = any($7::text[])
                  or coalesce(
                    new_data->>'round_robin_id',
                    old_data->>'round_robin_id',
                    ''
                  ) = any($7::text[])
                  or coalesce(new_data->>'name', old_data->>'name', '') like $2
                )
              )
              or (
                entity_type = 'team_member_availability'
                and coalesce(
                  new_data->>'team_member_id',
                  old_data->>'team_member_id',
                  ''
                ) = any($8::text[])
              )
              or (
                $9::boolean
                and entity_type = 'team_pipeline'
                and coalesce(new_data->>'team_id', old_data->>'team_id', '') = $10
                and coalesce(new_data->>'pipeline_id', old_data->>'pipeline_id', '') = $11
              )
            ))::text as audit_logs,
        (select count(*) from public.gamification_outbox
          where organization_id = $1::uuid
            and reference_id = any($6::text[]))::text as gamification_outbox,
        (select count(*) from public.gamification_events
          where organization_id = $1::uuid
            and reference_id = any($6::text[]))::text as gamification_events,
        (select count(*) from public.gamification_activity_logs
          where organization_id = $1::uuid
            and reference_id = any($6::uuid[]))::text as gamification_activity_logs,
        (select count(*) from public.events
          where organization_id = $1::uuid
            and event_type = 'property_reserved_by_won_lead'
            and entity_type = 'property'
            and entity_id = $15::uuid
            and payload->>'reserved_by_lead_id' = any($6::text[])
        )::text as property_reservation_events,
        (select count(*) from public.member_availability
          where organization_id = $1::uuid
            and team_member_id = any($8::uuid[]))::text as availability,
        (select case when $9::boolean then count(*) else 0 end
          from public.team_pipelines
          where organization_id = $1::uuid
            and team_id = $10::uuid
            and pipeline_id = $11::uuid)::text as team_pipelines,
        (select count(*) from private.realtime_events
          where organization_id = $1::uuid
            and coalesce(data->>'leadId', data->>'lead_id', '') = any($6::text[])
        )::text as realtime_events,
        (select case when $12::boolean then count(*) else 0 end
          from realtime.messages
          where topic = $13
            and event = 'audit.log.created'
            and inserted_at >= $5::timestamptz
        )::text as realtime_audit_messages
    `,
    [
      E2E_ORGANIZATION_ID,
      namePrefix,
      campaignPrefix,
      submissionPrefix,
      manifest.createdAt,
      manifest.leadIds,
      manifest.queueIds,
      availabilityMemberIds,
      manifest.teamPipelineCreated,
      E2E_TEAM_ID,
      E2E_PIPELINE_ID,
      manifest.createdAt !== new Date(0).toISOString(),
      `audit:${E2E_ORGANIZATION_ID}:feed`,
      manifest.executionIds,
      E2E_PROPERTY_ID,
    ],
  );
  return Object.fromEntries(
    Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)]),
  ) as Record<string, number>;
}

function dataOf<T>(payload: unknown): T {
  if (
    payload &&
    typeof payload === 'object' &&
    Object.hasOwn(payload as Record<string, unknown>, 'data')
  ) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function nextPhone(context: RunContext) {
  const value = context.phoneSequence % 100_000_000;
  context.phoneSequence += 1;
  return `119${String(value).padStart(8, '0')}`;
}

function phoneSeed(runId: string) {
  const digest = createHash('sha256').update(runId).digest('hex').slice(0, 8);
  return Number.parseInt(digest, 16) % 90_000_000 + 10_000_000;
}

function rememberLeadIDs(context: RunContext, leadIds: string[]) {
  context.manifest.leadIds = unique([...context.manifest.leadIds, ...leadIds]);
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function manifestPathFor(runId: string) {
  validateRunId(runId);
  return path.join(process.cwd(), '.tmp', 'vimob-load', `${runId}.json`);
}

async function persistContextManifest(context: RunContext) {
  await persistManifest(context.manifestPath, context.manifest);
}

async function persistManifest(filePath: string, manifest: RunManifest) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch((unlinkError: NodeJS.ErrnoException) => {
      if (unlinkError.code !== 'ENOENT') throw unlinkError;
    });
    throw error;
  }
}

async function readRunManifest(runId: string): Promise<RunManifest | null> {
  const filePath = manifestPathFor(runId);
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Load manifest must be a JSON object.');
    }
    const parsed = raw as Record<string, unknown>;
    if (
      parsed.version !== MANIFEST_VERSION ||
      parsed.runId !== runId ||
      parsed.organizationId !== E2E_ORGANIZATION_ID
    ) {
      throw new Error('Load manifest identity does not match the cleanup request.');
    }
    const profile = String(parsed.profile || '');
    if (!isProfileName(profile)) {
      throw new Error('Load manifest profile is invalid.');
    }
    const createdAt = String(parsed.createdAt || '');
    const createdAtMillis = Date.parse(createdAt);
    const runAtMillis = runTimestamp(runId);
    if (
      !Number.isFinite(createdAtMillis) ||
      Math.abs(createdAtMillis - runAtMillis) > 30 * 60 * 1_000
    ) {
      throw new Error('Load manifest timestamp does not match the run identifier.');
    }
    if (typeof parsed.teamPipelineCreated !== 'boolean') {
      throw new Error('Load manifest teamPipelineCreated flag is invalid.');
    }

    return {
      version: MANIFEST_VERSION,
      runId,
      organizationId: E2E_ORGANIZATION_ID,
      createdAt: new Date(createdAtMillis).toISOString(),
      profile,
      queueIds: manifestUUIDArray(parsed.queueIds, 'queueIds'),
      automationId: manifestNullableUUID(parsed.automationId, 'automationId'),
      tagId: manifestNullableUUID(parsed.tagId, 'tagId'),
      leadIds: manifestUUIDArray(parsed.leadIds, 'leadIds'),
      executionIds: manifestUUIDArray(parsed.executionIds, 'executionIds'),
      availabilitySnapshots: manifestAvailabilitySnapshots(parsed.availabilitySnapshots),
      teamPipelineCreated: parsed.teamPipelineCreated,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      console.warn(`Ignoring truncated load manifest for ${runId}; using marker-only cleanup.`);
      return null;
    }
    throw error;
  }
}

function manifestUUIDArray(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !UUID_PATTERN.test(item))) {
    throw new Error(`Load manifest ${field} must contain only UUIDs.`);
  }
  return unique(value as string[]);
}

function manifestNullableUUID(value: unknown, field: string) {
  if (value === null) return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`Load manifest ${field} must be a UUID or null.`);
  }
  return value;
}

function manifestAvailabilitySnapshots(value: unknown): Record<string, AvailabilityItem[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Load manifest availabilitySnapshots must be an object.');
  }
  const snapshots: Record<string, AvailabilityItem[]> = {};
  for (const [memberId, rawItems] of Object.entries(value)) {
    if (!UUID_PATTERN.test(memberId) || !Array.isArray(rawItems)) {
      throw new Error('Load manifest contains an invalid availability snapshot.');
    }
    snapshots[memberId] = rawItems.map((rawItem) => {
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
        throw new Error('Load manifest contains an invalid availability item.');
      }
      const item = rawItem as Record<string, unknown>;
      if (
        item.team_member_id !== memberId ||
        !Number.isInteger(item.day_of_week) ||
        Number(item.day_of_week) < 0 ||
        Number(item.day_of_week) > 6 ||
        !isNullableTime(item.start_time) ||
        !isNullableTime(item.end_time) ||
        typeof item.is_all_day !== 'boolean' ||
        typeof item.is_active !== 'boolean'
      ) {
        throw new Error('Load manifest contains an invalid availability item.');
      }
      return {
        team_member_id: memberId,
        day_of_week: Number(item.day_of_week),
        start_time: item.start_time as string | null,
        end_time: item.end_time as string | null,
        is_all_day: item.is_all_day,
        is_active: item.is_active,
      };
    });
  }
  return snapshots;
}

function isNullableTime(value: unknown) {
  return value === null || (
    typeof value === 'string' &&
    /^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)
  );
}

function runTimestamp(runId: string) {
  validateRunId(runId);
  const compact = runId.slice('load-'.length, 'load-YYYYMMDDTHHMMSSmmmZ'.length);
  const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` +
    `T${compact.slice(9, 11)}:${compact.slice(11, 13)}:${compact.slice(13, 15)}.` +
    `${compact.slice(15, 18)}Z`;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid load run timestamp "${runId}".`);
  return timestamp;
}

function logPhase(runId: string, message: string) {
  console.log(`[${runId}] ${message}`);
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

try {
  const command = parseCommandLine(process.argv.slice(2));
  await runCommand(command);
} catch (error) {
  const failures = error instanceof AggregateError
    ? error.errors.map(safeErrorMessage)
    : [safeErrorMessage(error)];
  console.error(JSON.stringify({ success: false, errors: failures }, null, 2));
  process.exitCode = 1;
}
