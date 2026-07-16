import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Pool } from 'pg';

import {
  E2E_ORGANIZATION_ID,
  E2E_LEADS,
  E2E_OUTSIDE_TEAM_ID,
  E2E_PASSWORD,
  E2E_PIPELINE_ID,
  E2E_STAGE_ID,
  E2E_TEAM_ID,
  E2E_USERS,
  type E2EUserKey,
  requireE2ESupabaseConfig,
} from './e2e-env';

type SeededUserIds = Record<E2EUserKey, string>;

const ENABLED_MODULES = [
  'crm',
  'properties',
  'whatsapp',
  'agenda',
  'cadences',
  'tags',
  'round_robin',
  'reports',
  'financial',
] as const;

export async function seedE2EData() {
  const supabase = createAdminClient();
  const userIds = {} as SeededUserIds;

  for (const key of Object.keys(E2E_USERS) as E2EUserKey[]) {
    userIds[key] = await ensureAuthUser(supabase, key);
  }

  const pool = createDatabasePool();
  const db = await pool.connect();
  try {
    await db.query('begin');
    await db.query(`
      insert into public.organizations (
        id, name, logo_url, is_active, subscription_status, segment, email
      ) values ($1::uuid, $2, null, true, 'active', 'imobiliario', $3)
      on conflict (id) do update set
        name = excluded.name,
        is_active = true,
        subscription_status = 'active',
        segment = 'imobiliario',
        email = excluded.email
    `, [E2E_ORGANIZATION_ID, 'Vimob E2E Teste', 'e2e@vimob.test']);

    for (const key of Object.keys(E2E_USERS) as E2EUserKey[]) {
      const user = E2E_USERS[key];
      await db.query(`
        insert into public.users (
          id, organization_id, name, email, role, avatar_url, is_active, language, theme_mode
        ) values ($1::uuid, $2::uuid, $3, $4, $5, null, true, 'pt-BR', 'system')
        on conflict (id) do update set
          organization_id = excluded.organization_id,
          name = excluded.name,
          email = excluded.email,
          role = excluded.role,
          is_active = true
      `, [userIds[key], E2E_ORGANIZATION_ID, user.name, user.email, user.userRole]);

      await db.query(`
        insert into public.organization_members (
          organization_id, user_id, role, is_active
        ) values ($1::uuid, $2::uuid, $3, true)
        on conflict (organization_id, user_id) do update set
          role = excluded.role,
          is_active = true
      `, [E2E_ORGANIZATION_ID, userIds[key], user.memberRole]);
    }

    await db.query(`
      insert into public.organization_modules (organization_id, module_name, is_enabled)
      select $1::uuid, module_name, true
      from unnest($2::text[]) as module_name
      on conflict (organization_id, module_name) do update set is_enabled = true
    `, [E2E_ORGANIZATION_ID, [...ENABLED_MODULES]]);

    await db.query(`
      insert into public.teams (id, organization_id, name, is_active, created_by)
      values ($1::uuid, $2::uuid, 'Equipe E2E', true, $3::uuid)
      on conflict (id) do update set
        organization_id = excluded.organization_id,
        name = excluded.name,
        is_active = true,
        created_by = excluded.created_by
    `, [E2E_TEAM_ID, E2E_ORGANIZATION_ID, userIds.admin]);

    await db.query(`
      insert into public.team_members (
        organization_id, team_id, user_id, is_leader, is_active
      ) values
        ($1::uuid, $2::uuid, $3::uuid, true, true),
        ($1::uuid, $2::uuid, $4::uuid, false, true)
      on conflict (team_id, user_id) do update set
        organization_id = excluded.organization_id,
        is_leader = excluded.is_leader,
        is_active = true
    `, [E2E_ORGANIZATION_ID, E2E_TEAM_ID, userIds.leader, userIds.user]);

    await db.query(`
      delete from public.user_permission_overrides
      where organization_id = $1::uuid
        and user_id = any($2::uuid[])
    `, [E2E_ORGANIZATION_ID, Object.values(userIds)]);

    await db.query(`
      insert into public.setup_guide_progress (user_id, completed_steps, skipped)
      select user_id, '{}'::jsonb, true
      from unnest($1::uuid[]) as user_id
      on conflict (user_id) do update set
        skipped = true,
        updated_at = now()
    `, [Object.values(userIds)]);

    await db.query(`
      insert into public.teams (id, organization_id, name, is_active, created_by)
      values ($1::uuid, $2::uuid, 'Equipe Externa E2E', true, $3::uuid)
      on conflict (id) do update set
        organization_id = excluded.organization_id,
        name = excluded.name,
        is_active = true,
        created_by = excluded.created_by
    `, [E2E_OUTSIDE_TEAM_ID, E2E_ORGANIZATION_ID, userIds.admin]);

    await db.query(`
      insert into public.pipelines (
        id, organization_id, name, position, is_default, is_active, created_by
      ) values ($1::uuid, $2::uuid, 'Pipeline E2E', 0, true, true, $3::uuid)
      on conflict (id) do update set
        organization_id = excluded.organization_id,
        name = excluded.name,
        is_default = true,
        is_active = true,
        created_by = excluded.created_by
    `, [E2E_PIPELINE_ID, E2E_ORGANIZATION_ID, userIds.admin]);

    await db.query(`
      insert into public.stages (
        id, organization_id, pipeline_id, name, stage_key, color, position, is_active
      ) values ($1::uuid, $2::uuid, $3::uuid, 'Novos E2E', 'new', '#f97316', 0, true)
      on conflict (id) do update set
        organization_id = excluded.organization_id,
        pipeline_id = excluded.pipeline_id,
        name = excluded.name,
        stage_key = excluded.stage_key,
        is_active = true
    `, [E2E_STAGE_ID, E2E_ORGANIZATION_ID, E2E_PIPELINE_ID]);

    const leadFixtures = [
      [E2E_LEADS.leaderOwn, 'Lead do Lider E2E', userIds.leader, E2E_TEAM_ID],
      [E2E_LEADS.team, 'Lead da Equipe E2E', userIds.user, E2E_TEAM_ID],
      [E2E_LEADS.userOwn, 'Lead Particular do Usuario E2E', userIds.user, null],
      [E2E_LEADS.outside, 'Lead Externo E2E', userIds.admin, E2E_OUTSIDE_TEAM_ID],
    ] as const;

    for (const [id, name, assignedUserId, teamId] of leadFixtures) {
      await db.query(`
        insert into public.leads (
          id, organization_id, pipeline_id, stage_id, assigned_user_id, assigned_at,
          name, source, status, deal_status, priority, created_by, team_id
        ) values (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, now(),
          $6, 'e2e', 'new', 'open', 'normal', $7::uuid, $8::uuid
        )
        on conflict (id) do update set
          organization_id = excluded.organization_id,
          pipeline_id = excluded.pipeline_id,
          stage_id = excluded.stage_id,
          assigned_user_id = excluded.assigned_user_id,
          name = excluded.name,
          source = excluded.source,
          status = excluded.status,
          deal_status = excluded.deal_status,
          created_by = excluded.created_by,
          team_id = excluded.team_id
      `, [
        id,
        E2E_ORGANIZATION_ID,
        E2E_PIPELINE_ID,
        E2E_STAGE_ID,
        assignedUserId,
        name,
        userIds.admin,
        teamId,
      ]);
    }

    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  } finally {
    db.release();
    await pool.end();
  }

  return userIds;
}

