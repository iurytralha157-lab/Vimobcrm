import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  apiStartAutomationResponseSchema,
  apiAutomationMediaListResponseSchema,
  apiAutomationRuntimeIssuesResponseSchema,
  createAutomationInputSchema,
  saveAutomationFlowInputSchema,
} from "./automations";
import {
  apiCadenceTemplateSchema,
  createCadenceTaskInputSchema,
} from "./cadences";
import {
  financialCategoryInputSchema,
  financialContractCreateInputSchema,
  financialEntryCreateInputSchema,
} from "./financial";
import {
  metaFormConfigInputSchema,
  sendMetaMessageInputSchema,
  vistaIntegrationInputSchema,
} from "./integrations";
import {
  propertyCreateInputSchema,
  propertyListQuerySchema,
} from "./properties";
import {
  apiScheduleEventListResponseSchema,
  createScheduleEventInputSchema,
  scheduleClockInputSchema,
  scheduleCommentInputSchema,
  updateScheduleEventInputSchema,
} from "./schedule";
import { buildScheduleEventInterval } from "../schedule-event-draft";
import {
  apiPaymentHistoryItemSchema,
  apiSubscriptionOverviewSchema,
  assignUserRoleInputSchema,
  changePasswordInputSchema,
  checkoutBillingDetailsSchema,
  subscriptionChargeInputSchema,
  updateOrganizationInputSchema,
} from "./settings";
import {
  addRoundRobinMemberInputSchema,
  availabilityInputSchema,
  bulkAvailabilityInputSchema,
  contactListQuerySchema,
  createRoundRobinInputSchema,
  createTagInputSchema,
  createTeamInputSchema,
  dispatchNotificationInputSchema,
  updateTagInputSchema,
  apiNotificationListResponseSchema,
} from "./crm-support";
import {
  aiAgentConfigSchema,
  aiRunInputSchema,
  adminModuleAccessInputSchema,
  analyticsQuerySchema,
  apiDashboardStatsResponseSchema,
  apiDashboardTopBrokersResponseSchema,
  dashboardDateRangeSchema,
  dashboardFiltersSchema,
  dashboardLimitSchema,
  apiGamificationRuleSchema,
  gamificationActionTypeSchema,
  gamificationDecisionInputSchema,
  gamificationEventListQuerySchema,
  gamificationManualEntryInputSchema,
  gamificationMissionInputSchema,
  gamificationRankingQuerySchema,
  gamificationRuleInputSchema,
  safePathSegmentSchema,
} from "./final-domains";
import {
  auditLogCreateInputSchema,
  apiMeProfileResponseSchema,
  checkoutBillingDraftSessionSchema,
  checkoutBillingProfileSessionSchema,
  paymentCheckoutQuerySchema,
  apiPropertyOwnerPageResponseSchema,
  propertyCondominiumInputSchema,
  propertyOwnerInputSchema,
  propertyOwnerPageQuerySchema,
  reportErrorEventInputSchema,
  searchFilterColumnsSchema,
  siteReorderInputSchema,
  userActivityPresenceSessionInputSchema,
  userActivitySessionMutationInputSchema,
  webhookCreateInputSchema,
} from "./auxiliary";

const ID = "11111111-1111-4111-8111-111111111111";
const dashboardAPISource = readFileSync("lib/api/dashboard.ts", "utf8");
const dashboardHookSource = readFileSync("hooks/use-dashboard-stats.ts", "utf8");
const dashboardOpenAPISource = readFileSync(
  "packages/contracts/openapi/v1.yaml",
  "utf8",
);

const validAutomationFlow = {
  nodes: [
    {
      id: "trigger-1",
      type: "trigger" as const,
      position: { x: 0, y: 0 },
      config: { trigger_type: "manual" },
    },
    {
      id: "message-1",
      type: "action" as const,
      action_type: "send_whatsapp" as const,
      position: { x: 200, y: 0 },
      config: { session_id: ID, message: "Olá {{lead.name}}" },
    },
  ],
  connections: [{ source: "trigger-1", target: "message-1" }],
  settings: {},
};

test("imovel exige titulo e filtros usam UUID valido", () => {
  assert.equal(
    propertyCreateInputSchema.safeParse({ status: "active" }).success,
    false,
  );
  assert.equal(
    propertyCreateInputSchema.safeParse({
      title: "Apartamento Centro",
      tipo_de_imovel: "Apartamento",
      quartos: 2,
    }).success,
    true,
  );
  assert.equal(
    propertyCreateInputSchema.safeParse({
      title: "Apartamento Centro",
      tipo_de_imovel: "Apartamento",
      preco: -1,
    }).success,
    false,
  );
  assert.equal(
    propertyCreateInputSchema.safeParse({
      title: "Apartamento Centro",
      tipo_de_imovel: "Apartamento",
      quartos: 2.5,
    }).success,
    false,
  );
  assert.equal(
    propertyCreateInputSchema.safeParse({
      title: "Apartamento Centro",
      tipo_de_imovel: "Apartamento",
      latitude: 91,
    }).success,
    false,
  );
  assert.equal(
    propertyListQuerySchema.safeParse({ owner_id: "invalido" }).success,
    false,
  );
});

test("automacao pode nascer como rascunho ou publicar o fluxo atomicamente", () => {
  assert.equal(
    createAutomationInputSchema.safeParse({
      name: "Primeiro atendimento",
      trigger_type: "manual",
    }).success,
    true,
  );
  assert.equal(
    createAutomationInputSchema.safeParse({
      name: "Primeiro atendimento",
      trigger_type: "manual",
      flow_definition: validAutomationFlow,
    }).success,
    true,
  );
  assert.equal(
    createAutomationInputSchema.safeParse({
      name: "Primeiro atendimento",
      trigger_type: "manual",
      is_active: true,
    }).success,
    false,
  );
  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: { nodes: [], connections: [], settings: {} },
    }).success,
    false,
  );
  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: validAutomationFlow,
    }).success,
    true,
  );
  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: {
        ...validAutomationFlow,
        nodes: validAutomationFlow.nodes.map((node) =>
          node.id === "message-1"
            ? {
                ...node,
                config: {
                  ...node.config,
                  message: "Olá {{lead.campo_inexistente}}",
                },
              }
            : node,
        ),
      },
    }).success,
    false,
  );
  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: {
        ...validAutomationFlow,
        nodes: validAutomationFlow.nodes.map((node) =>
          node.id === "message-1"
            ? {
                ...node,
                config: { ...node.config, message: "Olá {{lead.name}" },
              }
            : node,
        ),
      },
    }).success,
    false,
  );
});

