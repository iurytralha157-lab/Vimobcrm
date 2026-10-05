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
  assert.match(source, /getLeadHistoryRaw<LeadHistoryRaw>\(leadId, organizationId\)/);
  assert.match(source, /enabled:\s*!!leadId && !!organizationId/);
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

test('prioriza a mudança de etapa da API e não atribui ao destinatário o registro isolado do gatilho', () => {
  const history = buildLeadHistory({
    activityEvents: [
      {
        id: 'trigger-duplicate',
        type: 'stage_change',
        content: 'Movido de "Novo" para "Contato"',
        created_at: '2026-09-27T12:00:00.000Z',
        user_id: 'recipient',
        metadata: {
          from_stage_id: 'stage-new', to_stage_id: 'stage-contact',
          from_stage: 'Novo', to_stage: 'Contato', actor_id: 'recipient',
        },
      },
      {
        id: 'api-stage-move',
        type: 'stage_change',
        content: 'Lead "Maria" movido de etapa',
        created_at: '2026-09-27T12:00:00.100Z',
        user_id: 'manager',
        metadata: {
          from_stage_id: 'stage-new', to_stage_id: 'stage-contact',
          from_stage: 'Novo', to_stage: 'Contato',
          from_pipeline: 'pipeline-1', to_pipeline: 'pipeline-1',
        },
      },
      {
        id: 'trigger-only',
        type: 'stage_change',
        content: 'Movido de "Contato" para "Visita"',
        created_at: '2026-09-27T12:10:00.000Z',
        user_id: 'recipient',
        metadata: {
          from_stage_id: 'stage-contact', to_stage_id: 'stage-visit',
          from_stage: 'Contato', to_stage: 'Visita', actor_id: 'recipient',
        },
      },
    ],
    users: [{ id: 'manager', name: 'Gestora Maria' }, { id: 'recipient', name: 'Ana Corretora' }],
  }, 'lead-1', formatters);

  assert.deepEqual(history.map(({ id }) => id), ['activity-api-stage-move', 'activity-trigger-only']);
  assert.equal(history[0]?.actor?.name, 'Gestora Maria');
  assert.equal(history[1]?.actor, null);
  assert.equal(history[1]?.label, 'Movido: Contato → Visita');
});

test('deduplica a mesma transição na borda temporal sem ocultar outra mudança de etapa', () => {
  const history = buildLeadHistory({
    activityEvents: [
      {
        id: 'trigger-at-boundary', type: 'stage_change',
        content: 'Movido de "Novo" para "Contato"',
        created_at: '2026-09-27T12:00:01.999Z', user_id: 'recipient',
        metadata: { from_stage_id: 'stage-new', to_stage_id: 'stage-contact', from_stage: 'Novo', to_stage: 'Contato' },
      },
      {
        id: 'api-after-boundary', type: 'stage_change',
        content: 'Lead "Maria" movido de etapa',
        created_at: '2026-09-27T12:00:02.001Z', user_id: 'manager',
        metadata: {
          from_stage_id: 'stage-new', to_stage_id: 'stage-contact',
          from_stage: 'Novo', to_stage: 'Contato', to_pipeline: 'pipeline-1',
        },
      },
      {
        id: 'separate-stage-move', type: 'stage_change',
        content: 'Movido de "Contato" para "Qualificados"',
        created_at: '2026-09-27T12:00:03.000Z', user_id: 'recipient',
        metadata: {
          from_stage_id: 'stage-contact', to_stage_id: 'stage-qualified',
          from_stage: 'Contato', to_stage: 'Qualificados',
        },
      },
    ],
    users: [{ id: 'manager', name: 'Gestora Maria' }, { id: 'recipient', name: 'Ana Corretora' }],
  }, 'lead-1', formatters);

  assert.deepEqual(history.map(({ id }) => id), ['activity-api-after-boundary', 'activity-separate-stage-move']);
  assert.equal(history[0]?.actor?.name, 'Gestora Maria');
  assert.equal(history[1]?.actor, null);
});

test('preserva o nome do participante no evento de entrada no atendimento', () => {
  const raw: LeadHistoryRaw = {
    timelineEvents: [{
      id: 'attendance-entry-1',
      event_type: 'whatsapp_attendance_joined',
      title: 'Ana entrou no atendimento',
      user_id: 'user-1',
      created_at: '2026-09-23T12:00:00.000Z',
      metadata: {
        attendance_entry_id: 'entry-1',
        marker_kind: 'joined',
        marker_at: '2026-09-23T12:00:00.000Z',
      },
    }],
    users: [{ id: 'user-1', name: 'Ana', avatar_url: null }],
  };

  const history = buildLeadHistory(raw, 'lead-1', formatters);

  assert.equal(history[0]?.type, 'whatsapp_attendance_joined');
  assert.equal(history[0]?.label, 'Ana entrou no atendimento');
  assert.equal(history[0]?.content, undefined);
});

