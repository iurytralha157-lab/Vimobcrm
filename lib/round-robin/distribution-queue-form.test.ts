import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY,
  DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS,
  createEmptyDistributionQueueFormData,
  findConflictingDistributionQueueMetaForm,
  hasValidDistributionQueueCriteria,
  hydrateDistributionQueueFormData,
  normalizeDistributionQueueAutoTagIds,
  normalizeDistributionQueueConditionType,
  sanitizeDistributionQueueConditions,
} from "./distribution-queue-form";

const TAG_ID = "11111111-1111-4111-8111-111111111111";

const META_FORM = {
  config_id: "config-a",
  form_id: "form-a",
  form_name: "Formulário A",
  page_id: "page-a",
  page_name: "Página A",
  round_robin_id: null,
  is_active: true,
  integration_connected: true,
};

test("cria o mesmo rascunho padrao para novas filas", () => {
  assert.deepEqual(createEmptyDistributionQueueFormData(), {
    name: "",
    strategy: "simple",
    target_pipeline_id: "",
    target_stage_id: "",
    is_active: true,
    settings: {
      auto_tag_ids: [],
      enable_redistribution: false,
      redistribution_timeout_minutes: 20,
      redistribution_warning_minutes: 5,
      redistribution_max_attempts: 10,
      preserve_position: true,
      require_checkin: false,
      reentry_behavior: "redistribute",
      whatsapp_distribution_auto_reply_enabled: false,
      whatsapp_distribution_auto_reply_message:
        DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY,
      whatsapp_distribution_auto_reply_delay_seconds:
        DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS,
    },
    conditions: [],
    members: [],
  });
});

test("hidrata regra legada Meta e preserva contexto de WhatsApp e reentrada", () => {
  const form = hydrateDistributionQueueFormData(
    {
      id: "queue-a",
      name: "Fila A",
      strategy: "invalid",
      is_active: null,
      settings: {
        auto_tag_ids: [TAG_ID, TAG_ID, "invalido"],
        reentry_behavior: "redistribute",
        whatsapp_distribution_auto_reply_enabled: true,
        whatsapp_distribution_auto_reply_message: "Retornaremos em breve.",
        whatsapp_distribution_auto_reply_delay_seconds: 15,
      },
      reentry_behavior: "keep_assignee",
      rules: [
        { id: "rule-a", match_type: "form", match_value: "form-a" },
        {
          id: "rule-b",
          match_type: "whatsapp_message_contains",
          match_value: " oferta ",
          match: { whatsapp_session_id: " session-a " },
        },
      ],
      members: [
        {
          id: "member-a",
          team_id: "team-a",
          weight: 12,
        },
      ],
    },
    [{ id: "team-a", name: "Equipe A" }],
  );

  assert.equal(normalizeDistributionQueueConditionType("form"), "meta_form");
  assert.equal(form.strategy, "simple");
  assert.equal(form.is_active, true);
  assert.equal(form.settings.reentry_behavior, "keep_assignee");
  assert.deepEqual(form.settings.auto_tag_ids, [TAG_ID]);
  assert.equal(form.settings.whatsapp_distribution_auto_reply_enabled, true);
  assert.equal(
    form.settings.whatsapp_distribution_auto_reply_message,
    "Retornaremos em breve.",
  );
  assert.equal(
    form.settings.whatsapp_distribution_auto_reply_delay_seconds,
    15,
  );
  assert.deepEqual(form.conditions, [
    {
      id: "rule-a",
      type: "meta_form",
      values: ["form-a"],
      sessionId: undefined,
    },
    {
      id: "rule-b",
      type: "whatsapp_message_contains",
      values: ["oferta"],
      sessionId: "session-a",
    },
  ]);
  assert.deepEqual(form.members, [
    {
      id: "member-a",
      type: "team",
      entityId: "team-a",
      weight: 12,
      name: "Equipe A",
    },
  ]);
});

test("normaliza tags automáticas por UUID, unicidade e limite", () => {
  assert.deepEqual(
    normalizeDistributionQueueAutoTagIds([TAG_ID, TAG_ID.toUpperCase(), "x"]),
    [TAG_ID],
  );
});

test("considera campanha WhatsApp valida somente com mensagem e sessao", () => {
  const condition = {
    id: "condition-a",
    type: "whatsapp_message_contains" as const,
    values: ["oferta"],
  };

  assert.equal(hasValidDistributionQueueCriteria([condition]), false);
  assert.equal(
    hasValidDistributionQueueCriteria([
      { ...condition, sessionId: " session-a " },
    ]),
    true,
  );
});

test("normaliza IDs Meta, remove vazios e mantem sessao apenas em WhatsApp", () => {
  assert.deepEqual(
    sanitizeDistributionQueueConditions(
      [
        {
          id: "condition-a",
          type: "meta_form",
          values: [" config-a ", "form-a", ""],
          sessionId: "ignored",
        },
        {
          id: "condition-b",
          type: "whatsapp_message_contains",
          values: [" oferta "],
          sessionId: " session-a ",
        },
        { id: "condition-c", type: "city", values: ["  "] },
      ],
      [META_FORM],
    ),
    [
      {
        id: "condition-a",
        type: "meta_form",
        values: ["form-a"],
        sessionId: undefined,
      },
      {
        id: "condition-b",
        type: "whatsapp_message_contains",
        values: ["oferta"],
        sessionId: "session-a",
      },
    ],
  );
});

test("detecta somente formulario vinculado a outra fila", () => {
  const conditions = [
    { id: "condition-a", type: "meta_form" as const, values: ["form-a"] },
  ];

  assert.equal(
    findConflictingDistributionQueueMetaForm(
      conditions,
      [{ ...META_FORM, round_robin_id: "queue-b" }],
      "queue-a",
    )?.form_id,
    "form-a",
  );
  assert.equal(
    findConflictingDistributionQueueMetaForm(
      conditions,
      [{ ...META_FORM, round_robin_id: "queue-a" }],
      "queue-a",
    ),
    undefined,
  );
});
