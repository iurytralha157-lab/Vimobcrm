import assert from 'node:assert/strict';
import { test } from 'node:test';
const source = './origin-answers.ts';
const { formAnswersFromHistory } = await import(source) as typeof import('./origin-answers');

const event = (type: string, label: string, content: string | null) =>
  ({ id: `${type}-${label}`, type, label, content, timestamp: '2026-01-01T00:00:00Z', source: 'activity' as const });

test('only form answers with content are listed, without the channel prefix', () => {
  const answers = formAnswersFromHistory([
    event('meta_form_answer', 'Meta: Qual bairro?', ' Asa Norte '),
    event('webhook_form_answer', 'Webhook: Renda', '10 mil'),
    event('meta_form_answer', 'Meta: Vazio', '   '),
    event('lead_created', 'Lead criado', 'x'),
  ]);
  assert.deepEqual(answers.map(({ question, answer }) => [question, answer]), [['Qual bairro?', 'Asa Norte'], ['Renda', '10 mil']]);
});

test('missing history yields no answers', () => {
  assert.deepEqual(formAnswersFromHistory(undefined), []);
});
