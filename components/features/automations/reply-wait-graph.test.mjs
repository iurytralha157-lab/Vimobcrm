import assert from 'node:assert/strict';
import test from 'node:test';
import '../../../scripts/tests/typescript-alias-hooks.mjs';
const {
  automationGraphSchema,
  saveAutomationFlowInputSchema,
} = await import('../../../lib/validation/automations.ts');
const {
  automationEditorSourceHandle,
  updateAutomationWaitOutputs,
} = await import('./flow-editor-compatibility.ts');

function replyFlow(outcomes) {
  return {
    nodes: [
      { id: 'start', type: 'trigger', position: { x: 0, y: 0 }, config: { trigger_type: 'manual' } },
      { id: 'wait', type: 'delay', position: { x: 1, y: 0 }, config: { delay_type: 'minutes', delay_value: 1, stop_on_reply: true } },
      ...outcomes.map((_, index) => ({
        id: `next-${index}`,
        type: 'delay',
        position: { x: 2, y: index },
        config: { delay_type: 'seconds', delay_value: 1 },
      })),
    ],
    connections: [
      { source: 'start', target: 'wait' },
      ...outcomes.map((outcome, index) => ({ source: 'wait', target: `next-${index}`, ...outcome })),
    ],
  };
}

test('simulation and save accept one or both named reply outcomes', () => {
  for (const outcomes of [
    [{ source_handle: 'replied' }],
    [{ condition_branch: 'no_reply' }],
    [{ source_handle: 'replied', condition_branch: 'replied' }, { condition_branch: 'no_reply' }],
  ]) {
    const flow = replyFlow(outcomes);
    assert.equal(automationGraphSchema.safeParse(flow).success, true);
    assert.equal(saveAutomationFlowInputSchema.safeParse({ flowDefinition: flow }).success, true);
  }
});

test('simulation and save reject no outcome, unknown, unnamed, repeated or conflicting handles', () => {
  for (const outcomes of [
    [],
    [{}],
    [{ source_handle: 'unknown' }, { condition_branch: 'no_reply' }],
    [{ source_handle: 'replied' }, { condition_branch: 'replied' }],
    [{ source_handle: 'replied', condition_branch: 'no_reply' }],
  ]) {
    const flow = replyFlow(outcomes);
    const preview = automationGraphSchema.safeParse(flow);
    assert.equal(preview.success, false);
    assert.equal(saveAutomationFlowInputSchema.safeParse({ flowDefinition: flow }).success, false);
    if (!outcomes.length) assert.match(preview.error.issues[0].message, /Conecte pelo menos uma saída da espera/);
  }
});

test('wait-mode changes preserve the ordinary continuation on the no-response outcome', () => {
  const incoming = { id: 'in', source: 'start', target: 'wait' };
  const timeout = { id: 'out', source: 'wait', target: 'next' };
  const replied = { id: 'reply', source: 'wait', target: 'handoff', sourceHandle: 'replied' };
  assert.deepEqual(updateAutomationWaitOutputs([incoming, timeout], 'wait', true), [
    incoming,
    { ...timeout, sourceHandle: 'no_reply' },
  ]);
  assert.deepEqual(updateAutomationWaitOutputs([incoming, { ...timeout, sourceHandle: 'no_reply' }, replied], 'wait', false), [
    incoming,
    { ...timeout, sourceHandle: undefined },
  ]);
  const legacy = { source_handle: 'no_reply', condition_branch: 'no_reply' };
  assert.equal(automationEditorSourceHandle(legacy, { type: 'wait', data: {} }), undefined);
  assert.equal(automationEditorSourceHandle(legacy, { type: 'wait', data: { stop_on_reply: true } }), 'no_reply');
  assert.equal(automationEditorSourceHandle({ source_handle: 'replied', condition_branch: null }, { type: 'wait', data: { stop_on_reply: true } }), 'replied');
});