function createDatabasePool() {
  return new Pool({ connectionString: requireE2ESupabaseConfig().databaseURL });
}

function createAdminClient() {
  const config = requireE2ESupabaseConfig();

  return createClient(config.supabaseURL, config.supabaseServiceRoleKey, {
    global: config.supabaseAdminAccessToken
      ? { headers: { Authorization: `Bearer ${config.supabaseAdminAccessToken}` } }
      : undefined,
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function ensureAuthUser(supabase: SupabaseClient, key: E2EUserKey) {
  const user = E2E_USERS[key];
  const existing = await findAuthUserByEmail(supabase, user.email);

  if (!existing) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: user.email,
      password: E2E_PASSWORD,
      email_confirm: true,
      user_metadata: { name: user.name, e2e: true },
      app_metadata: { e2e: true },
    });
    if (error || !data.user) {
      throw new Error(`create auth user ${key}: ${error?.message || 'missing user'}`);
    }
    return data.user.id;
  }

  const { error } = await supabase.auth.admin.updateUserById(existing.id, {
    password: E2E_PASSWORD,
    email_confirm: true,
    user_metadata: { ...(existing.user_metadata || {}), name: user.name, e2e: true },
    app_metadata: { ...(existing.app_metadata || {}), e2e: true },
  });
  if (error) {
    throw new Error(`update auth user ${key}: ${error.message}`);
  }

  return existing.id;
}

async function findAuthUserByEmail(supabase: SupabaseClient, email: string) {
  const normalizedEmail = email.toLowerCase();

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`list auth users: ${error.message}`);

    const found = data.users.find((user) => user.email?.toLowerCase() === normalizedEmail);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }

  throw new Error(`Could not find auth user ${email} after scanning 10000 users.`);
}
