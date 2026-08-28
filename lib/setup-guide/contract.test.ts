import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const hookSource = readFileSync("hooks/use-setup-guide.ts", "utf8");
const tourSource = readFileSync("components/features/setup-guide/SetupGuideTour.tsx", "utf8");

function uniqueSorted(values: Iterable<string>) {
  return [...new Set(values)].sort();
}

function readSourceTree(root: string): string {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return [readSourceTree(path)];
      if (!/\.(?:ts|tsx)$/.test(entry.name) || path.endsWith("SetupGuideTour.tsx")) return [];
      return [readFileSync(path, "utf8")];
    })
    .join("\n");
}

test("cada etapa visível do guia possui um plano de tour na mesma rota", () => {
  const hookSteps = [...hookSource.matchAll(/\n\s{8}id: '([a-z_]+)',[\s\S]*?\n\s{8}route: '([^']+)'/g)]
    .map((match) => ({ id: match[1], route: match[2] }));
  const plansBlock = tourSource.match(
    /const TOUR_PLANS:[\s\S]*?= \{([\s\S]*?)\n\};\n\nfunction normalizeStepId/,
  )?.[1];

  assert.ok(plansBlock, "O bloco de planos do tour deve continuar identificável");
  const plans = [...plansBlock.matchAll(/^  ([a-z_]+): \{\n    route: "([^"]+)",\n    path: "([^"]+)",/gm)]
    .map((match) => ({ id: match[1], route: match[2], path: match[3] }));

  assert.equal(hookSteps.length, 19);
  assert.deepEqual(uniqueSorted(hookSteps.map((step) => step.id)), uniqueSorted(plans.map((plan) => plan.id)));

  for (const step of hookSteps) {
    const plan = plans.find((candidate) => candidate.id === step.id);
    assert.ok(plan, `Plano ausente para ${step.id}`);
    assert.equal(plan.route, step.route, `A rota do plano ${step.id} divergiu da rota apresentada no diálogo`);
    assert.equal(
      plan.path,
      new URL(step.route, "https://crm.vimob.invalid").pathname,
      `O pathname do plano ${step.id} não corresponde à rota da etapa`,
    );
  }
});

test("o tour não dispara automaticamente controles de persistência ou exclusão", () => {
  const actionBlocks = [...tourSource.matchAll(/action: \{([\s\S]*?)\n\s{8}\},/g)]
    .map((match) => match[1]);
  const automaticClickSelectors = actionBlocks
    .filter((block) => /type: "click"/.test(block))
    .flatMap((block) => [...block.matchAll(/selector: (?:\[)?'([^']+)'/g)].map((match) => match[1]));

  assert.ok(automaticClickSelectors.length > 0);
  for (const selector of automaticClickSelectors) {
    assert.doesNotMatch(selector, /(?:save|submit|delete|disconnect|remove)/i);
  }
});

test("o plano de usuários não referencia mais o seletor removido de função personalizada", () => {
  assert.doesNotMatch(tourSource, /team-user-custom-role/);
});

test("cada alvo do tour continua montado no código ativo", () => {
  const applicationSource = `${readSourceTree("app")}\n${readSourceTree("components")}`;
  const targetIds = uniqueSorted(
    [...tourSource.matchAll(/data-tour=\\?"([^"\\]+)\\?"/g)]
      .map((match) => match[1])
      .filter((id) => !id.startsWith("setup-guide-")),
  );
  const dynamicTargets: Record<string, string> = {
    "property-tab-": "property-tab-${tab.value}",
    "site-tab-": "site-tab-${section.value}",
  };
  const exactDynamicTargets: Record<string, string> = {
    "contacts-advanced-filters": "${tourPrefix}-advanced-filters",
    "contacts-filters-panel": "${tourPrefix}-filters-panel",
  };

  assert.ok(targetIds.length > 100);
  for (const targetId of targetIds) {
    const dynamicSource = Object.entries(dynamicTargets)
      .find(([prefix]) => targetId.startsWith(prefix))?.[1];
    const exactDynamicSource = exactDynamicTargets[targetId];
    const isDynamicIntegrationDialog = targetId === "whatsapp-integration-dialog"
      && applicationSource.includes("-integration-dialog");
    assert.ok(
      applicationSource.includes(targetId)
        || (dynamicSource ? applicationSource.includes(dynamicSource) : false)
        || (exactDynamicSource ? applicationSource.includes(exactDynamicSource) : false)
        || isDynamicIntegrationDialog,
      `O alvo data-tour=\"${targetId}\" não existe mais nas superfícies ativas`,
    );
  }
});
