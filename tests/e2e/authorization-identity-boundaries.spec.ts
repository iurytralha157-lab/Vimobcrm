import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { Pool } from 'pg';

import {
  E2E_ORGANIZATION_ID,
  E2E_PASSWORD,
  E2E_USERS,
  type E2EUserKey,
  requireE2ESupabaseConfig,
} from './support/e2e-env';

type E2EConfig = ReturnType<typeof requireE2ESupabaseConfig>;
type Membership = { user_id: string; role: string; is_active: boolean };

function requireDisposableLocalTarget() {
  if (!process.env.E2E_SUPABASE_WORKDIR) {
    throw new Error('Authorization E2E requires an isolated E2E_SUPABASE_WORKDIR.');
  }
  const config = requireE2ESupabaseConfig();
  for (const target of [config.baseURL, config.apiURL, config.supabaseURL, config.databaseURL]) {
    const hostname = new URL(target).hostname;
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
      throw new Error('Authorization E2E requires four loopback targets.');
    }
  }
  return config;
}

async function signIn(config: E2EConfig, userKey: E2EUserKey) {
  const client = createClient(config.supabaseURL, config.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: E2E_USERS[userKey].email,
    password: E2E_PASSWORD,
  });
  expect(error).toBeNull();
  expect(data.session?.access_token).toBeTruthy();
  expect(data.user?.id).toBeTruthy();
  return { client, token: data.session!.access_token, userId: data.user!.id };
}

async function apiMutation(
  request: APIRequestContext,
  config: E2EConfig,
  token: string,
  organizationId: string,
  method: 'POST' | 'PUT' | 'PATCH',
  path: string,
  data: unknown,
) {
  return request.fetch(`${config.apiURL}${path}`, {
    method,
    data,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Organization-ID': organizationId,
    },
  });
}

async function dataAPIMutation(
  request: APIRequestContext,
  config: E2EConfig,
  token: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  data?: unknown,
) {
  return request.fetch(`${config.supabaseURL}/rest/v1/${path}`, {
    method,
    data,
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
  });
}

async function membershipFor(db: Pool, organizationId: string, email: string) {
  const result = await db.query<Membership>(`
    select u.id::text as user_id, om.role, om.is_active
    from public.organization_members om
    join public.users u on u.id = om.user_id
    where om.organization_id = $1::uuid
      and lower(u.email) = lower($2)
      and om.deleted_at is null
  `, [organizationId, email]);
  expect(result.rowCount, `Expected a seeded member for ${email}`).toBe(1);
  return result.rows[0];
}

async function overrideCount(db: Pool, organizationId: string, userId: string) {
  const result = await db.query<{ total: string }>(`
    select count(*)::text as total
    from public.user_permission_overrides
    where organization_id = $1::uuid and user_id = $2::uuid
  `, [organizationId, userId]);
  return Number(result.rows[0].total);
}

test('sessão revogada não desativa usuário em uma rota administrativa real', async ({ request }) => {
  const config = requireDisposableLocalTarget();
  const db = new Pool({ connectionString: config.databaseURL });
  const auth = await signIn(config, 'admin');
  const deniedRoleId = randomUUID();
  try {
    const targetBefore = await membershipFor(db, E2E_ORGANIZATION_ID, E2E_USERS.manager.email);
    const claims = JSON.parse(Buffer.from(auth.token.split('.')[1], 'base64url').toString('utf8')) as {
      session_id?: string;
    };
    expect(claims.session_id).toBeTruthy();

    const activeBefore = await db.query<{ active: boolean }>(`
      select exists (
        select 1 from auth.sessions
        where id = $1::uuid and user_id = $2::uuid
      ) as active
    `, [claims.session_id, auth.userId]);
    expect(activeBefore.rows[0].active).toBe(true);

    const signOut = await auth.client.auth.signOut({ scope: 'global' });
    expect(signOut.error).toBeNull();
    const activeAfter = await db.query<{ active: boolean }>(`
      select exists (
        select 1 from auth.sessions
        where id = $1::uuid and user_id = $2::uuid
      ) as active
    `, [claims.session_id, auth.userId]);
    expect(activeAfter.rows[0].active).toBe(false);

    const denied = await apiMutation(
      request,
      config,
      auth.token,
      E2E_ORGANIZATION_ID,
      'PATCH',
      `/v1/users/${targetBefore.user_id}`,
      { updates: { is_active: false } },
    );
    expect(denied.status()).toBe(401);
    expect(await denied.json()).toMatchObject({ error: { code: 'session_revoked' } });
    expect(await membershipFor(db, E2E_ORGANIZATION_ID, E2E_USERS.manager.email))
      .toEqual(targetBefore);

    // A revoked session can leave its JWT valid until expiry; grants must deny direct writes.
    const directDenied = await dataAPIMutation(
      request, config, auth.token, 'POST', 'organization_roles', {
        id: deniedRoleId,
        organization_id: E2E_ORGANIZATION_ID,
        name: 'Cargo tentado com sessão revogada',
      },
    );
    expect(directDenied.status()).toBe(403);
    expect(await directDenied.json()).toMatchObject({ code: '42501' });
    const roleAfter = await db.query<{ total: string }>(`
      select count(*)::text as total from public.organization_roles where id = $1::uuid
    `, [deniedRoleId]);
    expect(Number(roleAfter.rows[0].total)).toBe(0);
  } finally {
    try {
      await db.query('delete from public.organization_roles where id = $1::uuid', [deniedRoleId]);
    } finally {
      try {
        await auth.client.auth.signOut({ scope: 'global' });
      } finally {
        await db.end();
      }
    }
  }
});

