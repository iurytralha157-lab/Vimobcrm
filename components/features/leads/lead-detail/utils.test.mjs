import assert from 'node:assert/strict';
import test from 'node:test';
import { ptBR } from 'date-fns/locale';
import {
  getCadenceTaskType,
  getScheduleDateLabel,
  getScheduleStatusLabel,
  getStageStepperStyle,
  mergePropertyFallback,
} from './utils.ts';

test('preserva a propriedade hidratada como fallback sem duplicar o catálogo', () => {
  const catalog = [{ id: 'property-1', title: 'Catálogo' }];

  assert.strictEqual(
    mergePropertyFallback(catalog, { id: 'property-1', title: 'Lead' }),
    catalog,
  );
  assert.deepEqual(
    mergePropertyFallback(catalog, { id: 'property-2', title: 'Lead' }),
    [{ id: 'property-2', title: 'Lead' }, ...catalog],
  );
});

test('mantém os fallbacks operacionais de cadência e status', () => {
  assert.equal(getCadenceTaskType('message'), 'message');
  assert.equal(getCadenceTaskType('unsupported'), 'call');
  assert.equal(getScheduleStatusLabel('cancelled'), 'Cancelado');
  assert.equal(getScheduleStatusLabel('pending', true), 'Atrasado');
});

test('mantém os limiares do stepper e a apresentação da agenda', () => {
  assert.equal(getStageStepperStyle(20)['--lead-stage-step-size'], '2rem');
  assert.equal(getStageStepperStyle(21)['--lead-stage-step-size'], '1.55rem');
  assert.equal(getStageStepperStyle(33)['--lead-stage-step-size'], '1.35rem');
  assert.equal(
    getScheduleDateLabel(
      {
        id: 'event-1',
        title: 'Visita',
        event_type: 'visit',
        status: 'pending',
        start_time: '2026-09-06T14:00:00-03:00',
        end_time: '2026-09-06T15:00:00-03:00',
        is_all_day: false,
      },
      ptBR,
    ),
    '06/09 14:00-15:00',
  );
});
