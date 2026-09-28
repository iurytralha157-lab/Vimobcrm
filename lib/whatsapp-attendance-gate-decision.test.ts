import assert from 'node:assert/strict';
import test from 'node:test';

import { getWhatsAppAttendanceGateDecision } from './whatsapp-attendance-gate-decision';

test('asks for attendance only before this user first enters the current conversation', () => {
  assert.equal(getWhatsAppAttendanceGateDecision({ joined: false, canSend: true }), 'confirm');
  assert.equal(getWhatsAppAttendanceGateDecision({ joined: true, canSend: true }), 'send');
});

test('a denied capability never opens the confirmation or sends', () => {
  assert.equal(getWhatsAppAttendanceGateDecision({ joined: false, canSend: false }), 'blocked');
  assert.equal(getWhatsAppAttendanceGateDecision({ joined: true, canSend: false }), 'blocked');
});

test('owner flow remains compatible while the API and Web releases roll out', () => {
  assert.equal(getWhatsAppAttendanceGateDecision({ joined: false }), 'confirm');
  assert.equal(getWhatsAppAttendanceGateDecision({ joined: true }), 'send');
});