test('usuário comum não altera cargo, membro nem permissões', async ({ request }) => {
  const config = requireDisposableLocalTarget();
  const db = new Pool({ connectionString: config.databaseURL });
  const auth = await signIn(config, 'user');
  try {
    const targetBefore = await membershipFor(db, E2E_ORGANIZATION_ID, E2E_USERS.manager.email);
    const overridesBefore = await overrideCount(db, E2E_ORGANIZATION_ID, targetBefore.user_id);
    const roleName = `Cargo negado ${randomUUID()}`;

    const roleDenied = await apiMutation(
      request, config, auth.token, E2E_ORGANIZATION_ID,
      'POST', '/v1/settings/roles', { name: roleName, permissions: ['users_manage'] },
    );
    expect(roleDenied.status()).toBe(403);

    const userDenied = await apiMutation(
      request, config, auth.token, E2E_ORGANIZATION_ID,
      'PATCH', `/v1/users/${targetBefore.user_id}`, { updates: { role: 'admin' } },
    );
    expect(userDenied.status()).toBe(403);

    const permissionDenied = await apiMutation(
      request, config, auth.token, E2E_ORGANIZATION_ID,
      'PUT', `/v1/settings/users/${targetBefore.user_id}/permissions`,
      { permissions: { permissions_manage: true } },
    );
    expect(permissionDenied.status()).toBe(403);

    const createdRoles = await db.query<{ total: string }>(`
      select count(*)::text as total from public.organization_roles
      where organization_id = $1::uuid and name = $2
    `, [E2E_ORGANIZATION_ID, roleName]);
    expect(Number(createdRoles.rows[0].total)).toBe(0);
    expect(await membershipFor(db, E2E_ORGANIZATION_ID, E2E_USERS.manager.email))
      .toEqual(targetBefore);
    expect(await overrideCount(db, E2E_ORGANIZATION_ID, targetBefore.user_id))
      .toBe(overridesBefore);
  } finally {
    await auth.client.auth.signOut({ scope: 'global' });
    await db.end();
  }
});

