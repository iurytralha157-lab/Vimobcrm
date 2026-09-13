import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildLeadHistory } from './build-history';
import type { LeadHistoryFormatters, LeadHistoryRaw } from './types';

const formatters: LeadHistoryFormatters = {
  formatCurrency: (value) => `BRL ${value}`,
  formatPropertyCurrency: (value) => `PROPERTY ${value}`,
  formatResponseTime: (seconds) => `RESPONSE ${seconds}`,
};

test('preserva o contrato de query e cache do hook publico', () => {
  const source = readFileSync('hooks/use-lead-history.ts', 'utf8');

  assert.match(source, /queryKey:\s*\['lead-history-v2', leadId\]/);
  assert.match(source, /getLeadHistoryRaw<LeadHistoryRaw>\(leadId\)/);
  assert.match(source, /enabled:\s*!!leadId/);
  assert.match(source, /staleTime:\s*60_000/);
  assert.match(source, /gcTime:\s*10 \* 60_000/);
  assert.match(source, /refetchOnWindowFocus:\s*false/);
});

test('deduplica pelo fingerprint, mantém o registro mais completo e respeita a timeline autoritativa', () => {
  const raw: LeadHistoryRaw = {
    timelineEvents: [{
      id: 'timeline-stage',
      event_type: 'stage_changed',
      created_at: '2026-09-06T12:00:02.000Z',
      metadata: { old_stage_name: 'Novo', new_stage_name: 'Contato' },
    }],
    activityEvents: [
      {
        id: 'note-less-detail',
        type: 'note',
        content: 'Mesmo conteúdo',
        created_at: '2026-09-06T12:00:00.100Z',
        metadata: {},
      },
      {
        id: 'note-more-detail',
        type: 'note',
        content: 'Mesmo conteúdo',
        created_at: '2026-09-06T12:00:00.900Z',
        metadata: { actor_id: 'user-1' },
        user_id: 'user-1',
      },
      {
        id: 'duplicate-stage',
        type: 'stage_changed',
        content: 'Movido de "Novo" para "Contato"',
        created_at: '2026-09-06T12:00:01.000Z',
        metadata: { old_stage_name: 'Novo', new_stage_name: 'Contato' },
      },
    ],
    users: [{ id: 'user-1', name: 'Ana', avatar_url: null }],
  };

  const history = buildLeadHistory(raw, 'lead-1', formatters);

  assert.deepEqual(history.map(({ id }) => id), [
    'activity-note-more-detail',
    'timeline-timeline-stage',
  ]);
  assert.deepEqual(history[0]?.actor, { id: 'user-1', name: 'Ana', avatar_url: undefined });
  assert.equal(history[1]?.label, 'Movido: Novo → Contato');
  assert.equal(history[1]?.content, 'Novo → Contato');
});

test('expande respostas e criativo Meta sem repetir campos padrao', () => {
  const raw: LeadHistoryRaw = {
    activityEvents: [{
      id: 'meta-created',
      type: 'lead_created',
      created_at: '2026-09-06T12:00:00.000Z',
      metadata: {
        source: 'meta',
        source_type: 'meta_lead_ads',
        form_name: 'Formulário Premium',
        form_id: 'form-1',
        custom_fields: {
          faixa_orcamento: ['500 mil', '700 mil'],
        },
        field_data: {
          email: 'ana@example.com',
          objetivo_compra: { value: 'Morar' },
        },
        raw_payload: {
          lead_details: {
            creative: {
              name: 'Apartamento Jardins',
              image_url: 'https://example.com/creative.jpg',
            },
            ad_name: 'Anúncio A',
            campaign_name: 'Campanha Setembro',
          },
        },
      },
    }],
  };

  const history = buildLeadHistory(raw, 'lead-1', formatters);
  const answers = history.filter(({ type }) => type === 'meta_form_answer');
  const creative = history.find(({ type }) => type === 'meta_creative');

  assert.deepEqual(
    answers.map(({ label, content }) => ({ label, content })),
    [
      { label: 'Meta: faixa orcamento', content: '500 mil, 700 mil' },
      { label: 'Meta: objetivo compra', content: 'Morar' },
    ],
  );
  assert.equal(answers.some(({ content }) => content === 'ana@example.com'), false);
  assert.equal(creative?.label, 'Criativo Meta');
  assert.equal(creative?.content, 'Apartamento Jardins');
  assert.equal(creative?.metadata?.creative_url, 'https://example.com/creative.jpg');
});

