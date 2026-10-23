import assert from 'node:assert/strict';
import test from 'node:test';
import { canManageTeamPipeline, getTeamPipelineQueryState } from './team-pipeline-management';

test('pipeline managers can link teams without needing team_manage', () => {
  assert.equal(canManageTeamPipeline({ isAdmin: false, isTeamLeader: false, ledTeamIds: [], hasPipelinePermission: true }, 'team-a'), true);
  assert.equal(canManageTeamPipeline({ isAdmin: false, isTeamLeader: false, ledTeamIds: [], hasPipelinePermission: false }, 'team-a'), false);
});

test('a manager who is also a leader has read-only links outside led teams', () => {
  const access = { isAdmin: false, isTeamLeader: true, ledTeamIds: ['team-a'], hasPipelinePermission: true };
  assert.equal(canManageTeamPipeline(access, 'team-a'), true);
  assert.equal(canManageTeamPipeline(access, 'team-b'), false);
  assert.equal(canManageTeamPipeline({ ...access, isAdmin: true }, 'team-b'), true);
});

test('relationship loading and failures never become an empty successful overview', () => {
  const ready = { isPending: false, isError: false };
  assert.equal(getTeamPipelineQueryState([ready, ready, { isPending: true, isError: false }]), 'loading');
  assert.equal(getTeamPipelineQueryState([ready, ready, { isPending: false, isError: true }]), 'error');
  assert.equal(getTeamPipelineQueryState([{ isPending: false, isError: true }, ready, ready]), 'error');
  assert.equal(getTeamPipelineQueryState([ready, ready, ready]), 'ready');
});
