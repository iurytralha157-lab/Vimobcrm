import assert from 'node:assert/strict';
import test from 'node:test';

import { VimobAPIError } from './api/vimob-error';
import { describeWhatsAppAttendanceFailure } from './whatsapp-attendance-error';

test('a rejected first attendance entry tells the user why the draft was not sent', () => {
  const missingSession = new VimobAPIError('WhatsApp session was not found.', {
    code: 'whatsapp_session_not_found',
    status: 404,
  });
  const description = describeWhatsAppAttendanceFailure(missingSession);
  assert.match(description, /conexão.*indisponível/);
  assert.match(description, /atribuição deste lead/);
});

test('binding changes and timeouts do not suggest that a message was sent', () => {
  const binding = new VimobAPIError('binding changed', {
    code: 'whatsapp_conversation_binding_changed',
    status: 409,
  });
  const timeout = new VimobAPIError('timeout', {
    code: 'api_timeout',
    status: 0,
  });
  assert.match(describeWhatsAppAttendanceFailure(binding), /Atualize o atendimento/);
  assert.match(describeWhatsAppAttendanceFailure(timeout), /mensagem continua no campo de texto/);
});
