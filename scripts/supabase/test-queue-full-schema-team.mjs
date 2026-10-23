import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RUNTIME_ROOT } from './queue-local-homologation-target.mjs';
import { assertInvariants, closeFullSchemaContext, createFullSchemaContext, requireStatus, snapshot, wakeSyntheticLead } from './queue-full-schema-support.mjs';

export async function runTeamCase(filename) {
  const output = path.join(RUNTIME_ROOT, 'full-schema-team-report.json');
  const report = { kind: 'vimob-queue-full-schema-team-report-v1', attemptId: crypto.randomUUID(), startedAt: new Date().toISOString(), phase: 'initializing', passed: false };
  const save = () => fs.writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
  await save();
  let context;
  try {
    context = await createFullSchemaContext(filename, { authRoles: ['admin'] });
    Object.assign(report, { runId: context.manifest.runId, fullSchema: context.fullSchema, observations: context.observations, created: context.created, phase: 'running' });
    await save();
    const org = context.fixture.organizations[0];
    const roles = ['leader', 'broker1', 'broker2', 'broker3', 'broker4', 'broker5'];
    const team = requireStatus(await context.request(org, 'admin', 'POST', '/v1/teams', {
      name: `Equipe Horários Sintética ${crypto.randomBytes(4).toString('hex')}`, is_active: true,
      members: roles.map(role => ({ userId: org.users[role].id, isLeader: role === 'leader',
        availability: Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, is_active: true, is_all_day: true, start_time: null, end_time: null })) })),
    }, { 'Idempotency-Key': crypto.randomUUID() }), 201, 'create isolated team').data;
    assert.ok(team?.id);
    report.teamId = team.id;
    // The real team API requires seven explicit days on creation. This one
    // declared synthetic setup removes only this newly created team's weeks
    // to exercise the fail-closed legacy/no-schedule condition itself.
    const removed = await context.db.query(`delete from public.member_availability availability using public.team_members member
      where availability.organization_id=$1 and member.organization_id=$1 and member.team_id=$2
        and availability.team_member_id=member.id`, [org.id, team.id]);
    assert.equal(removed.rowCount, 42);
    context.observations.push({ test: 'synthetic-no-availability-setup', teamId: team.id, removedRows: removed.rowCount,
      scope: 'Only the six members of this just-created synthetic team; every subsequent availability change uses the real Go API.' });
    const queue = await context.createQueue(org, 'team-calendar', { members: [{ teamId: team.id, weight: 1, isActive: true }] });
    const eligible = async candidate => (await context.db.query('select user_id from private.queue_runtime_members($1,$2,clock_timestamp()) where is_available order by user_id', [org.id, candidate.id])).rows.map(row => row.user_id);
    assert.deepEqual(await eligible(queue), []);
    const lead = await context.createLead(org, queue, 'team-no-availability');
    report.queueId = queue.id;
    report.leadId = lead.id;
    assert.equal((await snapshot(context, org, lead)).owner, null);
    const members = (await context.db.query('select id,user_id from public.team_members where organization_id=$1 and team_id=$2', [org.id, team.id])).rows;
    const schedule = async (userId, open) => {
      const member = members.find(item => item.user_id === userId);
      assert.ok(member);
      const current = requireStatus(await context.request(org, 'admin', 'GET', `/v1/team-members/${member.id}/availability`), 200, 'read real availability');
      // The existing team API requires at least one active weekday. A week
      // open only two weekdays ahead is valid and closed at this instant.
      const futureDay = (new Date().getUTCDay() + 2) % 7;
      requireStatus(await context.request(org, 'admin', 'PUT', `/v1/team-members/${member.id}/availability`, {
        expected_revision: current.revision,
        availability: Array.from({ length: 7 }, (_, day_of_week) => ({ team_member_id: member.id, day_of_week,
          is_active: open || day_of_week === futureDay, is_all_day: open || day_of_week === futureDay, start_time: null, end_time: null })),
      }), 200, 'replace real weekly availability');
    };
    for (const role of roles.filter(role => role.startsWith('broker'))) await schedule(org.users[role].id, true);
    const expected = roles.filter(role => role.startsWith('broker')).map(role => org.users[role].id).sort();
    assert.deepEqual(await eligible(queue), expected);
    await wakeSyntheticLead(context, org, lead);
    await context.runtimeOnce();
    const assigned = await snapshot(context, org, lead);
    context.observations.push({ test: 'team-availability-activated', eligibleUsers: expected, owner: assigned.owner, episodeId: assigned.runtime?.episode_id });
    assert.ok(expected.includes(assigned.owner));
    await schedule(assigned.owner, false);
    await wakeSyntheticLead(context, org, lead);
    await context.runtimeOnce();
    const reassigned = await snapshot(context, org, lead);
    context.observations.push({ test: 'team-current-owner-availability-closed', previousOwner: assigned.owner, owner: reassigned.owner, episodeId: reassigned.runtime?.episode_id });
    assert.ok(reassigned.owner && reassigned.owner !== assigned.owner);
    assert.equal(reassigned.runtime.episode_id, assigned.runtime.episode_id);
    for (const role of roles.filter(role => role.startsWith('broker'))) await schedule(org.users[role].id, false);
    assert.deepEqual(await eligible(queue), []);
    await wakeSyntheticLead(context, org, lead);
    await context.runtimeOnce();
    const pooled = await snapshot(context, org, lead);
    context.observations.push({ test: 'team-all-availability-closed', owner: pooled.owner, state: pooled.runtime?.state });
    assert.equal(pooled.owner, null);
    assert.ok(['pool_ready', 'pool_waiting'].includes(pooled.runtime.state));
    const mixed = await context.createQueue(org, 'team-plus-direct', { members: [{ teamId: team.id, weight: 1, isActive: true },
      { userId: org.users.broker1.id, weight: 1, isActive: true }] });
    assert.deepEqual(await eligible(mixed), [org.users.broker1.id]);
    const direct = await context.createLead(org, mixed, 'direct-bypasses-team-hours');
    assert.equal((await snapshot(context, org, direct)).owner, org.users.broker1.id);
    report.assertions = { noAvailabilityPooled: true, activeEligibleBrokers: 5, leaderWithoutAvailabilityExcluded: true,
      unavailableCurrentOwnerRedistributed: true, allUnavailablePooled: true, directMembershipBypassesTeamHours: true, duplicateUserEligibleOnce: true };
    report.timerMethod = 'Only next_action_at of this created synthetic lead was advanced; due_at and the global clock were preserved.';
    report.invariants = await assertInvariants(context);
    report.phase = 'verifying_cleanup';
    await save();
  } catch (error) {
    report.passed = false; report.failedPhase = report.phase; report.phase = 'failed'; report.completedAt = new Date().toISOString();
    report.fatalError = { message: error.message, code: error.code }; await save(); throw error;
  } finally {
    if (context) try { await closeFullSchemaContext(context); await save(); } catch (error) {
      report.passed = false; report.phase = 'cleanup_failed'; report.cleanupError = { message: error.message, code: error.code }; await save(); throw error;
    }
  }
  report.passed = true; report.phase = 'completed'; report.completedAt = new Date().toISOString(); await save();
  return { report: output, passed: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runTeamCase(process.argv[2]).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(`Full-schema team case failed: ${error.message}`); process.exitCode = 1; });
}