test('omite entrada antiga no atendimento sem envio confirmado', () => {
  const history = buildLeadHistory({
    timelineEvents: [{
      id: 'legacy-attendance-entry',
      event_type: 'whatsapp_attendance_joined',
      title: 'Ana entrou no atendimento',
      created_at: '2026-09-23T12:00:00.000Z',
      metadata: { attendance_entry_id: 'entry-1' },
    }, {
      id: 'incomplete-attendance-marker',
      event_type: 'whatsapp_attendance_joined',
      title: 'Ana entrou no atendimento',
      created_at: '2026-09-23T12:01:00.000Z',
      metadata: { attendance_entry_id: 'entry-2', marker_kind: 'joined' },
    }],
  }, 'lead-1', formatters);

  assert.deepEqual(history, []);
});

test('distribuição automática mostra o destinatário sem atribuir a ação a ele', () => {
  const timestamp = '2026-09-27T12:00:00.000Z';
  const history = buildLeadHistory({
    timelineEvents: [{
      id: 'queue-event',
      event_type: 'lead_assigned',
      user_id: 'recipient',
      created_at: timestamp,
      metadata: {
        queue_id: 'queue-1',
        queue_name: 'Fila Principal',
        assigned_user_id: 'recipient',
        assigned_user_name: 'Ana Corretora',
        distribution_type: 'canonical_round_robin',
      },
    }],
    activityEvents: [{
      id: 'assignment-trigger',
      type: 'assignee_changed',
      user_id: 'recipient',
      created_at: timestamp,
      metadata: { to_user_id: 'recipient', to_user_name: 'Ana Corretora' },
    }],
    assignmentLogs: [{
      id: 'assignment-log',
      new_user_id: 'recipient',
      reason: 'round_robin',
      created_at: timestamp,
    }],
    users: [{ id: 'recipient', name: 'Ana Corretora' }],
  }, 'lead-1', formatters);

  assert.deepEqual(history.map(({ type }) => type), ['lead_assigned']);
  assert.equal(history[0]?.actor, null);
  assert.equal(history[0]?.isAutomation, true);
  assert.equal(history[0]?.metadata?.assigned_user_name, 'Ana Corretora');
});

test('log da fila não transforma o destinatário em autor da distribuição', () => {
  const history = buildLeadHistory({
    distributionLogs: [{
      id: 'queue-log',
      round_robin_id: 'queue-1',
      assigned_user_id: 'recipient',
      assigned_user: { id: 'recipient', name: 'Ana Corretora' },
      queue: { id: 'queue-1', name: 'Fila Principal' },
      created_at: '2026-09-27T12:00:00.000Z',
    }],
  }, 'lead-1', formatters);

  assert.equal(history[0]?.type, 'lead_assigned');
  assert.equal(history[0]?.actor, null);
  assert.equal(history[0]?.metadata?.to_user_name, 'Ana Corretora');
});

test('mostra falta de fila compatível uma vez, sem motivo técnico em inglês', () => {
  const timestamp = '2026-09-27T12:00:00.000Z';
  const history = buildLeadHistory({
    timelineEvents: [{
      id: 'pending-event',
      event_type: 'lead_distribution_pending',
      created_at: timestamp,
      metadata: { reason: 'no_matching_queue', distribution_event_id: 'attempt-1' },
    }],
    distributionLogs: [{
      id: 'pending-log',
      round_robin_id: null,
      assigned_user_id: null,
      reason: 'no_matching_queue',
      created_at: timestamp,
      metadata: { distribution_event_id: 'attempt-1' },
    }],
  }, 'lead-1', formatters);

  assert.equal(history.length, 1);
  assert.equal(history[0]?.label, 'Nenhuma fila de distribuição compatível');
  assert.equal(history[0]?.content, undefined);
  assert.equal(history[0]?.isAutomation, true);
});

test('preserva a fila original e uma única tentativa sem responsável disponível', () => {
  const timestamp = '2026-09-27T12:00:00.000Z';
  const history = buildLeadHistory({
    timelineEvents: [{
      id: 'pending-event',
      event_type: 'lead_distribution_pending',
      created_at: timestamp,
      metadata: {
        reason: 'no_available_members',
        queue_id: 'queue-1',
        queue_name: 'Fila original',
        distribution_event_id: 'attempt-1',
      },
    }],
    distributionLogs: [{
      id: 'pending-log',
      round_robin_id: 'queue-1',
      assigned_user_id: null,
      reason: 'no_available_members',
      created_at: timestamp,
      queue: { id: 'queue-1', name: 'Fila renomeada' },
      metadata: { queue_name: 'Fila original', distribution_event_id: 'attempt-1' },
    }],
  }, 'lead-1', formatters);

  assert.equal(history.length, 1);
  assert.match(history[0]?.label || '', /Fila original.*nenhum responsável disponível/);
  assert.equal(history[0]?.actor, null);
  assert.equal(history[0]?.metadata?.reason, 'no_available_members');
});