test("automacao rejeita grafo desconectado, ciclico e acao desconhecida", () => {
  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: {
        ...validAutomationFlow,
        nodes: [
          ...validAutomationFlow.nodes,
          {
            id: "orphan-1",
            type: "action" as const,
            action_type: "send_whatsapp" as const,
            position: { x: 400, y: 0 },
            config: { session_id: ID, message: "Órfão" },
          },
        ],
      },
    }).success,
    false,
  );

  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: {
        ...validAutomationFlow,
        connections: [
          ...validAutomationFlow.connections,
          { source: "message-1", target: "trigger-1" },
        ],
      },
    }).success,
    false,
  );

  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: {
        ...validAutomationFlow,
        nodes: validAutomationFlow.nodes.map((node) =>
          node.id === "message-1"
            ? { ...node, action_type: "send_email" }
            : node,
        ),
      },
    }).success,
    false,
  );

  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: {
        ...validAutomationFlow,
        nodes: validAutomationFlow.nodes.map((node) =>
          node.id === "message-1"
            ? {
                ...node,
                action_type: "set_variable" as const,
                config: { actionType: "deal_status", deal_status: "won" },
              }
            : node,
        ),
      },
    }).success,
    false,
  );

  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: {
        ...validAutomationFlow,
        nodes: validAutomationFlow.nodes.map((node) =>
          node.id === "message-1"
            ? {
                ...node,
                action_type: "move_lead" as const,
                config: { pipeline_id: ID, stage_id: ID },
              }
            : node,
        ),
      },
    }).success,
    true,
  );

  const unsupportedCrmActions = [
    {
      action_type: "set_variable" as const,
      config: { actionType: "property_interest", property_id: ID },
    },
  ];
  for (const unsupportedAction of unsupportedCrmActions) {
    assert.equal(
      saveAutomationFlowInputSchema.safeParse({
        flowDefinition: {
          ...validAutomationFlow,
          nodes: validAutomationFlow.nodes.map((node) =>
            node.id === "message-1" ? { ...node, ...unsupportedAction } : node,
          ),
        },
      }).success,
      false,
    );
  }

  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: {
        ...validAutomationFlow,
        nodes: validAutomationFlow.nodes.map((node) =>
          node.id === "message-1"
            ? {
                ...node,
                action_type: "assign_user" as const,
                config: { user_id: ID },
              }
            : node,
        ),
      },
    }).success,
    true,
  );
});

test("galeria de automacao pagina sem truncar silenciosamente", () => {
  assert.equal(
    apiAutomationMediaListResponseSchema.safeParse({
      data: { files: [], nextOffset: 50 },
    }).success,
    true,
  );
  assert.equal(
    apiAutomationMediaListResponseSchema.safeParse({ data: [] }).success,
    false,
  );
});

test("inicio de automacao aceita o estado real observado pelo backend", () => {
  const base = {
    executionId: ID,
    automationId: ID,
    automationName: "Primeiro atendimento",
    executorStarted: true,
    dispatchPending: false,
  };

  for (const status of [
    "queued",
    "running",
    "waiting",
    "completed",
    "cancelled",
  ]) {
    assert.equal(
      apiStartAutomationResponseSchema.safeParse({ data: { ...base, status } })
        .success,
      true,
    );
  }
  assert.equal(
    apiStartAutomationResponseSchema.safeParse({
      data: { ...base, status: "failed" },
    }).success,
    false,
  );
});

test("saude das automacoes distingue retry seguro de efeito ambiguo", () => {
  assert.equal(
    apiAutomationRuntimeIssuesResponseSchema.safeParse({
      data: {
        summary: {
          deadLetters: 1,
          failedEvents: 0,
          failedEffects: 0,
          openCircuits: 0,
          duplicateDecisions: 0,
          unknownEffects: 1,
          staleSendingEffects: 0,
        },
        issues: [
          {
            id: ID,
            kind: "ambiguous_effect",
            severity: "error",
            status: "unknown",
            automationId: ID,
            automationName: "Primeiro atendimento",
            executionId: ID,
            leadId: ID,
            message: "Resultado externo desconhecido",
            details: { effectType: "send_whatsapp" },
            retryable: false,
            occurredAt: "2026-07-12T12:00:00Z",
          },
        ],
      },
    }).success,
    true,
  );
});

test("automacao exige audiencia e fuso validos no agendamento", () => {
  const scheduledFlow = {
    ...validAutomationFlow,
    nodes: validAutomationFlow.nodes.map((node) =>
      node.id === "trigger-1"
        ? {
            ...node,
            config: {
              trigger_type: "scheduled",
              scheduled_at: "2030-01-01T10:00:00-03:00",
              timezone: "America/Sao_Paulo",
              target_type: "lead",
              target_lead_id: ID,
            },
          }
        : node,
    ),
  };
  assert.equal(
    saveAutomationFlowInputSchema.safeParse({ flowDefinition: scheduledFlow })
      .success,
    true,
  );
  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: {
        ...scheduledFlow,
        nodes: scheduledFlow.nodes.map((node) =>
          node.id === "trigger-1"
            ? { ...node, config: { ...node.config, target_lead_id: null } }
            : node,
        ),
      },
    }).success,
    false,
  );
  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: {
        ...scheduledFlow,
        nodes: scheduledFlow.nodes.map((node) =>
          node.id === "trigger-1"
            ? {
                ...node,
                config: { ...node.config, timezone: "Fuso/Inexistente" },
              }
            : node,
        ),
      },
    }).success,
    false,
  );
});

test("automacao limita inatividade e espera conforme a unidade", () => {
  const withInactivity = (value: number, unit: "hours" | "days") => ({
    ...validAutomationFlow,
    nodes: validAutomationFlow.nodes.map((node) =>
      node.id === "trigger-1"
        ? {
            ...node,
            config: {
              trigger_type: "inactivity",
              inactivity_value: value,
              inactivity_unit: unit,
            },
          }
        : node,
    ),
  });
  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: withInactivity(8760, "hours"),
    }).success,
    true,
  );
  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: withInactivity(8761, "hours"),
    }).success,
    false,
  );
  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: withInactivity(365, "days"),
    }).success,
    true,
  );
  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: withInactivity(366, "days"),
    }).success,
    false,
  );

  const withDelay = (days: number) => ({
    nodes: [
      validAutomationFlow.nodes[0],
      {
        id: "delay-1",
        type: "delay" as const,
        position: { x: 120, y: 0 },
        config: { delay_type: "days", delay_value: days, stop_on_reply: false },
      },
      validAutomationFlow.nodes[1],
    ],
    connections: [
      { source: "trigger-1", target: "delay-1" },
      {
        source: "delay-1",
        target: "message-1",
        source_handle: "no_reply",
        condition_branch: "no_reply",
      },
    ],
    settings: {},
  });
  assert.equal(
    saveAutomationFlowInputSchema.safeParse({ flowDefinition: withDelay(30) })
      .success,
    true,
  );
  assert.equal(
    saveAutomationFlowInputSchema.safeParse({ flowDefinition: withDelay(31) })
      .success,
    false,
  );
});

