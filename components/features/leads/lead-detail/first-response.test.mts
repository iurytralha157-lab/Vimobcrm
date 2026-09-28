import assert from 'node:assert/strict';
import test from 'node:test';
const source = './first-response.ts';
const { resolvedFirstResponse } = await import(source) as typeof import('./first-response');

const recordedEvent = {
  id: 'timeline-response',
  type: 'first_response',
  label: 'Primeiro contato',
  timestamp: '2026-07-29T08:30:15Z',
  source: 'timeline' as const,
  firstResponseSeconds: 1171455,
  isAutomation: false,
};

test('usa primeiro contato estruturado do histórico quando GET do lead omite métrica', () => {
  assert.deepEqual(resolvedFirstResponse({ first_response_at: null }, [recordedEvent]), {
    seconds: 1171455,
    isAutomation: false,
    fromHistory: true,
  });
});

test('prioriza a métrica canônica do lead quando ela está disponível', () => {
  assert.deepEqual(resolvedFirstResponse({
    first_response_at: '2026-07-29T08:30:15Z',
    first_response_seconds: 120,
    first_response_is_automation: false,
  }, [recordedEvent]), {
    seconds: 120,
    isAutomation: false,
    fromHistory: false,
  });
});

test('não infere tempo de texto livre nem de evento sem duração estruturada', () => {
  assert.equal(resolvedFirstResponse({ first_response_at: null }, [{
    ...recordedEvent,
    firstResponseSeconds: null,
    content: 'Primeiro contato: 13d 13h',
  }]), null);
  assert.equal(resolvedFirstResponse({ first_response_at: null }, [{
    ...recordedEvent,
    type: 'message_sent',
  }]), null);
});
