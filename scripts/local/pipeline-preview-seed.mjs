import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { fixtureUUID } from '../supabase/seed-queue-local-homologation.mjs';
import {
  connectVerifiedDatabase, localAuthFetch, readVerifiedManifest,
} from '../supabase/queue-local-homologation-target.mjs';

const OUTPUT_ROOT = 'D:/Vimob/outputs';
const KIND = 'vimob-pipeline-preview-fixture-v1';
const MODULES = ['crm', 'cadences', 'tags', 'automations', 'properties', 'reports'];

export function pipelineFixturePlan(runId) {
  const shortId = runId.replaceAll('-', '').slice(0, 12);
  const uuid = key => fixtureUUID(runId, `pipeline-preview:${key}`);
  return ['a', 'b'].map(key => ({
    id: uuid(`${key}:organization`), name: `Pipeline Local ${key.toUpperCase()} ${shortId}`,
    pipelineId: uuid(`${key}:pipeline`),
    users: Object.fromEntries(['admin', 'broker'].map(role => [role, {
      email: `pipeline.${shortId}.${key}.${role}@queue.local.test`,
      name: `Pipeline Sintético ${key.toUpperCase()} ${role}`,
    }])),
    stages: [
      ['base', 'Base', '#3b82f6'], ['contacted', 'Contactados', '#f59e0b'],
      ['qualified', 'Qualificados', '#22c55e'], ['won', 'Ganho', '#22c55e'],
      ['lost', 'Perdido', '#ef4444'],
    ].map(([stageKey, name, color], position) => ({
      id: uuid(`${key}:stage:${stageKey}`), stageKey, name, color, position,
    })),
    leads: Array.from({ length: 6 }, (_, index) => ({
      id: uuid(`${key}:lead:${index + 1}`),
      name: `Pipeline Sintético ${key.toUpperCase()} ${index + 1}`,
      role: index < 3 ? 'admin' : 'broker',
    })),
  }));
}

async function writePrivateFixture(filename, fixture, exclusive = false) {
  await fs.writeFile(filename, JSON.stringify(fixture, null, 2), {
    mode: 0o600, flag: exclusive ? 'wx' : 'w',
  });
}

async function provisionAuthUser(admin, user, password, runId) {
  const result = await admin.auth.admin.createUser({
    email: user.email, password, email_confirm: true,
    user_metadata: { name: user.name },
    app_metadata: { pipeline_preview_run_id: runId },
  });
  assert.ok(!result.error && result.data.user?.id && result.data.user.email_confirmed_at,
    `Synthetic local Auth provisioning failed (${result.error?.code || result.error?.status || 'missing_user'}).`);
  return result.data.user.id;
}

async function insertOrganization(db, organization, runId) {
  await db.query(`insert into public.organizations
    (id,name,email,is_active,subscription_status,subscription_type,segment)
    values($1,$2,$3,true,'active','paid','imobiliario')`,
  [organization.id, organization.name, organization.users.admin.email]);
  for (const [role, user] of Object.entries(organization.users)) {
    await db.query(`insert into public.users
      (id,organization_id,name,email,role,is_active,language,theme_mode)
      values($1,$2,$3,$4,$5,true,'pt-BR','system')
      on conflict(id) do update set organization_id=excluded.organization_id,
        name=excluded.name,email=excluded.email,role=excluded.role,is_active=true`,
    [user.id, organization.id, user.name, user.email, role === 'admin' ? 'admin' : 'user']);
    await db.query(`insert into public.organization_members
      (organization_id,user_id,role,is_active) values($1,$2,$3,true)
      on conflict(organization_id,user_id) do update set role=excluded.role,is_active=true,deleted_at=null`,
    [organization.id, user.id, role === 'admin' ? 'admin' : 'user']);
    await db.query(`insert into public.setup_guide_progress(user_id,completed_steps,skipped)
      values($1,'{}',true) on conflict(user_id) do update set skipped=true`, [user.id]);
  }
  await db.query(`insert into public.organization_modules(organization_id,module_name,is_enabled)
    select $1,module,true from unnest($2::text[]) module
    on conflict(organization_id,module_name) do update set is_enabled=true`, [organization.id, MODULES]);
  await db.query(`insert into public.pipelines
    (id,organization_id,name,position,is_default,is_active,pool_enabled)
    values($1,$2,'Pipeline Local Sintético',0,true,true,false)`, [organization.pipelineId, organization.id]);
  for (const stage of organization.stages) {
    await db.query(`insert into public.stages
      (id,organization_id,pipeline_id,name,stage_key,color,position,is_active,is_won,is_lost,is_qualified)
      values($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10)`,
    [stage.id, organization.id, organization.pipelineId, stage.name, stage.stageKey, stage.color,
      stage.position, stage.stageKey === 'won', stage.stageKey === 'lost', stage.stageKey === 'qualified']);
  }
  for (const [index, lead] of organization.leads.entries()) {
    lead.stageId = organization.stages[0].id;
    lead.ownerId = organization.users[lead.role].id;
    await db.query(`insert into public.leads
      (id,organization_id,name,source,pipeline_id,stage_id,deal_status,
        assigned_user_id,assigned_at,created_by,board_order_at,metadata)
      values($1,$2,$3,'manual',$4,$5,'open',$6,clock_timestamp(),$7,
        clock_timestamp()-($8::int*interval '1 minute'),$9)`,
    [lead.id, organization.id, lead.name, organization.pipelineId, lead.stageId,
      lead.ownerId, organization.users.admin.id, index,
      JSON.stringify({ pipeline_preview_run_id: runId })]);
  }
}

