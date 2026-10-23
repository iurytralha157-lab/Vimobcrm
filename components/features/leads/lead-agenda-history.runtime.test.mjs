import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { evaluateProduction } from '../../../hooks/leads/lead-request-runtime-fixture.mjs';
import { buildLeadHistory } from '../../../hooks/lead-history/build-history.ts';

// Exercise the production builder and the two production bubble presenters.
// No network, application server, authentication or CRM data is needed.
const file = process.env.AGENDA_RENDER_SOURCE || 'components/features/leads/LeadUnifiedThread.tsx';
const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['getAttachmentFileName', 'metadataText', 'getStageNameFromMetadata', 'getOutcomeLabel',
  'getOutcomeActionLabel', 'getLostReason', 'getEventDetail', 'isAttachmentEvent', 'normalizeEventLabel']);
const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)
  || ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(source) === 'OUTCOME_LABELS'));
const presenter = evaluateProduction(declarations.map(node => node.getText(source)).join('\n'),
  { formatBRLCurrencyWithDefaultDecimals: String }, '({getEventDetail,normalizeEventLabel})');
const formatters = { formatCurrency: String, formatPropertyCurrency: String, formatResponseTime: String };
const coverage = { complete: false, canonicalPresence: { leadCreated: false, firstResponse: false, assignment: false } };
const actions = [
  ['agenda_created', 'Atividade agendada'], ['agenda_rescheduled', 'Atividade remarcada'],
  ['agenda_completed', 'Atividade concluída'], ['agenda_no_show', 'Cliente não compareceu'],
  ['agenda_cancelled', 'Atividade cancelada'], ['agenda_commented', 'Comentário em atividade'],
  ['agenda_updated', 'Atividade atualizada'], ['visit_scheduled', 'Visita agendada'],
  ['visit_made', 'Visita realizada'], ['visit_confirmed', 'Visita realizada'],
  ['meeting_scheduled', 'Reunião agendada'], ['meeting_made', 'Reunião realizada'], ['meeting_held', 'Reunião realizada'],
];
const timestamp = '2026-10-19T12:00:00Z';
const expected = 'Visita sintética A\n20/10/2026 às 09:00';

for (const [type, label] of actions) {
  test(`${type}: shared mobile/desktop bubble uses the authorized history projection`, () => {
    const raw = { historyCoverage: coverage, timelineEvents: [{ id: 'synthetic', event_type: type, created_at: timestamp,
      metadata: { event_title: 'Visita sintética A', start_time: '2026-10-20T12:00:00Z', time_zone: 'America/Sao_Paulo' } }] };
    const before = structuredClone(raw);
    const [event] = buildLeadHistory(raw, 'lead-a', formatters);
    assert.equal(presenter.normalizeEventLabel(event), label);
    assert.equal(presenter.getEventDetail(event), expected);
    assert.deepEqual(raw, before);
  });
  test(`${type}: a restricted/deleted appointment keeps its fact without reconstructing private detail`, () => {
    const [event] = buildLeadHistory({ historyCoverage: coverage,
      timelineEvents: [{ id: 'restricted', event_type: type, created_at: timestamp }] }, 'lead-a', formatters);
    assert.equal(presenter.normalizeEventLabel(event), label);
    assert.equal(presenter.getEventDetail(event), null);
    assert.equal(event.actor, null);
    assert.equal(event.timestamp, timestamp);
  });
  test(`${type}: renderer does not bypass projection with raw private metadata or attachment heuristics`, () => {
    const event = { id: 'projected', type, label, timestamp, source: 'timeline', content: expected,
      metadata: { notes: 'Private notes', comment: 'Private body', answer: 'Private answer',
        file_name: 'Private-file.pdf', event_title: 'Wrong current title', start_time: '2027-01-01T00:00:00Z' } };
    assert.equal(presenter.normalizeEventLabel(event), label);
    assert.equal(presenter.getEventDetail(event), expected);
  });
}

test('Agenda bubble does not format the saved schedule timestamp again in the browser timezone', () => {
  const [event] = buildLeadHistory({ historyCoverage: coverage, timelineEvents: [{ id: 'zoned', event_type: 'agenda_created',
    created_at: timestamp, metadata: { event_title: 'Visita sintética A', start_time: '2026-10-20T12:00:00Z', time_zone: 'Europe/Lisbon' } }] }, 'lead-a', formatters);
  assert.equal(presenter.getEventDetail(event), 'Visita sintética A\n20/10/2026 às 13:00');
});

test('feedback and contact outcomes keep their previous presentation', () => {
  const feedback = { id: 'feedback', type: 'note', label: 'Nota adicionada', content: 'Feedback legítimo', timestamp, source: 'activity' };
  assert.equal(presenter.normalizeEventLabel(feedback), 'Feedback legítimo');
  const call = { ...feedback, type: 'call', metadata: { channel: 'phone', outcome: 'answered', notes: 'Retornar amanhã' } };
  assert.equal(presenter.getEventDetail(call), 'Desfecho: Atendeu\nObservações: Retornar amanhã');
});