test("automacao conversacional exige espera respondida e caminho seguro para resposta incerta", () => {
  const action = (id: string, message: string) => ({
    id,
    type: "action" as const,
    action_type: "send_whatsapp" as const,
    position: { x: 600, y: 0 },
    config: { session_id: ID, message },
  });
  const flow = {
    nodes: [
      validAutomationFlow.nodes[0],
      validAutomationFlow.nodes[1],
      {
        id: "wait-reply",
        type: "delay" as const,
        position: { x: 300, y: 0 },
        config: {
          delay_type: "hours" as const,
          delay_value: 1,
          stop_on_reply: true,
        },
      },
      {
        id: "classify-reply",
        type: "condition" as const,
        position: { x: 450, y: 0 },
        config: {
          condition_type: "response_sentiment" as const,
          positive_keywords: "sim, pode ser",
          negative_keywords: "não, não quero",
        },
      },
      action("timeout", "Ainda está por aí?"),
      action("positive", "Perfeito!"),
      action("negative", "Sem problemas."),
      action("uncertain", "Vou pedir ajuda de uma pessoa."),
    ],
    connections: [
      { source: "trigger-1", target: "message-1" },
      { source: "message-1", target: "wait-reply" },
      {
        source: "wait-reply",
        target: "timeout",
        source_handle: "no_reply",
        condition_branch: "no_reply",
      },
      {
        source: "wait-reply",
        target: "classify-reply",
        source_handle: "replied",
        condition_branch: "replied",
      },
      {
        source: "classify-reply",
        target: "positive",
        source_handle: "true",
        condition_branch: "true",
      },
      {
        source: "classify-reply",
        target: "negative",
        source_handle: "false",
        condition_branch: "false",
      },
      {
        source: "classify-reply",
        target: "uncertain",
        source_handle: "unknown",
        condition_branch: "unknown",
      },
    ],
    settings: {},
  };

  assert.equal(
    saveAutomationFlowInputSchema.safeParse({ flowDefinition: flow }).success,
    true,
  );
  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: {
        ...flow,
        connections: flow.connections.filter(
          (connection) => connection.condition_branch !== "unknown",
        ),
      },
    }).success,
    false,
  );
  assert.equal(
    saveAutomationFlowInputSchema.safeParse({
      flowDefinition: {
        ...flow,
        connections: flow.connections.map((connection) =>
          connection.target === "classify-reply"
            ? {
                ...connection,
                source: "message-1",
                source_handle: null,
                condition_branch: null,
              }
            : connection,
        ),
      },
    }).success,
    false,
  );
});

test("cadencia rejeita dia negativo", () => {
  assert.equal(
    createCadenceTaskInputSchema.safeParse({
      cadence_template_id: ID,
      day_offset: -1,
      type: "call",
      title: "Ligar",
    }).success,
    false,
  );
});

test("cadencia le tarefa historica negativa sem liberar escrita negativa", () => {
  assert.equal(
    apiCadenceTemplateSchema.safeParse({
      id: ID,
      organization_id: ID,
      pipeline_id: ID,
      stage_id: ID,
      stage_key: "base",
      name: "Base",
      is_active: true,
      created_at: "2026-07-12T00:00:00Z",
      tasks: [
        {
          id: ID,
          cadence_template_id: ID,
          day_offset: -1,
          title: "Preparar atendimento",
          description: null,
          position: 0,
          type: "note",
          observation: null,
          recommended_message: null,
        },
      ],
    }).success,
    true,
  );

  assert.equal(
    createCadenceTaskInputSchema.safeParse({
      cadence_template_id: ID,
      day_offset: -1,
      type: "note",
      title: "Preparar atendimento",
    }).success,
    false,
  );
});

test("agenda rejeita horario invertido e comentario vazio", () => {
  assert.equal(
    createScheduleEventInputSchema.safeParse({
      title: "Visita",
      start_time: "2026-07-12T15:00:00Z",
      end_time: "2026-07-12T14:00:00Z",
    }).success,
    false,
  );
  assert.equal(
    scheduleCommentInputSchema.safeParse({ content: "   " }).success,
    false,
  );
  assert.equal(scheduleClockInputSchema.safeParse("08:30").success, true);
  assert.equal(scheduleClockInputSchema.safeParse("").success, false);
  assert.equal(scheduleClockInputSchema.safeParse("24:00").success, false);
  assert.equal(
    buildScheduleEventInterval({
      date: new Date("2026-07-12T12:00:00Z"),
      time: "",
      isAllDay: false,
      durationMinutes: 30,
    }),
    null,
  );
  assert.equal(
    buildScheduleEventInterval({
      date: new Date(Number.NaN),
      time: "08:30",
      isAllDay: false,
      durationMinutes: 30,
    }),
    null,
  );
  assert.equal(
    buildScheduleEventInterval({
      date: new Date("2026-07-12T12:00:00Z"),
      time: "08:30",
      isAllDay: false,
      durationMinutes: Number.NaN,
    }),
    null,
  );
  assert.notEqual(
    buildScheduleEventInterval({
      date: new Date("2026-07-12T12:00:00Z"),
      time: "",
      isAllDay: true,
      durationMinutes: Number.NaN,
    }),
    null,
  );
  assert.deepEqual(
    buildScheduleEventInterval({
      date: new Date(2026, 6, 12, 12, 0, 0, 0),
      time: "08:30",
      isAllDay: false,
      durationMinutes: 30,
    }),
    {
      startTime: new Date(2026, 6, 12, 8, 30, 0, 0).toISOString(),
      endTime: new Date(2026, 6, 12, 9, 0, 0, 0).toISOString(),
    },
  );
  assert.equal(
    updateScheduleEventInputSchema.safeParse({
      assignee_ids: [ID],
    }).success,
    true,
  );
  assert.equal(
    updateScheduleEventInputSchema.safeParse({
      assignee_ids: ["fora-do-tenant"],
    }).success,
    false,
  );
});

test("agenda aceita identidade oculta somente em evento mascarado", () => {
  const maskedEvent = {
    id: ID,
    organization_id: ID,
    user_id: null,
    lead_id: null,
    property_id: null,
    title: "Horario ocupado",
    description: "Informacao privada",
    event_type: "task",
    start_time: "2026-07-27T12:30:00Z",
    end_time: "2026-07-27T14:30:00Z",
    is_all_day: false,
    location: null,
    status: "scheduled",
    visibility: "default",
    reminder_minutes: null,
    recurrence_parent_id: null,
    recurrence_rule: null,
    recurrence_until: null,
    recurrence_count: null,
    google_event_id: null,
    completed_by: null,
    completed_at: null,
    created_at: "2026-07-27T00:00:00Z",
    updated_at: "2026-07-27T00:00:00Z",
    user: null,
    assignee_user_ids: [],
    is_masked: true,
  };

  assert.equal(
    apiScheduleEventListResponseSchema.safeParse({ data: [maskedEvent] })
      .success,
    true,
  );
  assert.equal(
    apiScheduleEventListResponseSchema.safeParse({
      data: [{ ...maskedEvent, is_masked: false }],
    }).success,
    false,
  );
});

test("financeiro valida categoria, lancamento e contrato", () => {
  assert.equal(
    financialCategoryInputSchema.safeParse({ name: "Marketing", type: "other" })
      .success,
    false,
  );
  assert.equal(
    financialEntryCreateInputSchema.safeParse({
      type: "payable",
      category: "Marketing",
    }).success,
    false,
  );
  assert.equal(
    financialContractCreateInputSchema.safeParse({
      contract_type: "sale",
      client_name: "Maria Silva",
      value: 500_000,
      property_id: ID,
    }).success,
    true,
  );
});

test("configuracoes rejeitam senha curta, percentual excessivo e papel invalido", () => {
  assert.equal(
    changePasswordInputSchema.safeParse({ password: "1234567" }).success,
    false,
  );
  assert.equal(
    updateOrganizationInputSchema.safeParse({
      default_commission_percentage: 101,
    }).success,
    false,
  );
  assert.equal(
    assignUserRoleInputSchema.safeParse({ userId: ID, roleId: "invalido" })
      .success,
    false,
  );
});

