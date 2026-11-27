import assert from 'node:assert/strict';
import test from 'node:test';
import type { StageWithLeads } from '@/hooks/use-stages';
import { stagesReorderInputSchema } from '@/lib/validation/pipelines';
import { toStageEditorSaveValues, toStageEditorValues } from './stage-editor-contract';

const id = '11111111-1111-4111-8111-111111111111';
const version = '2026-10-12T12:00:00.123456Z';
const stage = { id, name: 'Novo', color: '#123456', position: 0, stage_key: 'new', updated_at: version, leads: [], total_lead_count: 0 } as unknown as StageWithLeads;

function transportValues(values: ReturnType<typeof toStageEditorSaveValues>) {
  return { stages: values.map(({ stage_key, ...value }) => ({ ...value, stageKey: stage_key })) };
}

test('board adapter and editor save preserve the exact existing stage version for real validation', () => {
  const originals = toStageEditorValues([stage]);
  const edited = originals.map((item) => ({ ...item, name: 'Contato', position: 1 }));
  const body = transportValues(toStageEditorSaveValues(edited, originals));
  assert.equal(body.stages[0].expectedUpdatedAt, version);
  assert.equal(stagesReorderInputSchema.safeParse(body).success, true);
});

test('a mixed existing/new batch sends a version only for existing stages', () => {
  const originals = toStageEditorValues([stage]);
  const added = { ...originals[0], id: '22222222-2222-4222-8222-222222222222', name: 'Visita', stage_key: 'visit', updated_at: undefined };
  const body = transportValues(toStageEditorSaveValues([...originals, added], originals));
  assert.equal(body.stages[1].isNew, true);
  assert.equal(body.stages[1].expectedUpdatedAt, undefined);
  assert.equal(stagesReorderInputSchema.safeParse(body).success, true);
});

test('reordering keeps stored legacy and absent colors while sending an explicit color edit', () => {
  const legacy = { ...stage, color: '#abc' };
  const withoutColor = { ...stage, id: '22222222-2222-4222-8222-222222222222', color: null };
  const colored = { ...stage, id: '33333333-3333-4333-8333-333333333333' };
  const originals = toStageEditorValues([legacy, withoutColor, colored]);
  const reordered = [originals[1], originals[0], { ...originals[2], color: '#abcdef' }];
  const body = transportValues(toStageEditorSaveValues(reordered, originals));

  assert.deepEqual(body.stages.map((item) => item.id), [withoutColor.id, legacy.id, colored.id]);
  assert.deepEqual(body.stages.map((item) => item.color), [undefined, undefined, '#abcdef']);
  assert.equal(stagesReorderInputSchema.safeParse({ ...body, preserveStageColors: true }).success, true);
});

test('an existing stage without a version remains rejected instead of weakening concurrency checks', () => {
  const originals = toStageEditorValues([stage]);
  const body = transportValues(toStageEditorSaveValues(originals, originals));
  const withoutRevision = Object.fromEntries(Object.entries(body.stages[0]).filter(([key]) => key !== 'expectedUpdatedAt'));
  const result = stagesReorderInputSchema.safeParse({ stages: [withoutRevision] });
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.error.issues[0].message, 'Atualize as colunas antes de salvar');
});