test('expande payload webhook aninhado, remove campos tecnicos e evita duplicatas', () => {
  const raw: LeadHistoryRaw = {
    activityEvents: [{
      id: 'webhook-created',
      type: 'lead_created',
      created_at: '2026-09-06T12:00:00.000Z',
      metadata: {
        source: 'webhook',
        webhook_name: 'Landing Parceiro',
        payload: {
          name: 'Ana',
          utm_source: 'google',
          custom_fields: [
            { label: 'tipo_empreendimento', value: 'Residencial' },
            { field_label: 'principal_desafio', values: ['Prazo', 'Verba'] },
            { label: 'tipo_empreendimento', value: 'Residencial' },
          ],
        },
      },
    }],
  };

  const history = buildLeadHistory(raw, 'lead-1', formatters);
  const answers = history.filter(({ type }) => type === 'webhook_form_answer');

  assert.deepEqual(
    answers.map(({ label, content }) => ({ label, content })),
    [
      { label: 'Webhook: Tipo do empreendimento', content: 'Residencial' },
      { label: 'Webhook: Principal desafio', content: 'Prazo, Verba' },
    ],
  );
  assert.equal(answers.every(({ channel, sourceOrigin }) => channel === 'webhook' && sourceOrigin === 'webhook'), true);
});

test('monta atribuicao e auditoria, resolve atores e suprime o fallback redundante', () => {
  const raw: LeadHistoryRaw = {
    lead: {
      id: 'lead-1',
      source: 'manual',
      assigned_user_id: 'user-new',
      assigned_at: '2026-09-06T12:01:00.000Z',
      created_at: '2026-09-06T12:00:00.000Z',
    },
    assignmentLogs: [{
      id: 'assignment-1',
      old_user_id: 'user-old',
      new_user_id: 'user-new',
      created_by: 'user-actor',
      reason: 'manual_transfer',
      created_at: '2026-09-06T12:02:00.000Z',
    }],
    auditLogs: [{
      id: 'audit-1',
      action: 'update',
      old_data: {},
      new_data: { cpf: '12345678900', valor_interesse: 350000 },
      user_id: 'user-actor',
      created_at: '2026-09-06T12:03:00.000Z',
    }],
    users: [
      { id: 'user-old', name: 'Bruno' },
      { id: 'user-new', name: 'Carla' },
      { id: 'user-actor', name: 'Diego', avatar_url: 'https://example.com/diego.jpg' },
    ],
  };

  const history = buildLeadHistory(raw, 'lead-1', formatters);
  const assignment = history.find(({ id }) => id === 'assignment-assignment-1');
  const audit = history.find(({ id }) => id === 'audit-audit-1');

  assert.equal(history.some(({ id }) => id === 'lead-fallback-assigned-lead-1'), false);
  assert.equal(assignment?.label, 'Lead transferido por Diego para Carla');
  assert.equal(assignment?.content, undefined);
  assert.deepEqual(assignment?.actor, {
    id: 'user-actor',
    name: 'Diego',
    avatar_url: 'https://example.com/diego.jpg',
  });
  assert.equal(audit?.type, 'lead_updated');
  assert.equal(audit?.content, 'CPF adicionado\nValor de interesse adicionado: PROPERTY 350000');
});

test('cria fallbacks ausentes e ordena todo o historico do mais antigo ao mais novo', () => {
  const raw: LeadHistoryRaw = {
    lead: {
      id: 'lead-1',
      source: 'whatsapp',
      assigned_user_id: 'user-1',
      assigned_at: '2026-09-06T12:02:00.000Z',
      created_at: '2026-09-06T12:00:00.000Z',
    },
    entryEvents: [{
      id: 'entry-1',
      entry_type: 'reentry',
      source: 'meta',
      campaign_name: 'Campanha A',
      created_at: '2026-09-06T12:01:00.000Z',
    }],
    users: [{ id: 'user-1', name: 'Ana' }],
  };

  const history = buildLeadHistory(raw, 'lead-1', formatters);

  assert.deepEqual(history.map(({ id }) => id), [
    'lead-fallback-created-lead-1',
    'entry-entry-1',
    'lead-fallback-assigned-lead-1',
  ]);
  assert.equal(history[0]?.label, 'Lead criado via WhatsApp');
  assert.equal(history[0]?.content, 'Origem: WhatsApp');
  assert.equal(history[1]?.label, '2ª Entrada');
  assert.equal(history[1]?.content, 'Origem: meta | Campanha: Campanha A');
  assert.equal(history[2]?.label, 'Atribuído a Ana');
  assert.equal(history[2]?.content, 'Registro sem fila de distribuição vinculada');
});