async function verifyRealLogin(manifest, db, organization, password) {
  const client = createClient(manifest.supabaseURL, manifest.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: localAuthFetch(manifest) },
  });
  const result = await client.auth.signInWithPassword({ email: organization.users.admin.email, password });
  assert.ok(!result.error && result.data.session, 'Real local GoTrue password login failed.');
  const claims = JSON.parse(Buffer.from(result.data.session.access_token.split('.')[1], 'base64url').toString());
  assert.equal(claims.iss, `${manifest.supabaseURL.replace(/\/$/, '')}/auth/v1`);
  assert.equal(claims.sub, organization.users.admin.id);
  assert.ok(claims.session_id, 'Real session_id must exist.');
  const session = await db.query('select id from auth.sessions where id=$1::uuid and user_id=$2::uuid',
    [claims.session_id, claims.sub]);
  assert.equal(session.rowCount, 1, 'Real GoTrue session must be durable.');
  const signOut = await client.auth.signOut({ scope: 'local' });
  assert.equal(signOut.error, null, 'Fixture verification session must sign out.');
  return { realGoTrue: true, durableSessionVerified: true, issuer: claims.iss };
}

export async function seedPipelinePreview(manifestFilename, outputDirectory) {
  const directory = await fs.realpath(outputDirectory);
  const outputRoot = await fs.realpath(OUTPUT_ROOT);
  const relative = path.relative(outputRoot, directory);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    'Use a dedicated existing evidence directory below D:/Vimob/outputs.');
  const manifest = await readVerifiedManifest(manifestFilename);
  const db = await connectVerifiedDatabase(manifest);
  const filename = path.join(directory, 'pipeline-synthetic-fixture.private.json');
  const runId = crypto.randomUUID();
  const fixture = { kind: KIND, status: 'reserved', runId,
    stackRunId: manifest.runId, supabaseURL: manifest.supabaseURL,
    syntheticPassword: `PipelineLocal!${crypto.randomBytes(18).toString('base64url')}`,
    organizations: pipelineFixturePlan(runId), createdAt: new Date().toISOString() };
  try {
    // Never reuse existing fixtures or existing users. An exclusive receipt
    // preserves identities if Auth creation succeeds but a later step fails.
    await writePrivateFixture(filename, fixture, true);
    const ids = fixture.organizations.map(organization => organization.id);
    const occupied = await db.query('select id from public.organizations where id=any($1::uuid[])', [ids]);
    assert.equal(occupied.rowCount, 0, 'New synthetic organization IDs must be unoccupied.');
    const admin = createClient(manifest.supabaseURL, manifest.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: localAuthFetch(manifest) },
    });
    for (const organization of fixture.organizations) {
      for (const user of Object.values(organization.users)) {
        user.id = await provisionAuthUser(admin, user, fixture.syntheticPassword, runId);
        await writePrivateFixture(filename, fixture);
      }
    }
    await db.query('begin');
    try {
      for (const organization of fixture.organizations) await insertOrganization(db, organization, runId);
      await db.query('commit');
    } catch (error) { await db.query('rollback'); throw error; }
    fixture.status = 'seeded';
    await writePrivateFixture(filename, fixture);
    fixture.authEvidence = await verifyRealLogin(manifest, db, fixture.organizations[0], fixture.syntheticPassword);
    fixture.status = 'verified';
    await writePrivateFixture(filename, fixture);
    return { fixture: filename, runId, organizations: 2, users: 4, pipelines: 2, stages: 10, leads: 12,
      authentication: 'real_local_gotrue_verified', existingFixturesReused: false };
  } finally { await db.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  seedPipelinePreview(process.argv[2], process.argv[3])
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => {
      // Do not serialize SDK/database error objects: they may carry credentials.
      process.stderr.write(`Pipeline local seed failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
