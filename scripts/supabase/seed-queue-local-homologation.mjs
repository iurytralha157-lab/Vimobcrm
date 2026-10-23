import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { connectVerifiedDatabase, localAuthFetch, readVerifiedManifest, RUNTIME_ROOT } from './queue-local-homologation-target.mjs';

export function fixtureUUID(runId, key) {
  const bytes = crypto.createHash('sha256').update(`${runId}:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function queueSchedule(open) {
  return { version: 1, timezone: 'America/Sao_Paulo', days: Array.from({ length: 7 }, (_, day) => ({ day_of_week: day, is_active: open, is_all_day: open, start_time: null, end_time: null })) };
}

async function ensureAuthUser(admin, email, name, password, runId) {
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw new Error(`Local Auth list failed: ${listError.code || listError.status}`);
  const existing = listed.users.find(user => user.email?.toLowerCase() === email);
  assert.ok(listed.users.every(user => user.email?.endsWith('@queue.local.test')), 'Disposable Auth contains an unexpected account.');
  const attributes = { email, password, email_confirm: true, user_metadata: { name, queue_homologation: runId }, app_metadata: { queue_homologation: runId } };
  const response = existing ? await admin.auth.admin.updateUserById(existing.id, attributes) : await admin.auth.admin.createUser(attributes);
  if (response.error || !response.data.user) throw new Error(`Local Auth provisioning failed for synthetic role: ${response.error?.code || response.error?.status || 'missing_user'}`);
  assert.ok(response.data.user.email_confirmed_at, 'Synthetic Auth account must be confirmed.');
  return response.data.user.id;
}

async function seedOrganization(db, admin, manifest, organizationKey, password) {
  const id = key => fixtureUUID(manifest.runId, `${organizationKey}:${key}`);
  const organization = { id: id('org'), name: `Homologação Filas ${organizationKey.toUpperCase()}`, pipelineId: id('pipeline'), stageId: id('stage'), teamId: id('team'), users: {}, queues: {}, leads: {} };
  const roles = ['admin', 'leader', 'broker1', 'broker2', 'broker3', 'broker4', 'broker5', 'outsider'];
  for (const role of roles) {
    const email = `${organizationKey}.${role}@queue.local.test`;
    organization.users[role] = { id: await ensureAuthUser(admin, email, `Sintético ${organizationKey} ${role}`, password, manifest.runId), email };
  }
  await db.query('begin');
  try {
    await db.query(`insert into public.organizations(id,name,is_active,subscription_status,subscription_type,segment,email)
      values($1,$2,true,'active','paid','imobiliario',$3) on conflict(id) do update set is_active=true,subscription_status='active',subscription_type='paid'`, [organization.id, organization.name, `${organizationKey}.admin@queue.local.test`]);
    for (const role of roles) {
      const user = organization.users[role];
      await db.query(`insert into public.users(id,organization_id,name,email,role,is_active,language,theme_mode)
        values($1,$2,$3,$4,$5,true,'pt-BR','system') on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true`, [user.id, organization.id, `Sintético ${organizationKey} ${role}`, user.email, role === 'admin' ? 'admin' : 'user']);
      await db.query(`insert into public.organization_members(organization_id,user_id,role,is_active)
        values($1,$2,$3,true) on conflict(organization_id,user_id) do update set role=excluded.role,is_active=true,deleted_at=null`, [organization.id, user.id, role === 'admin' ? 'admin' : 'user']);
      await db.query(`insert into public.setup_guide_progress(user_id,completed_steps,skipped) values($1,'{}',true)
        on conflict(user_id) do update set skipped=true`, [user.id]);
    }
    await db.query(`insert into public.organization_modules(organization_id,module_name,is_enabled)
      select $1,module,true from unnest($2::text[]) module on conflict(organization_id,module_name) do update set is_enabled=true`, [organization.id, ['crm', 'round_robin', 'whatsapp', 'agenda', 'cadences', 'tags', 'automations', 'properties', 'reports']]);
    await db.query(`insert into public.teams(id,organization_id,name,is_active,created_by) values($1,$2,$3,true,$4) on conflict(id) do nothing`, [organization.teamId, organization.id, `Equipe Sintética ${organizationKey}`, organization.users.admin.id]);
    for (const role of roles.filter(role => role === 'leader' || role.startsWith('broker'))) {
      await db.query(`insert into public.team_members(id,organization_id,team_id,user_id,is_leader,is_active,membership_generation)
        select $1,$2,$3,$4,$5,true,om.membership_generation from public.organization_members om where om.organization_id=$2 and om.user_id=$4
        on conflict(team_id,user_id) do update set is_active=true,is_leader=excluded.is_leader,membership_generation=excluded.membership_generation`, [id(`team-member:${role}`), organization.id, organization.teamId, organization.users[role].id, role === 'leader']);
    }
    await db.query(`insert into public.pipelines(id,organization_id,name,position,is_default,is_active,pool_enabled)
      values($1,$2,'Pipeline Sintético de Homologação',0,true,true,false) on conflict(id) do nothing`, [organization.pipelineId, organization.id]);
    await db.query(`insert into public.stages(id,organization_id,pipeline_id,name,stage_key,color,position,is_active)
      values($1,$2,$3,'Novos Sintéticos','new','#ff4529',0,true) on conflict(id) do nothing`, [organization.stageId, organization.id, organization.pipelineId]);
    for (const kind of ['open', 'closed', 'weighted']) {
      const queueId = id(`queue:${kind}`);
      organization.queues[kind] = queueId;
      const settings = { operating_schedule: queueSchedule(kind !== 'closed'), enable_redistribution: true, redistribution_timeout_minutes: 1, redistribution_warning_minutes: 0, redistribution_max_attempts: 0, ignore_availability: false, pool_notifications: { enabled: false } };
      await db.query(`insert into public.round_robins(id,organization_id,name,is_active,strategy,pipeline_id,target_pipeline_id,target_stage_id,settings,reentry_behavior,created_by)
        values($1,$2,$3,true,$4,$5,$5,$6,$7,'redistribute',$8) on conflict(id) do nothing`, [queueId, organization.id, `Fila Sintética ${organizationKey} ${kind}`, kind === 'weighted' ? 'weighted' : 'simple', organization.pipelineId, organization.stageId, JSON.stringify(settings), organization.users.admin.id]);
      for (let index = 1; index <= 5; index++) {
        const user = organization.users[`broker${index}`];
        await db.query(`insert into public.round_robin_members(id,organization_id,round_robin_id,user_id,position,weight,is_active,membership_generation)
          select $1,$2,$3,$4,$5,$6,true,om.membership_generation from public.organization_members om where om.organization_id=$2 and om.user_id=$4
          on conflict(round_robin_id,user_id) do nothing`, [id(`member:${kind}:${index}`), organization.id, queueId, user.id, index - 1, kind === 'weighted' && index === 1 ? 4 : 1]);
      }
    }
    await db.query(`update public.pipelines set default_round_robin_id=$2 where organization_id=$1 and id=$3`, [organization.id, organization.queues.open, organization.pipelineId]);
    for (const kind of ['open', 'closed']) {
      for (let index = 1; index <= 3; index++) {
        const leadId = id(`lead:${kind}:${index}`);
        organization.leads[`${kind}${index}`] = leadId;
        const inserted = await db.query(`insert into public.leads(id,organization_id,name,source,pipeline_id,stage_id,deal_status,origin_round_robin_id,intake_scope_key,metadata)
          values($1,$2,$3,'manual',$4,$5,'open',$6,$7,$8) on conflict(id) do nothing returning id`, [leadId, organization.id, `Contato Sintético ${organizationKey} ${kind} ${index}`, organization.pipelineId, organization.stageId, organization.queues[kind], `queue:${organization.queues[kind]}`, JSON.stringify({ queue_homologation: manifest.runId })]);
        if (inserted.rowCount) await db.query(`select private.distribute_lead($1::uuid,$2::uuid,$3::text,$4::uuid,false,'manual',clock_timestamp())`, [organization.id, leadId, `queue-homologation:${manifest.runId}:${leadId}`, organization.queues[kind]]);
      }
    }
    const manualId = id('lead:manual');
    organization.leads.manual = manualId;
    await db.query(`insert into public.leads(id,organization_id,name,source,pipeline_id,stage_id,deal_status,assigned_user_id,assigned_at,origin_round_robin_id,metadata)
      values($1,$2,$3,'manual',$4,$5,'open',$6,clock_timestamp(),$7,$8) on conflict(id) do nothing`, [manualId, organization.id, `Contato Manual Sintético ${organizationKey}`, organization.pipelineId, organization.stageId, organization.users.broker5.id, organization.queues.open, JSON.stringify({ queue_homologation: manifest.runId })]);
    await db.query('commit');
    return organization;
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

export async function seedQueueLocalHomologation(filename) {
  const manifest = await readVerifiedManifest(filename);
  const db = await connectVerifiedDatabase(manifest);
  try {
    const existing = await db.query(`select count(*)::int as unexpected from public.organizations where email is null or email not like '%@queue.local.test'`);
    assert.equal(existing.rows[0].unexpected, 0, 'Disposable database contains a non-synthetic organization.');
    const admin = createClient(manifest.supabaseURL, manifest.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localAuthFetch(manifest) } });
    const password = manifest.syntheticPassword || `QueueLocal!${crypto.randomBytes(18).toString('base64url')}`;
    const organizations = [];
    for (const key of ['a', 'b']) organizations.push(await seedOrganization(db, admin, manifest, key, password));
    // Exercise real GoTrue sign-in. Never synthesize JWTs or insert fake sessions.
    const authClient = createClient(manifest.supabaseURL, manifest.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localAuthFetch(manifest) } });
    const signedIn = await authClient.auth.signInWithPassword({ email: organizations[0].users.admin.email, password });
    if (signedIn.error || !signedIn.data.session) throw new Error('Real local GoTrue login did not produce a session.');
    const token = signedIn.data.session.access_token;
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    assert.ok(claims.session_id && claims.sub, 'Real Auth token must carry a durable session.');
    assert.equal(claims.iss, `${manifest.supabaseURL.replace(/\/$/, '')}/auth/v1`, 'Real local Auth must use its approved loopback issuer.');
    assert.equal(claims.sub, organizations[0].users.admin.id, 'Auth must return the synthetic account provisioned for this run.');
    const session = await db.query('select id from auth.sessions where id=$1::uuid and user_id=$2::uuid', [claims.session_id, claims.sub]);
    assert.equal(session.rowCount, 1, 'GoTrue session must exist in PostgreSQL.');
    await authClient.auth.signOut({ scope: 'local' });
    const fixture = { kind: 'vimob-queue-homologation-fixture-v1', runId: manifest.runId, supabaseURL: manifest.supabaseURL, syntheticPassword: password, organizations, authEvidence: { issuer: claims.iss, algorithm: JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).alg, durableSessionVerified: true } };
    const output = path.join(RUNTIME_ROOT, 'synthetic-fixture.json');
    await fs.writeFile(output, JSON.stringify(fixture, null, 2), { mode: 0o600 });
    return { fixture: output, organizations: organizations.length, users: organizations.reduce((total, org) => total + Object.keys(org.users).length, 0), queues: organizations.reduce((total, org) => total + Object.keys(org.queues).length, 0), auth: 'real_gotrue_session_verified' };
  } finally {
    await db.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  seedQueueLocalHomologation(process.argv[2]).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => { process.stderr.write(`Local queue seed failed: ${error.message}\n`); process.exitCode = 1; });
}