test("integracoes validam URL e referencias da Meta", () => {
  assert.equal(
    vistaIntegrationInputSchema.safeParse({
      api_url: "nao-e-url",
      api_key: "segredo",
    }).success,
    false,
  );
  assert.equal(
    metaFormConfigInputSchema.safeParse({
      integrationId: ID,
      formId: "form-123",
      propertyId: "invalido",
    }).success,
    false,
  );
  assert.equal(
    metaFormConfigInputSchema.safeParse({
      integrationId: ID,
      formId: "form-123",
      defaultValues: {},
      fieldMapping: {},
    }).success,
    true,
  );
  assert.equal(
    sendMetaMessageInputSchema.safeParse({
      text: "Olá",
    }).success,
    false,
  );
  assert.equal(
    sendMetaMessageInputSchema.safeParse({
      text: "Olá",
      idempotencyKey: "nao-e-uuid",
    }).success,
    false,
  );
  assert.equal(
    sendMetaMessageInputSchema.safeParse({
      text: "Olá",
      idempotencyKey: ID,
    }).success,
    true,
  );
});

test("suporte de CRM valida filtros, disponibilidade e distribuicao", () => {
  assert.equal(
    contactListQuerySchema.safeParse({ teamId: "invalido" }).success,
    false,
  );
  assert.equal(
    availabilityInputSchema.safeParse({
      team_member_id: ID,
      day_of_week: 7,
    }).success,
    false,
  );
  assert.equal(
    addRoundRobinMemberInputSchema.safeParse({ weight: 1 }).success,
    false,
  );
  assert.equal(
    addRoundRobinMemberInputSchema.safeParse({ userId: ID, weight: 0 }).success,
    false,
  );
  const teamId = "22222222-2222-4222-8222-222222222222";
  assert.equal(
    createRoundRobinInputSchema.safeParse({
      name: "Fila contextualizada",
      members: [{ type: "user", entityId: ID, teamId, weight: 27 }],
    }).success,
    true,
  );
  assert.equal(
    createRoundRobinInputSchema.safeParse({
      name: "Fila contextualizada",
      members: [{ type: "user", entityId: ID, teamId: "equipe-invalida" }],
    }).success,
    false,
  );
  assert.equal(
    createRoundRobinInputSchema.safeParse({
      name: "Campanha WhatsApp",
      conditions: [
        {
          type: "whatsapp_message_contains",
          values: ["quero conhecer"],
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    createRoundRobinInputSchema.safeParse({
      name: "Campanha WhatsApp",
      conditions: [
        {
          type: "whatsapp_message_contains",
          values: ["quero conhecer"],
          sessionId: ID,
        },
      ],
    }).success,
    true,
  );

  const completeWeek = Array.from({ length: 7 }, (_, day) => ({
    day_of_week: day,
    start_time: "08:00:00",
    end_time: "18:00:00",
    is_all_day: false,
    is_active: day >= 1 && day <= 5,
  }));
  assert.equal(
    bulkAvailabilityInputSchema.safeParse({ availability: [] }).success,
    false,
  );
  assert.equal(
    bulkAvailabilityInputSchema.safeParse({ availability: completeWeek })
      .success,
    true,
  );
  assert.equal(
    bulkAvailabilityInputSchema.safeParse({
      availability: completeWeek.map((entry, index) => ({
        ...entry,
        day_of_week: index === 6 ? 5 : entry.day_of_week,
      })),
    }).success,
    false,
  );
  assert.equal(
    createTeamInputSchema.safeParse({
      name: "Equipe QA",
      members: [{ userId: ID, availability: completeWeek }],
    }).success,
    true,
  );
  assert.equal(
    createTeamInputSchema.safeParse({
      name: "Equipe QA",
      members: [{ userId: ID }],
    }).success,
    false,
  );
  assert.equal(
    createTeamInputSchema.safeParse({
      name: "Equipe QA",
      members: [
        {
          userId: ID,
          availability: completeWeek.map((entry) =>
            entry.day_of_week === 1
              ? { ...entry, start_time: "18:00", end_time: "08:00" }
              : entry,
          ),
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    createTeamInputSchema.safeParse({
      name: "Equipe QA",
      members: [
        {
          userId: ID,
          availability: completeWeek.map((entry) =>
            entry.day_of_week === 1
              ? { ...entry, start_time: "08:00", end_time: "08:00" }
              : entry,
          ),
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    createTeamInputSchema.safeParse({
      name: "Equipe QA",
      members: [
        {
          userId: ID,
          availability: completeWeek.map((entry) => ({
            ...entry,
            is_active: false,
          })),
        },
      ],
    }).success,
    false,
  );
});

test("tags exigem contrato completo e cor hexadecimal canonica", () => {
  const valid = { name: "Investidor", color: "#3b82F6" };

  assert.equal(createTagInputSchema.safeParse(valid).success, true);
  assert.equal(updateTagInputSchema.safeParse(valid).success, true);

  for (const color of ["#", "#fff", "#11223344", "red", "112233"]) {
    assert.equal(
      createTagInputSchema.safeParse({ ...valid, color }).success,
      false,
    );
  }

  assert.equal(
    updateTagInputSchema.safeParse({ color: "#3b82f6" }).success,
    false,
  );
  assert.equal(
    createTagInputSchema.safeParse({ ...valid, name: "x".repeat(81) }).success,
    false,
  );
});

test("notificacao exige organizacao e canais conhecidos", () => {
  assert.equal(
    dispatchNotificationInputSchema.safeParse({
      organization_id: "invalido",
      variables: {},
      channels: ["sms"],
    }).success,
    false,
  );
  assert.equal(
    dispatchNotificationInputSchema.safeParse({
      organization_id: ID,
      variables: {},
      channels: ["system", "push"],
    }).success,
    true,
  );
});

test("lista de notificacoes valida o cursor opaco opcional", () => {
  const notification = {
    id: ID,
    user_id: ID,
    organization_id: ID,
    title: "Novo lead",
    content: null,
    type: "new_lead",
    is_read: false,
    lead_id: null,
    created_at: "2026-08-16T17:30:00Z",
  };

  assert.equal(
    apiNotificationListResponseSchema.safeParse({
      data: [notification],
      next_cursor: "cursor-opaco",
    }).success,
    true,
  );
  assert.equal(
    apiNotificationListResponseSchema.safeParse({
      data: [notification],
      next_cursor: null,
    }).success,
    true,
  );
  assert.equal(
    apiNotificationListResponseSchema.safeParse({
      data: [notification],
      next_cursor: "",
    }).success,
    false,
  );
  assert.equal(
    apiNotificationListResponseSchema.safeParse({
      data: [notification],
      next_cursor: "a".repeat(513),
    }).success,
    false,
  );
});

test("IA limita temperatura e exige mensagem real", () => {
  assert.equal(
    aiAgentConfigSchema.safeParse({
      type: "triage",
      prompt: "Atenda o lead",
      model: "gpt-5-mini",
      temperature: 2.1,
      allowedTools: [],
      handoffTargets: [],
      routingKeywords: [],
      isDefault: true,
    }).success,
    false,
  );
  assert.equal(aiRunInputSchema.safeParse({ message: "   " }).success, false);
});

test("gamificacao exige motivo ao rejeitar lancamento", () => {
  assert.equal(
    gamificationDecisionInputSchema.safeParse({ status: "rejected" }).success,
    false,
  );
  assert.equal(
    gamificationDecisionInputSchema.safeParse({
      status: "rejected",
      reason: "Duplicado",
    }).success,
    true,
  );
});

test("gamificacao usa catalogo fechado e nao aceita pontos negativos", () => {
  assert.equal(
    gamificationActionTypeSchema.safeParse("sale_closed").success,
    true,
  );
  assert.equal(
    gamificationActionTypeSchema.safeParse("evento_inventado").success,
    false,
  );
  assert.equal(
    gamificationRuleInputSchema.safeParse({ points: 0, isActive: true })
      .success,
    true,
  );
  assert.equal(
    gamificationRuleInputSchema.safeParse({ points: -1, isActive: true })
      .success,
    false,
  );
  assert.equal(
    gamificationManualEntryInputSchema.safeParse({
      actionKey: "call_made",
      quantity: 100,
      notes: "Relatorio anexado",
    }).success,
    true,
  );
  assert.equal(
    gamificationManualEntryInputSchema.safeParse({
      actionKey: "call_made",
      quantity: 101,
      notes: "",
    }).success,
    false,
  );
  assert.equal(
    gamificationMissionInputSchema.safeParse({
      title: "Desafio semanal",
      actionType: "acao_inexistente",
      targetCount: 10,
      bonusPoints: 50,
      targetScope: "organization",
    }).success,
    false,
  );
});

test("ranking da gamificacao usa intervalo meio-aberto e acoes canonicas", () => {
  assert.equal(
    gamificationRankingQuerySchema.safeParse({
      from: "2026-07-01T03:00:00.000Z",
      to: "2026-08-01T03:00:00.000Z",
      actionTypes: ["call_made", "message_sent"],
    }).success,
    true,
  );
  assert.equal(
    gamificationRankingQuerySchema.safeParse({
      from: "2026-08-01T03:00:00.000Z",
      to: "2026-07-01T03:00:00.000Z",
      actionTypes: [],
    }).success,
    false,
  );
  assert.equal(
    gamificationRankingQuerySchema.safeParse({
      actionTypes: ["acao_inventada"],
    }).success,
    false,
  );
  assert.equal(
    gamificationEventListQuerySchema.safeParse({
      limit: 100,
      cursor: "cursor-opaco",
    }).success,
    true,
  );
  assert.equal(
    gamificationEventListQuerySchema.safeParse({ limit: 101 }).success,
    false,
  );
});

test("gamificacao aceita ids temporarios apenas no contrato de regras", () => {
  assert.equal(
    apiGamificationRuleSchema.safeParse({
      id: "default-call_made",
      actionType: "call_made",
      points: 5,
      isActive: true,
      isTemp: true,
    }).success,
    true,
  );
  assert.equal(
    apiGamificationRuleSchema.safeParse({
      id: "default-evento_inventado",
      actionType: "evento_inventado",
      points: 5,
      isActive: true,
      isTemp: true,
    }).success,
    false,
  );
});

test("admin e dashboard rejeitam referencias inseguras", () => {
  assert.equal(
    safePathSegmentSchema.safeParse("../organizations").success,
    false,
  );
  assert.equal(
    adminModuleAccessInputSchema.safeParse({
      organizationId: ID,
      moduleName: "crm",
      isEnabled: true,
    }).success,
    true,
  );
  assert.equal(
    dashboardFiltersSchema.safeParse({ teamId: "invalido" }).success,
    false,
  );
  assert.equal(
    dashboardFiltersSchema.safeParse({
      userId: "all",
      teamId: "",
      source: "all",
    }).success,
    true,
  );
  assert.equal(
    dashboardFiltersSchema.safeParse({ datePreset: "last30days" }).success,
    false,
  );
  assert.equal(
    dashboardFiltersSchema.safeParse({ dealStatus: "deleted" }).success,
    false,
  );
  assert.equal(dashboardLimitSchema.safeParse(50).success, true);
  assert.equal(dashboardLimitSchema.safeParse(51).success, false);
  assert.equal(
    dashboardDateRangeSchema.safeParse({
      from: new Date("2026-08-01T00:00:00Z"),
      to: new Date("2026-08-01T23:59:59Z"),
    }).success,
    true,
  );
  assert.equal(
    dashboardDateRangeSchema.safeParse({
      from: new Date("2026-08-02T00:00:00Z"),
      to: new Date("2026-08-01T00:00:00Z"),
    }).success,
    false,
  );
  assert.equal(
    dashboardDateRangeSchema.safeParse({
      from: new Date("2020-01-01T00:00:00Z"),
      to: new Date("2026-01-02T00:00:00Z"),
    }).success,
    false,
  );
});

test("dashboard valida os detalhes que a UI consome e preserva extensoes", () => {
  const stats = {
    totalLeads: 3,
    leadsInProgress: 1,
    leadsClosed: 1,
    leadsLost: 1,
    openLeads: 1,
    lostLeads: 1,
    conversionRate: 33.33,
    closedLeads: 1,
    wonAverageConversionDays: 4,
    wonConversionBuckets: [
      {
        key: "zero_a_sete",
        label: "0 a 7 dias",
        count: 1,
        percentage: 100,
        value: 500_000,
        color: "#16a34a",
        futureBucketField: true,
      },
    ],
    wonDeals: [
      {
        id: ID,
        name: "Maria",
        phone: null,
        source: "meta",
        value: 500_000,
        createdAt: "2026-08-01T10:00:00Z",
        wonAt: "2026-08-05T10:00:00Z",
        conversionDays: 4,
        assignedUserName: "Corretor",
      },
    ],
    lostReasonBuckets: [
      {
        key: "sem_interesse",
        label: "Sem interesse",
        count: 1,
        percentage: 100,
        color: "#8b5cf6",
      },
    ],
    lostDeals: [
      {
        id: ID,
        name: "Joao",
        phone: null,
        source: null,
        lostReason: "Sem interesse",
        lostReasonGroup: "Sem interesse",
        createdAt: "2026-08-01T10:00:00-03:00",
        lostAt: null,
        assignedUserName: "Corretor",
      },
    ],
    avgResponseTime: "5m",
    totalSalesValue: 500_000,
    pendingCommissions: 0,
    leadsTrend: 10,
    openTrend: -5,
    lostTrend: 0,
    conversionTrend: 2,
    closedTrend: 7,
    totalReceivables: 0,
    totalPayables: 0,
    overdueReceivables: 0,
    overduePayables: 0,
    paidCommissions: 0,
    futureStatsField: "preservado",
  };

  const result = apiDashboardStatsResponseSchema.safeParse({
    data: stats,
    futureEnvelopeField: true,
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.data.futureStatsField, "preservado");
    assert.equal(
      result.data.data.wonConversionBuckets[0].futureBucketField,
      true,
    );
  }

  assert.equal(
    apiDashboardStatsResponseSchema.safeParse({
      data: { ...stats, openLeads: undefined },
    }).success,
    false,
  );
  assert.equal(
    apiDashboardStatsResponseSchema.safeParse({
      data: {
        ...stats,
        wonConversionBuckets: [
          { ...stats.wonConversionBuckets[0], percentage: 101 },
        ],
      },
    }).success,
    false,
  );
  assert.equal(
    apiDashboardStatsResponseSchema.safeParse({
      data: {
        ...stats,
        wonDeals: [{ ...stats.wonDeals[0], id: "not-a-uuid" }],
      },
    }).success,
    false,
  );
  assert.equal(
    apiDashboardStatsResponseSchema.safeParse({
      data: {
        ...stats,
        lostDeals: [{ ...stats.lostDeals[0], createdAt: "yesterday" }],
      },
    }).success,
    false,
  );
  assert.equal(
    apiDashboardStatsResponseSchema.safeParse({
      data: { ...stats, totalSalesValue: Number.NaN },
    }).success,
    false,
  );
});

test("dashboard valida corretores e liga cache, tenant e cancelamento", () => {
  assert.equal(
    apiDashboardTopBrokersResponseSchema.safeParse({
      data: {
        brokers: [
          {
            id: ID,
            name: "Corretor",
            avatar_url: null,
            closedLeads: 2,
            salesValue: 900_000,
            totalCommissions: 18_000,
          },
        ],
        isFallbackMode: false,
      },
    }).success,
    true,
  );
  assert.equal(
    apiDashboardTopBrokersResponseSchema.safeParse({
      data: {
        brokers: [{ id: ID, name: "Incompleto" }],
        isFallbackMode: false,
      },
    }).success,
    false,
  );

  assert.match(
    dashboardHookSource,
    /function useDashboardQueryScope\(\)[\s\S]*?isTenantContextForOrganization\([\s\S]*?createTenantQueryAccessSignature\(/,
  );
  assert.ok(
    [...dashboardHookSource.matchAll(/enabled: isReady/g)].length >= 8,
  );
  assert.ok(
    [...dashboardHookSource.matchAll(/accessSignature/g)].length >= 17,
  );
  assert.doesNotMatch(dashboardHookSource, /Math\.abs\(/);
  assert.match(
    dashboardHookSource,
    /Object\.prototype\.hasOwnProperty\.call\(sourceLabels, value\)/,
  );
  assert.ok(
    [...dashboardHookSource.matchAll(/queryFn: (?:async )?\(\{ signal \}\)/g)]
      .length >= 6,
  );
  assert.ok(
    [...dashboardHookSource.matchAll(/getDashboardFiltersQueryKey\(/g)]
      .length >= 5,
  );
  assert.ok(
    [...dashboardAPISource.matchAll(/signal: params\.signal/g)].length >= 9,
  );
  assert.ok(
    [...dashboardAPISource.matchAll(/parseDashboardOrganizationId\(/g)]
      .length >= 10,
  );
  assert.ok(
    [...dashboardAPISource.matchAll(/const validated = validateDomainResponse\(/g)]
      .length >= 9,
  );
  assert.ok(
    [...dashboardAPISource.matchAll(/return validated\.(?:data|leadIds)/g)]
      .length >= 9,
  );
  assert.doesNotMatch(
    dashboardAPISource,
    /validateDomainResponse\([^;]+\);\s*return response\./,
  );
  for (const key of [
    "dateFrom",
    "dateTo",
    "granularity",
    "teamId",
    "userId",
    "source",
    "campaignId",
    "adSetId",
    "adId",
    "tagId",
    "dealStatus",
    "searchQuery",
  ]) {
    assert.match(dashboardAPISource, new RegExp(`${key}:`));
  }
});

test("OpenAPI declara todos os campos sempre serializados pelo Dashboard", () => {
  const requiredBlock = dashboardOpenAPISource.match(
    /DashboardStats:\r?\n\s+type: object\r?\n\s+required:\r?\n([\s\S]*?)\s+properties:/,
  )?.[1];
  assert.ok(requiredBlock, "DashboardStats.required não foi encontrado");

  for (const field of [
    "wonAverageConversionDays",
    "pendingCommissions",
    "totalReceivables",
    "totalPayables",
    "overdueReceivables",
    "overduePayables",
    "paidCommissions",
  ]) {
    assert.match(requiredBlock, new RegExp(`^\\s*- ${field}\\s*$`, "m"));
  }
});

test("analytics aceita somente valores escalares na query", () => {
  assert.equal(
    analyticsQuerySchema.safeParse({ period: 30, source: "meta", active: true })
      .success,
    true,
  );
  assert.equal(
    analyticsQuerySchema.safeParse({ filters: { source: "meta" } }).success,
    false,
  );
});

test("auditoria exige acao e entidade consistentes", () => {
  assert.equal(
    auditLogCreateInputSchema.safeParse({ action: "", entity_type: "lead" })
      .success,
    false,
  );
  assert.equal(
    auditLogCreateInputSchema.safeParse({
      action: "lead.updated",
      entity_type: "lead",
      entity_id: ID,
    }).success,
    true,
  );
  assert.equal(
    auditLogCreateInputSchema.safeParse({
      action: "webhook.received",
      entity_type: "external",
      entity_id: "meta-lead-123",
    }).success,
    true,
  );
});

test("checkout publico exige token ou organizacao", () => {
  assert.equal(paymentCheckoutQuerySchema.safeParse({}).success, false);
  assert.equal(
    paymentCheckoutQuerySchema.safeParse({ organization_id: ID }).success,
    true,
  );
});

test("perfil temporario do checkout nunca aceita senha nem outra organizacao malformada", () => {
  const profile = {
    organization_id: ID,
    name: "Imobiliaria Vimob",
    email: "financeiro@vimob.test",
    cpf_cnpj: "12345678000190",
    phone: "+55 11 99999-9999",
    created_at: Date.now(),
  };

  assert.equal(
    checkoutBillingProfileSessionSchema.safeParse(profile).success,
    true,
  );
  assert.equal(
    checkoutBillingProfileSessionSchema.safeParse({
      ...profile,
      password: "nunca",
    }).success,
    false,
  );
  assert.equal(
    checkoutBillingProfileSessionSchema.safeParse({
      ...profile,
      organization_id: "invalida",
    }).success,
    false,
  );
});

test("rascunho do checkout preserva campos incompletos sem aceitar dados alheios", () => {
  const draft = {
    checkout_token: "a".repeat(32),
    organization_id: ID,
    name: "Andre",
    email: "andre@example.com",
    cpf_cnpj: "123",
    phone: "",
    country: "BR",
    postal_code: "",
    address: "",
    address_number: "",
    address_complement: "",
    neighborhood: "",
    city: "",
    state: "",
    updated_at: 1,
  };

  assert.equal(
    checkoutBillingDraftSessionSchema.safeParse(draft).success,
    true,
  );
  assert.equal(
    checkoutBillingDraftSessionSchema.safeParse({ ...draft, password: "nunca" })
      .success,
    false,
  );
  assert.equal(
    checkoutBillingDraftSessionSchema.safeParse({
      ...draft,
      checkout_token: "curto",
    }).success,
    false,
  );
});

test("dados de faturamento exigem endereco brasileiro completo antes do pagamento", () => {
  const details = {
    name: "Imobiliaria Vimob",
    email: "financeiro@vimob.test",
    cpf_cnpj: "04.252.011/0001-10",
    phone: "+55 11 99999-9999",
    country: "BR",
    postal_code: "01310-000",
    address: "Avenida Paulista",
    address_number: "1000",
    address_complement: "Conjunto 10",
    neighborhood: "Bela Vista",
    city: "Sao Paulo",
    state: "sp",
  };

  const parsed = checkoutBillingDetailsSchema.safeParse(details);
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.state, "SP");
  assert.equal(
    checkoutBillingDetailsSchema.safeParse({ ...details, postal_code: "1234" })
      .success,
    false,
  );
  assert.equal(
    checkoutBillingDetailsSchema.safeParse({ ...details, country: "US" })
      .success,
    false,
  );
  assert.equal(
    checkoutBillingDetailsSchema.safeParse({ ...details, address: "" }).success,
    false,
  );
  assert.equal(
    checkoutBillingDetailsSchema.safeParse({
      ...details,
      cpf_cnpj: "123.456.789-01",
    }).success,
    false,
  );
  assert.equal(
    checkoutBillingDetailsSchema.safeParse({
      ...details,
      cpf_cnpj: "11.111.111/1111-11",
    }).success,
    false,
  );
});

test("checkout de assinatura exige cartao aninhado para concluir dentro da Vimob", () => {
  const internalCheckout = {
    organization_id: ID,
    billing_type: "CREDIT_CARD",
    billing_period_months: 12,
    expected_plan_id: ID,
    expected_monthly_price: 297,
    holder_email: "financeiro@vimob.test",
    holder_cpf_cnpj: "52998224725",
    holder_name: "Titular Vimob",
    holder_phone: "+55 11 99999-9999",
    holder_postal_code: "01310-000",
    holder_address: "Avenida Paulista",
    holder_address_number: "1000",
    holder_neighborhood: "Bela Vista",
    holder_city: "Sao Paulo",
    holder_state: "SP",
    holder_country: "BR",
  };
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const validCard = {
    holder_name: "Titular Vimob",
    holder_cpf_cnpj: "529.982.247-25",
    number: "4111 1111-1111 1111",
    expiry_month: "12",
    expiry_year: String(currentYear + 1),
    ccv: "123",
  };
  const creditCardCheckout = {
    ...internalCheckout,
    idempotency_key: ID,
  };

  assert.equal(
    subscriptionChargeInputSchema.safeParse(internalCheckout).success,
    false,
  );
  const transparentCheckout = subscriptionChargeInputSchema.safeParse({
    ...creditCardCheckout,
    card: validCard,
  });
  assert.equal(transparentCheckout.success, true);
  if (transparentCheckout.success) {
    assert.equal(transparentCheckout.data.card?.number, "4111111111111111");
    assert.equal(transparentCheckout.data.card?.holder_name, "Titular Vimob");
    assert.equal(
      transparentCheckout.data.card?.holder_cpf_cnpj,
      "529.982.247-25",
    );
  }
  assert.equal(
    subscriptionChargeInputSchema.safeParse({
      ...internalCheckout,
      billing_type: "BOLETO",
    }).success,
    true,
  );
  assert.equal(
    subscriptionChargeInputSchema.safeParse({
      ...internalCheckout,
      billing_type: "DINHEIRO",
    }).success,
    false,
  );
  assert.equal(
    subscriptionChargeInputSchema.safeParse({
      ...creditCardCheckout,
      billing_period_months: 3,
    }).success,
    false,
  );
  assert.equal(
    subscriptionChargeInputSchema.safeParse({
      ...creditCardCheckout,
      card_number: "4111111111111111",
      ccv: "123",
    }).success,
    false,
  );
  for (const billingType of ["PIX", "BOLETO"] as const) {
    assert.equal(
      subscriptionChargeInputSchema.safeParse({
        ...internalCheckout,
        billing_type: billingType,
        card: validCard,
      }).success,
      false,
    );
  }
  assert.equal(
    subscriptionChargeInputSchema.safeParse({
      ...creditCardCheckout,
      card: { ...validCard, number: "4111111111111112" },
    }).success,
    false,
  );
  assert.equal(
    subscriptionChargeInputSchema.safeParse({
      ...creditCardCheckout,
      card: { ...validCard, holder_cpf_cnpj: "123.456.789-01" },
    }).success,
    false,
  );
  assert.equal(
    subscriptionChargeInputSchema.safeParse({
      ...creditCardCheckout,
      card: { ...validCard, number: "411111111111" },
    }).success,
    false,
  );
  assert.equal(
    subscriptionChargeInputSchema.safeParse({
      ...creditCardCheckout,
      card: { ...validCard, number: "4111abcd11111111" },
    }).success,
    false,
  );
  for (const expiryMonth of ["1", "00", "13"]) {
    assert.equal(
      subscriptionChargeInputSchema.safeParse({
        ...creditCardCheckout,
        card: { ...validCard, expiry_month: expiryMonth },
      }).success,
      false,
    );
  }
  assert.equal(
    subscriptionChargeInputSchema.safeParse({
      ...creditCardCheckout,
      card: { ...validCard, expiry_year: "26" },
    }).success,
    false,
  );
  assert.equal(
    subscriptionChargeInputSchema.safeParse({
      ...creditCardCheckout,
      card: { ...validCard, expiry_year: String(currentYear - 1) },
    }).success,
    false,
  );
  for (const ccv of ["12", "12345", "12a"]) {
    assert.equal(
      subscriptionChargeInputSchema.safeParse({
        ...creditCardCheckout,
        card: { ...validCard, ccv },
      }).success,
      false,
    );
  }
  assert.equal(
    subscriptionChargeInputSchema.safeParse({
      ...creditCardCheckout,
      card: { ...validCard, token: "nao-aceito" },
    }).success,
    false,
  );
  assert.equal(
    subscriptionChargeInputSchema.safeParse({
      ...creditCardCheckout,
      billing_period_months: 0,
    }).success,
    false,
  );
  assert.equal(
    subscriptionChargeInputSchema.safeParse({
      ...creditCardCheckout,
      expected_plan_id: "plano-invalido",
    }).success,
    false,
  );
  assert.equal(
    subscriptionChargeInputSchema.safeParse({
      ...creditCardCheckout,
      expected_monthly_price: 0,
    }).success,
    false,
  );
  assert.equal(
    subscriptionChargeInputSchema.safeParse({
      ...creditCardCheckout,
      idempotency_key: "nao-e-uuid",
      card: validCard,
    }).success,
    false,
  );
});

test("contrato de assinatura aceita rollout antes da API enviar o plano pendente", () => {
  const overview = apiSubscriptionOverviewSchema.parse({
    org: null,
    plan: null,
    availablePlans: [],
    history: [],
  });

  assert.equal(overview.pendingPlan, null);
  assert.equal(overview.planChange, null);
  assert.equal(overview.billingCheckoutReady, false);
});

test("historico financeiro aceita somente o caminho interno do comprovante", () => {
  const payment = {
    id: ID,
    asaas_payment_id: "pay_123",
    asaas_subscription_id: null,
    billing_intent_id: null,
    plan_id: null,
    plan_name: null,
    billing_type: "PIX",
    status: "CONFIRMED",
    value: 297,
    due_date: "2026-08-20",
    payment_date: "2026-08-20",
    bank_slip_registration_cancelled: false,
    checkout_url: null,
    sync_state: "cached",
    created_at: "2026-08-20T12:00:00Z",
    updated_at: "2026-08-20T12:00:00Z",
  };

  const parsed = apiPaymentHistoryItemSchema.parse({
    ...payment,
    receipt_path: "/comprovantes/550e8400-e29b-41d4-a716-446655440000",
  });
  assert.equal(
    parsed.receipt_path,
    "/comprovantes/550e8400-e29b-41d4-a716-446655440000",
  );
  assert.equal(
    apiPaymentHistoryItemSchema.safeParse({
      ...payment,
      receipt_path:
        "https://evil.example/comprovantes/550e8400-e29b-41d4-a716-446655440000",
    }).success,
    false,
  );
  for (const privateField of ["invoice_url", "payer_tax_id", "billing_email"]) {
    assert.equal(
      apiPaymentHistoryItemSchema.safeParse({
        ...payment,
        receipt_path: null,
        [privateField]: "nao-pode-atravessar-o-bff",
      }).success,
      false,
      `historico aceitou o campo privado ${privateField}`,
    );
  }
});

test("assinatura bloqueia checkout e troca de plano sem capability pronta", () => {
  const source = readFileSync(
    "components/features/settings/SubscriptionTab.tsx",
    "utf8",
  );
  const checkoutStart = source.indexOf("const handleOpenCheckout")
  const planStart = source.indexOf("const handleSelectPlan")
  const checkoutEnd = source.indexOf("const autoFillFromUser", checkoutStart)
  const planEnd = source.indexOf("if (loading)", planStart)

  assert.ok(checkoutStart >= 0 && checkoutEnd > checkoutStart)
  assert.ok(planStart >= 0 && planEnd > planStart)
  assert.match(
    source.slice(checkoutStart, checkoutEnd),
    /billingCheckoutReady\s*!==\s*true[\s\S]*return;/,
  )
  assert.match(
    source.slice(planStart, planEnd),
    /billingCheckoutReady\s*!==\s*true[\s\S]*return;/,
  )
  assert.match(
    source,
    /checkoutReady=\{data\?\.billingCheckoutReady === true\}/,
  )
});

test("contrato de assinatura valida uma troca gerenciada agendada", () => {
  const result = apiSubscriptionOverviewSchema.safeParse({
    org: null,
    plan: null,
    pendingPlan: null,
    planChange: {
      id: ID,
      from_plan_id: ID,
      target_plan_id: "22222222-2222-4222-8222-222222222222",
      status: "scheduled",
      billing_period_months: 6,
      amount: 1782,
      effective_on: "2026-09-05",
      requested_at: "2026-08-04T02:00:00.000Z",
      provider_updated_at: "2026-08-04T02:00:01.000Z",
    },
    availablePlans: [],
    history: [],
  });

  assert.equal(result.success, true);
  assert.equal(
    apiSubscriptionOverviewSchema.safeParse({
      ...(result.success ? result.data : {}),
      planChange: {
        ...(result.success ? result.data.planChange : {}),
        status: "applied",
      },
    }).success,
    false,
  );
});

test("sessao transporta e valida o estado financeiro da organizacao", () => {
  const response = {
    user: { id: ID, email: "corretor@vimob.test" },
    context: {
      userId: ID,
      userRole: "user",
      organizationId: ID,
      subscriptionStatus: "overdue",
      subscriptionType: "paid",
      trialEndsAt: "2026-07-30T18:00:00.000Z",
      billingGraceUntil: "2026-08-02T18:00:00.000Z",
      permissions: [],
      enabledModules: [],
      isSuperAdmin: false,
    },
    profile: {
      id: ID,
      name: "Corretor",
      email: "corretor@vimob.test",
      is_active: true,
    },
    organization: {
      id: ID,
      name: "Vimob",
    },
  };

  assert.equal(apiMeProfileResponseSchema.safeParse(response).success, true);
  assert.equal(
    apiMeProfileResponseSchema.safeParse({
      ...response,
      context: {
        ...response.context,
        billingGraceUntil: "data-invalida",
      },
    }).success,
    false,
  );
});

test("condominio valida coordenadas geograficas", () => {
  assert.equal(
    propertyCondominiumInputSchema.safeParse({ name: "Centro", latitude: 91 })
      .success,
    false,
  );
  assert.equal(
    propertyCondominiumInputSchema.safeParse({
      name: "Centro",
      latitude: -23.5,
      longitude: -46.6,
    }).success,
    true,
  );
  assert.equal(
    propertyCondominiumInputSchema.safeParse({
      name: "Centro",
      photo_url: "javascript:alert(1)",
    }).success,
    false,
  );
});

test("paginacao de proprietarios limita consulta e valida metadados", () => {
  assert.equal(
    propertyOwnerInputSchema.safeParse({ name: "Maria", email: "" }).success,
    true,
  );
  assert.equal(
    propertyOwnerInputSchema.safeParse({ name: "Maria", email: "invalido" })
      .success,
    false,
  );
  assert.equal(
    propertyOwnerPageQuerySchema.safeParse({
      limit: 50,
      search: "Maria",
      cursor: null,
    }).success,
    true,
  );
  assert.equal(
    propertyOwnerPageQuerySchema.safeParse({ limit: 101 }).success,
    false,
  );

  const owner = {
    id: ID,
    organization_id: ID,
    name: "Maria",
    is_active: true,
    created_at: "2026-08-16T12:00:00Z",
    updated_at: "2026-08-16T12:00:00Z",
  };
  assert.equal(
    apiPropertyOwnerPageResponseSchema.safeParse({
      data: [owner],
      next_cursor: "cursor-seguro",
      total_count: 563,
    }).success,
    true,
  );
  assert.equal(
    apiPropertyOwnerPageResponseSchema.safeParse({
      data: [owner],
      next_cursor: null,
      total_count: -1,
    }).success,
    false,
  );
});

test("site impede reordenacao vazia e posicao negativa", () => {
  assert.equal(siteReorderInputSchema.safeParse({ items: [] }).success, false);
  assert.equal(
    siteReorderInputSchema.safeParse({ items: [{ id: ID, position: -1 }] })
      .success,
    false,
  );
  assert.equal(
    siteReorderInputSchema.safeParse({ items: [{ id: ID, position: 0 }] })
      .success,
    true,
  );
});

test("webhook de saida exige URL valida", () => {
  assert.equal(
    webhookCreateInputSchema.safeParse({
      name: "CRM externo",
      type: "outgoing",
    }).success,
    false,
  );
  assert.equal(
    webhookCreateInputSchema.safeParse({
      name: "CRM externo",
      type: "outgoing",
      webhook_url: "https://crm.example.com/hook",
    }).success,
    true,
  );
});

test("telemetria limita status HTTP e exige mensagem", () => {
  assert.equal(
    reportErrorEventInputSchema.safeParse({ message: "Falha", httpStatus: 99 })
      .success,
    false,
  );
  assert.equal(
    reportErrorEventInputSchema.safeParse({ message: "Falha", httpStatus: 500 })
      .success,
    true,
  );
});

test("presenca separa dados da sessao das opcoes do realtime", () => {
  const input = {
    organizationId: ID,
    userId: ID,
    sessionId: "session_12345678",
    status: "online" as const,
    heartbeatMs: 60_000,
    getPayload: () => ({ status: "online" as const }),
    onError: () => undefined,
  };

  assert.equal(
    userActivitySessionMutationInputSchema.safeParse(input).success,
    false,
  );
  const parsed = userActivityPresenceSessionInputSchema.parse(input);
  assert.deepEqual(Object.keys(parsed).sort(), [
    "organizationId",
    "sessionId",
    "status",
    "userId",
  ]);
});

test("filtros de busca aceitam apenas nomes de coluna seguros", () => {
  assert.equal(
    searchFilterColumnsSchema.safeParse(["name", "lead.email"]).success,
    true,
  );
  assert.equal(
    searchFilterColumnsSchema.safeParse(["name);drop table leads"]).success,
    false,
  );
});