test('transferência manual preserva o autor e o destinatário distintos', () => {
  const history = buildLeadHistory({
    assignmentLogs: [{
      id: 'manual-transfer',
      new_user_id: 'recipient',
      created_by: 'manager',
      reason: 'manual_transfer',
      created_at: '2026-09-27T12:00:00.000Z',
      actor: { id: 'manager', name: 'Gestora Maria' },
      new_user: { id: 'recipient', name: 'Ana Corretora' },
    }],
  }, 'lead-1', formatters);

  assert.equal(history[0]?.type, 'assignee_changed');
  assert.equal(history[0]?.actor?.name, 'Gestora Maria');
  assert.equal(history[0]?.metadata?.to_user_name, 'Ana Corretora');
  assert.equal(history[0]?.isAutomation, false);
});

test('ordena pela ocorrência e mostra primeira resposta persistida sem duplicar evento', () => {
  const raw: LeadHistoryRaw = {
    lead: {
      id: 'lead-1',
      created_at: '2026-09-01T09:00:00.000Z',
      first_response_at: '2026-09-01T09:03:00.000Z',
      first_response_seconds: 180,
      first_response_channel: 'whatsapp',
      first_response_is_automation: false,
      first_response_actor: { id: 'user-1', name: 'Ana' },
    },
    timelineEvents: [{
      id: 'late-write',
      event_type: 'whatsapp_message_sent',
      created_at: '2026-09-01T09:10:00.000Z',
      event_at: '2026-09-01T09:02:00.000Z',
      metadata: {},
    }],
  };

  const history = buildLeadHistory(raw, 'lead-1', formatters);
  assert.deepEqual(history.map(({ type }) => type), [
    'lead_created', 'whatsapp_message_sent', 'first_response',
  ]);
  assert.equal(history[1]?.timestamp, '2026-09-01T09:02:00.000Z');
  assert.equal(history[2]?.content, 'Primeiro contato: RESPONSE 180');
  assert.equal(history[2]?.actor?.name, 'Ana');

  raw.timelineEvents?.push({
    id: 'recorded-response',
    event_type: 'first_response',
    event_at: '2026-09-01T09:03:00.000Z',
    metadata: { response_seconds: 180 },
  });
  assert.equal(buildLeadHistory(raw, 'lead-1', formatters).filter(({ type }) => type === 'first_response').length, 1);
});

test('rotula resposta automática herdada sem chamá-la de contato humano', () => {
  const history = buildLeadHistory({
    lead: {
      id: 'lead-1',
      created_at: '2026-09-01T09:00:00.000Z',
      first_response_at: '2026-09-01T09:01:00.000Z',
      first_response_seconds: 60,
      first_response_is_automation: true,
    },
  }, 'lead-1', formatters);
  const response = history.find(({ type }) => type === 'first_response');
  assert.equal(response?.label, 'Primeira resposta automática');
  assert.equal(response?.content, 'Resposta automática: RESPONSE 60');
});

test('histórico de auditoria não exibe valores protegidos nem campos técnicos', () => {
  const history = buildLeadHistory({
    auditLogs: [{
      id: 'audit-redacted',
      action: 'update',
      created_at: '2026-09-01T10:00:00.000Z',
      old_data: { name: '[valor protegido]', integration_secret: 'secret-old' },
      new_data: { name: '[valor protegido]', integration_secret: 'secret-new' },
    }],
  }, 'lead-1', formatters);
  const audit = history.find(({ id }) => id === 'audit-audit-redacted');
  assert.equal(audit?.content, 'Nome atualizado');
  assert.doesNotMatch(JSON.stringify(audit), /secret-new|secret-old/);
});

test('eventos técnicos sem tradução conhecida não aparecem em inglês', () => {
  const history = buildLeadHistory({
    timelineEvents: [
      { id: 'assignment', event_type: 'assignment_changed', event_at: '2026-09-01T10:00:00Z' },
      { id: 'unknown', event_type: 'external_provider_reconciled', event_at: '2026-09-01T10:01:00Z' },
    ],
  }, 'lead-1', formatters);
  assert.deepEqual(history.map(({ label }) => label), ['Responsável alterado', 'Atividade registrada']);
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
