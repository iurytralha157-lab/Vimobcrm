import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Pool } from 'pg';

import {
  E2E_ATTENTION_ITEMS,
  E2E_ATTENTION_POLICY_ID,
  E2E_ATTENTION_POLICY_KEY,
  E2E_ORGANIZATION_ID,
  E2E_CADENCE_LEADS,
  E2E_LEADS,
  E2E_OUTSIDE_TEAM_ID,
  E2E_PASSWORD,
  E2E_PIPELINE_ID,
	E2E_PROPERTY_ID,
  E2E_STAGE_ID,
  E2E_STAGE_ATTENTION_ID,
  E2E_STAGE_CADENCE_ID,
  E2E_STAGE_FINAL_ID,
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
  'automations',
  'site',
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
      delete from public.lead_tasks
      where organization_id = $1::uuid
        and cadence_enrollment_id is not null
    `, [E2E_ORGANIZATION_ID]);
    await db.query(`
      delete from public.cadence_enrollments
      where organization_id = $1::uuid
    `, [E2E_ORGANIZATION_ID]);
    await db.query(`
      delete from public.lead_attention_events
      where organization_id = $1::uuid
    `, [E2E_ORGANIZATION_ID]);
    await db.query(`
      delete from public.lead_attention_instances
      where organization_id = $1::uuid
    `, [E2E_ORGANIZATION_ID]);
    await db.query(`
      delete from public.lead_attention_policies
      where organization_id = $1::uuid
    `, [E2E_ORGANIZATION_ID]);
    await db.query(`
      delete from public.organization_attention_settings
      where organization_id = $1::uuid
    `, [E2E_ORGANIZATION_ID]);
    await db.query(`
      delete from public.stage_operational_configs
      where organization_id = $1::uuid
    `, [E2E_ORGANIZATION_ID]);
    await db.query(`
      delete from public.cadence_templates
      where organization_id = $1::uuid
    `, [E2E_ORGANIZATION_ID]);
    await db.query(`
      delete from public.leads
      where organization_id = $1::uuid
        and id = any($2::uuid[])
    `, [E2E_ORGANIZATION_ID, Object.values(E2E_CADENCE_LEADS)]);

    await db.query(`
      insert into public.organizations (
        id, name, logo_url, is_active, subscription_status, subscription_type, segment, email
      ) values ($1::uuid, $2, null, true, 'active', 'paid', 'imobiliario', $3)
      on conflict (id) do update set
        name = excluded.name,
        is_active = true,
        subscription_status = 'active',
        subscription_type = 'paid',
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
        id, organization_id, name, position, is_default, is_active
      ) values ($1::uuid, $2::uuid, 'Pipeline E2E', 0, true, true)
      on conflict (id) do update set
        organization_id = excluded.organization_id,
        name = excluded.name,
        is_default = true,
        is_active = true
    `, [E2E_PIPELINE_ID, E2E_ORGANIZATION_ID]);

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

    const cadenceStages = [
      [E2E_STAGE_CADENCE_ID, 'Primeiro contato E2E', 'contacted', '#FF4529', 1],
      [E2E_STAGE_ATTENTION_ID, 'Negociacao E2E', 'qualified', '#f59e0b', 2],
      [E2E_STAGE_FINAL_ID, 'Fechamento E2E', 'won', '#22c55e', 3],
    ] as const;

    for (const [id, name, stageKey, color, position] of cadenceStages) {
      await db.query(`
        insert into public.stages (
          id, organization_id, pipeline_id, name, stage_key, color, position, is_active
        ) values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, true)
        on conflict (id) do update set
          organization_id = excluded.organization_id,
          pipeline_id = excluded.pipeline_id,
          name = excluded.name,
          stage_key = excluded.stage_key,
          color = excluded.color,
          position = excluded.position,
          is_active = true
      `, [id, E2E_ORGANIZATION_ID, E2E_PIPELINE_ID, name, stageKey, color, position]);
    }

	await db.query(`
	  insert into public.organization_sites (
		organization_id, is_active, subdomain, site_title, site_theme
	  ) values ($1::uuid, true, 'vimob-e2e', 'Site Vimob E2E', 'light')
	  on conflict (organization_id) do update set
		is_active = true,
		subdomain = excluded.subdomain,
		site_title = excluded.site_title,
		site_theme = excluded.site_theme
	`, [E2E_ORGANIZATION_ID]);

	await db.query(`
	  insert into public.properties (
		id, organization_id, code, title, finalidade, status, published_on_site,
		cidade, bairro, preco, created_by
	  ) values (
		$1::uuid, $2::uuid, 'E2E-SITE-001', 'Imovel publico E2E', 'venda', 'active', true,
		'Sao Paulo', 'Centro', 750000, $3::uuid
	  )
	  on conflict (id) do update set
		organization_id = excluded.organization_id,
		code = excluded.code,
		title = excluded.title,
		status = 'active',
		published_on_site = true
	`, [E2E_PROPERTY_ID, E2E_ORGANIZATION_ID, userIds.admin]);

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
          name, source, status, deal_status, priority, created_by, team_id,
          attention_eligible, attention_enrolled_at
        ) values (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, now(),
          $6, 'e2e', 'new', 'open', 'normal', $7::uuid, $8::uuid,
          true, now()
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
          team_id = excluded.team_id,
          attention_eligible = true,
          attention_enrolled_at = now()
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

    const cadenceLeadFixtures = [
      [E2E_CADENCE_LEADS.primary, 'Lead Cadencia Principal E2E', E2E_STAGE_ID],
      [E2E_CADENCE_LEADS.lifecycle, 'Lead Cadencia Ciclo E2E', E2E_STAGE_ID],
      [E2E_CADENCE_LEADS.legacy, 'Lead Legado Cadencia E2E', E2E_STAGE_CADENCE_ID],
    ] as const;

    for (const [id, name, stageId] of cadenceLeadFixtures) {
      await db.query(`
        insert into public.leads (
          id, organization_id, pipeline_id, stage_id, assigned_user_id, assigned_at,
          name, source, status, deal_status, priority, created_by, team_id
        ) values (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, now(),
          $6, 'e2e-cadence', 'new', 'open', 'normal', $7::uuid, $8::uuid
        )
      `, [
        id,
        E2E_ORGANIZATION_ID,
        E2E_PIPELINE_ID,
        stageId,
        userIds.user,
        name,
        userIds.admin,
        E2E_TEAM_ID,
      ]);
    }

    await db.query(`
      insert into public.organization_attention_settings (
        organization_id, engine_mode, notifications_enabled, redistribution_enabled,
        timezone, business_hours, default_repeat_minutes, max_reminders, created_by
      ) values (
        $1::uuid, 'enabled', false, false, 'America/Sao_Paulo',
        '{"days":[1,2,3,4,5],"start":"08:00","end":"18:00"}'::jsonb,
        1440, 0, $2::uuid
      )
      on conflict (organization_id) do update set
        engine_mode = 'enabled',
        notifications_enabled = false,
        redistribution_enabled = false,
        timezone = 'America/Sao_Paulo',
        business_hours = excluded.business_hours,
        default_repeat_minutes = 1440,
        max_reminders = 0,
        updated_at = now()
    `, [E2E_ORGANIZATION_ID, userIds.admin]);

    await db.query(`
      insert into public.lead_attention_policies (
        id, organization_id, policy_key, version, name, policy_type, status,
        pipeline_id, stage_id, threshold_minutes, warning_minutes, repeat_minutes,
        escalation_minutes, redistribution_minutes, business_hours_only,
        redistribute_before_contact_only, notify_assignee, notify_leaders, notify_admins,
        config, created_by
      ) values (
        $1::uuid, $2::uuid, $3::uuid, 1, 'Contato efetivo E2E',
        'first_effective_contact', 'enabled', null, null, 120, 30, 1440,
        60, null, false, true, true, true, true, '{}'::jsonb, $4::uuid
      )
    `, [E2E_ATTENTION_POLICY_ID, E2E_ORGANIZATION_ID, E2E_ATTENTION_POLICY_KEY, userIds.admin]);

    const attentionFixtures = [
      [
        E2E_ATTENTION_ITEMS.acknowledge,
        E2E_LEADS.userOwn,
        userIds.user,
        'attention-acknowledge-e2e',
        'breached',
        false,
      ],
      [
        E2E_ATTENTION_ITEMS.snooze,
        E2E_LEADS.team,
        userIds.user,
        'attention-snooze-e2e',
        'warning',
        false,
      ],
      [
        E2E_ATTENTION_ITEMS.administrativeResolve,
        E2E_LEADS.outside,
        userIds.admin,
        'attention-resolve-e2e',
        'escalated',
        false,
      ],
      [
        E2E_ATTENTION_ITEMS.shadow,
        E2E_LEADS.leaderOwn,
        userIds.leader,
        'attention-shadow-e2e',
        'warning',
        true,
      ],
    ] as const;

    for (const [id, leadId, assignedUserId, cycleKey, status, shadow] of attentionFixtures) {
      await db.query(`
        insert into public.lead_attention_instances (
          id, organization_id, lead_id, policy_id, policy_version, cycle_key,
          assigned_user_id, pipeline_id, stage_id, baseline_at, warning_at, due_at,
          next_evaluation_at, status, shadow, escalated_at, metadata, updated_at
        ) values (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1, $5,
          $6::uuid, $7::uuid, $8::uuid, now() - interval '4 hours',
          now() - interval '3 hours', now() - interval '2 hours',
          now() + interval '30 days', $9, $10,
          case when $9 = 'escalated' then now() - interval '1 hour' else null end,
          '{}'::jsonb, now()
        )
      `, [
        id,
        E2E_ORGANIZATION_ID,
        leadId,
        E2E_ATTENTION_POLICY_ID,
        cycleKey,
        assignedUserId,
        E2E_PIPELINE_ID,
        E2E_STAGE_ID,
        status,
        shadow,
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
