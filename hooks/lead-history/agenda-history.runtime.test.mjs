import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLeadHistory } from './build-history.ts';
import { buildLabel, buildContent } from './presentation.ts';
import { mergeLeadHistoryPage } from './pagination.ts';
import { leadHistoryPageResponseSchema, leadHistoryLegacyResponseSchema } from '../../lib/validation/lead-history-pagination.ts';

const leadId = '30000000-0000-4000-8000-000000000001';
const id = value => `30000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const at = '2026-10-19T12:00:00Z', start = '2026-10-20T12:00:00Z';
const formatters = { formatCurrency: String, formatPropertyCurrency: String, formatResponseTime: String };
const actions = [
  ['agenda_created', 'Atividade agendada', 'Atividade agendada'],
  ['agenda_rescheduled', 'Atividade remarcada', 'Atividade remarcada'],
  ['agenda_completed', 'Atividade concluída', 'Atividade concluida'],
  ['agenda_no_show', 'Cliente não compareceu', 'Cliente nao compareceu'],
  ['agenda_cancelled', 'Atividade cancelada', 'Atividade cancelada'],
  ['agenda_commented', 'Comentário em atividade', 'Comentario em atividade'],
  ['agenda_updated', 'Atividade atualizada', 'Atividade atualizada'],
  ['visit_scheduled', 'Visita agendada', 'Visita agendada'],
  ['visit_made', 'Visita realizada', 'Visita realizada'],
  ['visit_confirmed', 'Visita realizada', 'Visita realizada'],
  ['meeting_scheduled', 'Reunião agendada', 'Reuniao agendada'],
  ['meeting_made', 'Reunião realizada', 'Reuniao realizada'],
  ['meeting_held', 'Reunião realizada', 'Reuniao realizada'],
];
const coverage = { complete: false, canonicalPresence: { leadCreated: false, firstResponse: false, assignment: false } };
const context = title => `${title}\n20/10/2026 às 09:00`;
function frozen(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(frozen); }
  return value;
}
function project(raw, options = {}) {
  const before = structuredClone(raw); frozen(raw);
  const result = buildLeadHistory(raw, leadId, { ...formatters, ...options });
  assert.deepEqual(raw, before); return result;
}
for (const [type, label, legacyLabel] of actions) {
  test(`${type}: canonical structured title and human organization time have one presentation`, () => {
    const metadata = { event_title: 'Visita sintética A', start_time: start, time_zone: 'America/Sao_Paulo' };
    assert.equal(buildLabel(type, metadata), label);
    assert.equal(buildContent(type, metadata, formatters), context('Visita sintética A'));
    assert.deepEqual(metadata, { event_title: 'Visita sintética A', start_time: start, time_zone: 'America/Sao_Paulo' });
  });
  test(`${type}: actual timeline columns recover only the producer's known title prefix`, () => {
    const event = project({ historyCoverage: coverage, timelineEvents: [{ id: id(10), event_type: type, title: legacyLabel,
      description: `${legacyLabel}: Visita sintética A`, metadata: { schedule_event_id: id(20), event_type: 'visit', start_time: start }, created_at: at }] })[0];
    assert.equal(event.label, label); assert.equal(event.content, context('Visita sintética A'));
  });
  test(`${type}: activity legacy prefix is presented, with raw text retained unchanged`, () => {
    const row = { id: id(10), type, content: `${legacyLabel}: Visita sintética A`, metadata: { start_time: start }, created_at: at };
    const event = project({ historyCoverage: coverage, activityEvents: [row] })[0];
    assert.equal(event.label, label); assert.equal(event.content, context('Visita sintética A'));
  });
}
for (const [zone, expected] of [['Europe/Lisbon', '20/10/2026 às 13:00'], ['America/Manaus', '20/10/2026 às 08:00'],
  ['Invalid/Zone', '20/10/2026 às 09:00'], ['', '20/10/2026 às 09:00']]) {
  test(`organization timezone ${JSON.stringify(zone)} is safe and independent from the browser zone`, () => {
    assert.equal(buildContent('agenda_created', { event_title: 'Compromisso', start_time: start, time_zone: zone }, formatters), `Compromisso\n${expected}`);
  });
}
test('an optional formatter timezone supports older metadata; canonical event timezone takes priority', () => {
  assert.equal(buildContent('agenda_created', { event_title: 'A', start_time: start }, { ...formatters, timeZone: 'Europe/Lisbon' }), 'A\n20/10/2026 às 13:00');
  assert.equal(buildContent('agenda_created', { event_title: 'A', start_time: start, time_zone: 'America/Manaus' }, { ...formatters, timeZone: 'Europe/Lisbon' }), 'A\n20/10/2026 às 08:00');
});
test('civil date changes across midnight and historical daylight saving use the requested zone', () => {
  assert.equal(buildContent('agenda_created', { event_title: 'A', start_time: '2026-10-20T01:00:00Z' }, formatters), 'A\n19/10/2026 às 22:00');
  assert.equal(buildContent('agenda_created', { event_title: 'A', start_time: '2018-12-20T12:00:00Z' }, formatters), 'A\n20/12/2018 às 10:00');
});
test('canonical title wins over safe legacy columns, and the action title is never an appointment name', () => {
  const event = project({ historyCoverage: coverage, timelineEvents: [{ id: id(10), event_type: 'agenda_created', title: 'Wrong action heading',
    description: 'Atividade agendada: Old appointment', metadata: { event_title: 'New appointment', start_time: start }, created_at: at }] })[0];
  assert.equal(event.content, context('New appointment'));
  const noContext = project({ historyCoverage: coverage, timelineEvents: [{ id: id(10), event_type: 'agenda_created', title: 'Wrong action heading', description: 'Free private text', created_at: at }] })[0];
  assert.equal(noContext.content, undefined);
});
for (const type of ['agenda_commented', 'agenda_updated', 'agenda_no_show']) {
  test(`${type}: free description/content/notes/comment bodies never become appointment context`, () => {
    const raw = { historyCoverage: coverage, timelineEvents: [{ id: id(10), event_type: type, description: 'Private comment body', created_at: at,
      metadata: { notes: 'Private notes', comment: 'Private comment', description: 'Private metadata description', start_time: start } }],
    activityEvents: [{ id: id(11), type, content: 'Private activity content', created_at: at, metadata: { comment: 'Private comment' } }] };
    const events = project(raw); assert.equal(events.length, 2);
    assert.equal(events[0].content, '20/10/2026 às 09:00'); assert.equal(events[1].content, undefined);
    assert.equal(events.map(event => event.content).join('|').includes('Private'), false);
  });
}
for (const value of [null, undefined, '', 'not-a-date', { toString: null }, [], true, Infinity]) {
  test(`invalid or malformed Agenda context remains inert: ${typeof value}/${JSON.stringify(value)}`, () => {
    assert.equal(buildContent('agenda_created', { event_title: value }, formatters), typeof value === 'string' ? value || undefined : undefined);
    assert.equal(buildContent('agenda_created', { start_time: value, time_zone: value }, formatters), undefined);
  });
}
test('legacy title/date aliases remain supported without leaking arbitrary content', () => {
  for (const key of ['starts_at', 'start_at', 'start_time', 'scheduled_at']) {
    assert.equal(buildContent('agenda_created', { title: 'Legacy title', [key]: start }, formatters), context('Legacy title'));
  }
});
test('source pairs without an explicit correlation bridge are retained, including repeated appointments', () => {
  const timeline = { id: id(10), event_type: 'agenda_created', metadata: { event_title: 'Same title', schedule_event_id: id(20), start_time: start }, created_at: at };
  const raw = { historyCoverage: coverage, timelineEvents: [timeline, { ...timeline, id: id(11) }],
    activityEvents: [{ id: id(12), type: 'visit_scheduled', content: 'Visita agendada: Same title', metadata: { schedule_event_id: id(20) }, created_at: at }] };
  assert.equal(project(raw).length, 3);
});
test('paged and legacy schemas preserve the safe timeline context and page merging preserves distinct IDs', () => {
  const event = { id: id(10), event_type: 'agenda_no_show', title: 'Cliente nao compareceu', description: 'Cliente nao compareceu: Visita sintética A', created_at: at,
    metadata: { event_title: 'Visita sintética A', time_zone: 'America/Sao_Paulo', start_time: start } };
  const data = { timelineEvents: [event], activityEvents: [], entryEvents: [], distributionLogs: [], assignmentLogs: [], auditLogs: [], users: [],
    lead: { id: leadId, created_at: at }, leadMeta: null, historyCoverage: coverage };
  const page = leadHistoryPageResponseSchema.parse({ data, pagination: { nextCursor: null, hasOlder: false, snapshotAt: at } });
  assert.equal(project(page.data).find(row => row.type === 'agenda_no_show').content, context('Visita sintética A'));
  const { historyCoverage, ...legacyData } = data; assert.equal(historyCoverage.complete, false);
  const legacy = leadHistoryLegacyResponseSchema.parse({ data: legacyData });
  assert.equal(project(legacy.data).find(row => row.type === 'agenda_no_show').content, context('Visita sintética A'));
  const merged = mergeLeadHistoryPage(undefined, { data: page.data, pagination: page.pagination }, leadId);
  assert.equal(merged.raw.timelineEvents.length, 1); assert.deepEqual(merged.raw.timelineEvents[0], event);
});
test('non-Agenda feedback, status and other event content keep their existing contracts', () => {
  assert.equal(buildLabel('note', {}), 'Nota adicionada');
  const event = project({ historyCoverage: coverage, activityEvents: [{ id: id(10), type: 'note', content: 'Private to this authorized lead feedback', created_at: at, metadata: { kind: 'feedback' } }] })[0];
  assert.equal(event.content, 'Private to this authorized lead feedback');
  assert.equal(buildContent('status_change', {}, formatters), undefined);
});
