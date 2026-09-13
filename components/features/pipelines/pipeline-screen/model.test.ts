import assert from 'node:assert/strict';
import test from 'node:test';

import type { PipelineLead, StageWithLeads } from '@/hooks/use-stages';
import {
  buildStageCountMetaMap,
  buildStageValueMap,
  formatCompactCurrency,
  getLeadTagsSignature,
  getOptimisticAutomationDealStatusForStage,
  getOptimisticDealStatusForStage,
  getPipelineErrorMessage,
  isUnsafePartialStageDrop,
  mergeMovedLeadResponse,
  shouldKeepLeadForDealStatusFilter,
} from './model';

const stage = (overrides: Partial<StageWithLeads> = {}): StageWithLeads => ({
  id: 'stage-1',
  organization_id: 'org-1',
  pipeline_id: 'pipeline-1',
  name: 'Contato',
  color: '#123456',
  stage_key: 'contact',
  position: 1,
  is_won: false,
  is_lost: false,
  is_qualified: false,
  is_active: true,
  sla_hours: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  leads: [],
  total_lead_count: 0,
  has_more: false,
  ...overrides,
});

test('formata os valores compactos usados no cabecalho da coluna', () => {
  assert.equal(formatCompactCurrency(999), 'R$999');
  assert.equal(formatCompactCurrency(1_500), 'R$1,5K');
  assert.equal(formatCompactCurrency(2_000_000), 'R$2M');
});

test('mantem tags enriquecidas quando a resposta do movimento vem vazia', () => {
  const current = {
    id: 'lead-1',
    stage_id: 'stage-1',
    tags: [{ id: 'tag-1', name: 'Quente', color: '#ff0000' }],
  } as PipelineLead;

  const merged = mergeMovedLeadResponse(current, {
    stage_id: 'stage-2',
    tags: [],
  });

  assert.equal(merged.stage_id, 'stage-2');
  assert.deepEqual(merged.tags, current.tags);
  assert.equal(getLeadTagsSignature(merged), 'tag-1:Quente:#ff0000');
});

test('prioriza totais da API e calcula fallback e paginacao por coluna', () => {
  const lead = {
    id: 'lead-1',
    stage_id: 'stage-1',
    valor_interesse: 350_000,
  } as PipelineLead;
  const stages = [
    stage({ leads: [lead], total_lead_count: 4, has_more: true }),
    stage({ id: 'stage-2', total_value: 900_000, leads: [lead], total_lead_count: 1 }),
  ];

  assert.equal(buildStageValueMap(stages).get('stage-1')?.totalValue, 350_000);
  assert.equal(buildStageValueMap(stages).get('stage-2')?.totalValue, 900_000);
  assert.deepEqual(buildStageCountMetaMap(stages).get('stage-1'), {
    total: 4,
    visible: 1,
    remaining: 3,
    canLoadMore: true,
  });
});

test('preserva filtro permissivo e fallback de erro atuais', () => {
  assert.equal(shouldKeepLeadForDealStatusFilter('won', 'won'), true);
  assert.equal(shouldKeepLeadForDealStatusFilter('won', 'open'), false);
  assert.equal(shouldKeepLeadForDealStatusFilter(null, 'open'), true);
  assert.equal(getPipelineErrorMessage({ message: 'Falhou' }), 'Falhou');
  assert.equal(getPipelineErrorMessage({ detail: 'Falhou' }), 'Erro desconhecido');
});

test('preve perda por etapa ou automacao antes da persistencia', () => {
  assert.equal(getOptimisticDealStatusForStage(stage({ is_lost: true })), 'lost');
  assert.equal(getOptimisticAutomationDealStatusForStage([{
    id: 'automation-1',
    stage_id: 'stage-1',
    organization_id: 'org-1',
    trigger_type: 'stage_enter',
    action_type: 'change_deal_status_on_enter',
    action_config: { deal_status: 'lost' },
    config: null,
    is_active: true,
    created_at: null,
    updated_at: null,
    automation_type: 'change_deal_status_on_enter',
    trigger_days: null,
    target_stage_id: null,
    whatsapp_template: null,
    alert_message: null,
  }], 'stage-1'), 'lost');
});

test('bloqueia soltura no limite desconhecido de uma coluna parcialmente carregada', () => {
  const partialStage = stage({
    leads: [{ id: 'lead-1', stage_id: 'stage-1' } as PipelineLead],
    total_lead_count: 2,
    has_more: true,
  });

  assert.equal(isUnsafePartialStageDrop(partialStage, 1, 'lead-2'), true);
  assert.equal(isUnsafePartialStageDrop(partialStage, 0, 'lead-2'), false);
  assert.equal(isUnsafePartialStageDrop(stage({ has_more: false }), 0, 'lead-2'), false);
});
