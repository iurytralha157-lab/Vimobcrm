import assert from 'node:assert/strict';
import { test } from 'node:test';
import { automationEditorSession, canSelectAutomationSender } from './flow-editor-compatibility.ts';

test('outbound choices keep connected owned and shared send grants', () => {
  const sessions = [
    { id: 'owned', status: 'connected', can_send: true },
    { id: 'shared', status: 'connected', can_send: true },
    { id: 'read-only', status: 'connected', can_send: false },
    { id: 'unknown-grant', status: 'connected' },
    { id: 'pending', status: 'pending', can_send: true },
    { id: 'disconnected', status: 'disconnected', can_send: true },
  ];
  assert.deepEqual(sessions.filter(canSelectAutomationSender).map(session => session.id), ['owned', 'shared']);
});

test('unavailable saved sender remains stored while unrelated nodes are edited', () => {
  for (const status of ['pending', 'disconnected', 'connected']) {
    const saved = { session_id: 'saved-sender', status, can_send: false };
    assert.equal(canSelectAutomationSender(saved), false);
    assert.equal(automationEditorSession(saved, 'other-shared-sender', false), 'saved-sender');
  }
  assert.equal(automationEditorSession({ session_id: 'missing-from-catalog' }, '', false), 'missing-from-catalog');
});

test('replacing an existing sender remains an explicit editor choice', () => {
  assert.equal(automationEditorSession({ session_id: 'saved-sender' }, 'selected-shared-sender', true), 'selected-shared-sender');
});
