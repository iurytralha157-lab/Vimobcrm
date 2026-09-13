import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const modelPath = "./model.ts";
const {
  formatGuideText,
  normalizeStepId,
  TOUR_PLANS,
  VALID_STEP_IDS,
} = (await import(modelPath)) as typeof import("./model");

const EXPECTED_PLAN_SUMMARY = {
  dashboard: { route: "/dashboard", path: "/dashboard", items: 14 },
  first_lead: {
    route: "/crm/contacts?new=lead",
    path: "/crm/contacts",
    items: 6,
  },
  first_property: {
    route: "/properties/new",
    path: "/properties/new",
    items: 11,
  },
  pipeline: { route: "/crm/pipelines", path: "/crm/pipelines", items: 16 },
  contacts: { route: "/crm/contacts", path: "/crm/contacts", items: 9 },
  conversations: {
    route: "/crm/conversas",
    path: "/crm/conversas",
    items: 9,
  },
  agenda: { route: "/agenda", path: "/agenda", items: 14 },
  profile: { route: "/settings?tab=account", path: "/settings", items: 8 },
  whatsapp: {
    route: "/settings?tab=integrations",
    path: "/settings",
    items: 9,
  },
  team: { route: "/settings?tab=team", path: "/settings", items: 6 },
  teams: {
    route: "/crm/management?tab=teams",
    path: "/crm/management",
    items: 5,
  },
  distribution: {
    route: "/crm/management?tab=distribution",
    path: "/crm/management",
    items: 7,
  },
  integrations_meta: {
    route: "/settings?tab=integrations",
    path: "/settings",
    items: 1,
  },
  properties: { route: "/properties", path: "/properties", items: 12 },
  automations: { route: "/automations", path: "/automations", items: 3 },
  gamification: { route: "/gamificacao", path: "/gamificacao", items: 4 },
  financial: { route: "/financeiro", path: "/financeiro", items: 3 },
  ai: { route: "/settings?tab=ai", path: "/settings", items: 6 },
  site: { route: "/settings/site", path: "/settings/site", items: 11 },
};

test("normaliza somente IDs de etapas conhecidos", () => {
  for (const stepId of VALID_STEP_IDS) {
    assert.equal(normalizeStepId(stepId), stepId);
  }

  assert.equal(normalizeStepId("unknown"), null);
  assert.equal(normalizeStepId(""), null);
  assert.equal(normalizeStepId(null), null);
  assert.equal(normalizeStepId(1), null);
});

test("mantém rotas, caminhos e quantidade de pontos de cada plano", () => {
  const summary = Object.fromEntries(
    VALID_STEP_IDS.map((stepId) => {
      const plan = TOUR_PLANS[stepId];
      return [
        stepId,
        {
          route: plan?.route,
          path: plan?.path,
          items: plan?.items.length,
        },
      ];
    }),
  );

  assert.deepEqual(summary, EXPECTED_PLAN_SUMMARY);
  assert.deepEqual(Object.keys(TOUR_PLANS), VALID_STEP_IDS);
});

test("mantém íntegro o contrato de textos, seletores e ações do tour", () => {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(TOUR_PLANS))
    .digest("hex");

  assert.equal(
    fingerprint,
    "368cd2609e81b13c588a1798bbc02722e49c61cead2f18e3f56f734e85df4bde",
  );
});

test("todos os alvos e ações mantêm seletores utilizáveis", () => {
  const selectorsAreValid = (value: string | string[]) =>
    (Array.isArray(value) ? value : [value]).every(
      (selector) => selector.trim().length > 0,
    );

  for (const stepId of VALID_STEP_IDS) {
    const plan = TOUR_PLANS[stepId];
    assert.ok(plan);

    for (const item of plan.items) {
      assert.ok(selectorsAreValid(item.selector));
      assert.ok(item.title.length > 0);
      assert.ok(item.body.length > 0);

      if (!item.action) continue;
      if (item.action.type === "click") {
        assert.ok(selectorsAreValid(item.action.selector));
      }
      if (item.action.waitFor) {
        assert.ok(selectorsAreValid(item.action.waitFor));
      }
    }
  }
});

test("formata o texto exibido com o mesmo mapa de acentos", () => {
  assert.equal(
    formatGuideText("Configuracao, acoes e permissoes do usuario"),
    "Configuração, ações e permissões do usuário",
  );
  assert.equal(formatGuideText("ACOES"), "Ações");
});