test('administrador de uma imobiliária não altera a segunda imobiliária', async ({ request }) => {
  const config = requireDisposableLocalTarget();
  const db = new Pool({ connectionString: config.databaseURL });
  const auth = await signIn(config, 'admin');
  const otherOrganizationId = randomUUID();
  const otherRoleId = randomUUID();
  const otherAssignmentId = randomUUID();
  const deniedRoleId = randomUUID();
  const presenceSessionId = randomUUID();
  const originalRoleName = `Cargo da segunda imobiliária ${otherRoleId}`;
  let organizationCreated = false;
  try {
    const managerBefore = await membershipFor(db, E2E_ORGANIZATION_ID, E2E_USERS.manager.email);
    await db.query(`
      insert into public.organizations (
        id, name, is_active, subscription_status, subscription_type, segment, email
      ) values ($1::uuid, 'Segunda imobiliária E2E', true, 'active', 'paid',
        'imobiliario', 'segunda.e2e@vimob.test')
    `, [otherOrganizationId]);
    organizationCreated = true;
    await db.query(`
      insert into public.organization_roles (id, organization_id, name)
      values ($1::uuid, $2::uuid, $3)
    `, [otherRoleId, otherOrganizationId, originalRoleName]);
    await db.query(`
      insert into public.organization_members (organization_id, user_id, role, is_active)
      values ($1::uuid, $2::uuid, 'user', true)
    `, [otherOrganizationId, managerBefore.user_id]);
    await db.query(`
      insert into public.user_organization_roles (
        id, organization_id, user_id, organization_role_id, role_id, is_active
      ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $4::uuid, true)
    `, [otherAssignmentId, otherOrganizationId, managerBefore.user_id, otherRoleId]);
    const otherMemberBefore = await membershipFor(
      db, otherOrganizationId, E2E_USERS.manager.email,
    );

    // The organization header must not turn an admin of A into an admin of B.
    const headerDenied = await apiMutation(
      request, config, auth.token, otherOrganizationId,
      'PATCH', `/v1/users/${managerBefore.user_id}`, { updates: { is_active: false } },
    );
    expect(headerDenied.status()).toBe(403);
    expect(await headerDenied.json()).toMatchObject({ error: { code: 'organization_access_denied' } });

    // A valid A context must not find B's role through an unscoped row query.
    const roleDenied = await apiMutation(
      request, config, auth.token, E2E_ORGANIZATION_ID,
      'PATCH', `/v1/settings/roles/${otherRoleId}`, { name: 'Alteração indevida' },
    );
    expect(roleDenied.status()).toBe(400);
    expect(await roleDenied.json()).toMatchObject({ error: { code: 'invalid_settings_input' } });

    // Call PostgREST itself with the admin JWT: the Go middleware is not in this path.
    const directInsert = await dataAPIMutation(
      request, config, auth.token, 'POST', 'organization_roles',
      { id: deniedRoleId, organization_id: E2E_ORGANIZATION_ID, name: 'Cargo direto negado' },
    );
    expect(directInsert.status()).toBe(403);
    expect(await directInsert.json()).toMatchObject({ code: '42501' });

    const directUpdate = await dataAPIMutation(
      request, config, auth.token, 'PATCH', `organization_roles?id=eq.${otherRoleId}`,
      { name: 'Alteração direta indevida' },
    );
    expect(directUpdate.status()).toBe(403);
    expect(await directUpdate.json()).toMatchObject({ code: '42501' });

    const directDelete = await dataAPIMutation(
      request, config, auth.token, 'DELETE',
      `user_organization_roles?id=eq.${otherAssignmentId}`,
    );
    expect(directDelete.status()).toBe(403);
    expect(await directDelete.json()).toMatchObject({ code: '42501' });

    const deniedRole = await db.query<{ total: string }>(`
      select count(*)::text as total from public.organization_roles where id = $1::uuid
    `, [deniedRoleId]);
    expect(Number(deniedRole.rows[0].total)).toBe(0);
    const assignment = await db.query<{ is_active: boolean }>(`
      select is_active from public.user_organization_roles
      where id = $1::uuid and organization_id = $2::uuid
    `, [otherAssignmentId, otherOrganizationId]);
    expect(assignment.rows).toEqual([{ is_active: true }]);

    const roleAfter = await db.query<{ name: string }>(`
      select name from public.organization_roles
      where id = $1::uuid and organization_id = $2::uuid
    `, [otherRoleId, otherOrganizationId]);
    expect(roleAfter.rows).toEqual([{ name: originalRoleName }]);
    expect(await membershipFor(db, E2E_ORGANIZATION_ID, E2E_USERS.manager.email))
      .toEqual(managerBefore);
    expect(await membershipFor(db, otherOrganizationId, E2E_USERS.manager.email))
      .toEqual(otherMemberBefore);

    // Presence is an intentional browser write and must remain available.
    const presenceInsert = await dataAPIMutation(
      request, config, auth.token, 'POST', 'user_activity_sessions', {
        organization_id: E2E_ORGANIZATION_ID,
        user_id: auth.userId,
        session_id: presenceSessionId,
        status: 'online',
        metadata: {},
      },
    );
    expect(presenceInsert.status()).toBe(201);
    const presenceUpdate = await dataAPIMutation(
      request, config, auth.token, 'PATCH',
      `user_activity_sessions?organization_id=eq.${E2E_ORGANIZATION_ID}` +
        `&user_id=eq.${auth.userId}&session_id=eq.${presenceSessionId}`,
      { status: 'offline' },
    );
    expect(presenceUpdate.status()).toBe(204);
    const presence = await db.query<{ status: string }>(`
      select status from public.user_activity_sessions
      where organization_id = $1::uuid and user_id = $2::uuid and session_id = $3
    `, [E2E_ORGANIZATION_ID, auth.userId, presenceSessionId]);
    expect(presence.rows).toEqual([{ status: 'offline' }]);
  } finally {
    try {
      await db.query(`
        delete from public.user_activity_sessions
        where organization_id = $1::uuid and user_id = $2::uuid and session_id = $3
      `, [E2E_ORGANIZATION_ID, auth.userId, presenceSessionId]);
      if (organizationCreated) {
        await db.query(`
          delete from public.user_organization_roles where id = $1::uuid
        `, [otherAssignmentId]);
        await db.query(`
          delete from public.organization_members
          where organization_id = $1::uuid
        `, [otherOrganizationId]);
        await db.query(`
          delete from public.organization_roles
          where id = $1::uuid and organization_id = $2::uuid
        `, [otherRoleId, otherOrganizationId]);
        await db.query('delete from public.organizations where id = $1::uuid', [otherOrganizationId]);
      }
    } finally {
      await auth.client.auth.signOut({ scope: 'global' });
      await db.end();
    }
  }
});
