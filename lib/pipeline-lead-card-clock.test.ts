import assert from 'node:assert/strict';
import test from 'node:test';
import { getPipelineLeadCardClockKey, pipelineLeadCardPropsEqual } from './pipeline-lead-card-clock';

test('clock memo skips only identical visible elapsed labels and assignment state', () => {
  const lead = { stage_entered_at: '2026-10-16T10:00:00Z', created_at: '2026-10-16T10:00:00Z', assigned_user_id: 'actor' };
  const now = Date.parse('2026-10-16T12:00:00Z');
  const props = { lead, nowMs: now };
  assert.equal(pipelineLeadCardPropsEqual(props, { ...props, nowMs: now + 30_000 }), true);
  assert.equal(pipelineLeadCardPropsEqual(props, { ...props, nowMs: now + 3_600_000 }), false);
  const minuteLead = { ...lead, stage_entered_at: '2026-10-16T11:59:00Z' };
  assert.equal(getPipelineLeadCardClockKey(minuteLead, now), '1min:false');
  assert.notEqual(getPipelineLeadCardClockKey(minuteLead, now), getPipelineLeadCardClockKey(minuteLead, now + 60_000));
  const pending = { ...lead, assigned_user_id: null, created_at: new Date(now).toISOString() };
  assert.notEqual(getPipelineLeadCardClockKey(pending, now + 9_999), getPipelineLeadCardClockKey(pending, now + 10_000));
  assert.equal(getPipelineLeadCardClockKey({ stage_entered_at: 'invalid' }, now), '—:false');
});

test('callback, permissions, identity and every other changed prop always rerender', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  const props = { lead: { stage_entered_at: '2026-10-16T10:00:00Z', tags: ['original'], assignee: { name: 'A' }, deal_status: 'open' }, nowMs: now, onClick: () => {}, onAssignNow: () => {}, isDragDisabled: false, canViewWhatsApp: true, canOperateWhatsApp: true, hasWhatsAppModule: true, index: 1, stageId: 'stage' };
  for (const patch of [
    { onClick: () => {} }, { onAssignNow: () => {} }, { isDragDisabled: true }, { canViewWhatsApp: false }, { canOperateWhatsApp: false }, { hasWhatsAppModule: false }, { index: 2 }, { stageId: 'other' },
    { lead: { ...props.lead, tags: ['new'] } }, { lead: { ...props.lead, assignee: { name: 'B' } } }, { lead: { ...props.lead, deal_status: 'won' } },
  ]) assert.equal(pipelineLeadCardPropsEqual(props, { ...props, nowMs: now + 30_000, ...patch }), false);
  const propsWithExtraKey = { ...props, extra: true };
  assert.equal(pipelineLeadCardPropsEqual(props, propsWithExtraKey), false);
});
