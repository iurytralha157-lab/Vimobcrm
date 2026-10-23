import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(import.meta.url);
const compiledModules = new Map();

// Compile the real TSX and its local dependencies in memory. This renders only
// stateless previews; no Auth provider, API, database or browser is involved.
function loadPreviewSource(relativePath) {
  const absolutePath = resolve(repositoryRoot, relativePath);
  if (compiledModules.has(absolutePath)) return compiledModules.get(absolutePath).exports;
  const compiledModule = { exports: {} };
  compiledModules.set(absolutePath, compiledModule);
  const compiled = ts.transpileModule(readFileSync(absolutePath, "utf8"), {
    fileName: absolutePath,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  function resolveImport(specifier) {
    const base = specifier.startsWith("@/")
      ? join(repositoryRoot, specifier.slice(2))
      : specifier.startsWith(".")
        ? resolve(dirname(absolutePath), specifier)
        : null;
    if (!base) return require(specifier);
    const file = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]
      .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
    if (!file) throw new Error(`Cannot resolve preview import: ${specifier}`);
    return loadPreviewSource(file);
  }
  new Function("require", "module", "exports", compiled)(resolveImport, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

const { TeamCreationPreview } = loadPreviewSource("components/features/teams/TeamCreationPreview.tsx");
const { createDefaultAvailabilityWeek } = loadPreviewSource("components/features/teams/availability-week.ts");
const { DistributionQueueCreationPreview } = loadPreviewSource("components/features/round-robin/DistributionQueueCreationPreview.tsx");
const { createEmptyDistributionQueueFormData } = loadPreviewSource("lib/round-robin/distribution-queue-form.ts");
const { DistributionQueueScheduleSection } = loadPreviewSource("components/features/round-robin/distribution-queue-editor/DistributionQueueScheduleSection.tsx");

test("team preview retains saved seconds and marks missing clocks for review", () => {
  const week = createDefaultAvailabilityWeek();
  week[1] = { ...week[1], start_time: "09:15:30", end_time: "18:45:45" };
  week[2] = { ...week[2], start_time: "", end_time: "" };
  const html = renderToStaticMarkup(React.createElement(TeamCreationPreview, { name: "Equipe sintética", members: [{ id: "user-test", name: "Membro", isLeader: false, week }] }));
  assert.ok(html.includes("09:15:30"));
  assert.ok(html.includes("18:45:45"));
  assert.ok(html.includes("Revisar horário"));
});

test("team preview displays the draft roster, leadership, inactive days and overnight shift", () => {
  const week = createDefaultAvailabilityWeek();
  week[1] = { ...week[1], start_time: "22:00", end_time: "06:00" };
  const html = renderToStaticMarkup(React.createElement(TeamCreationPreview, {
    name: "Equipe QA",
    members: [{ id: "person-qa", name: "Pessoa QA", isLeader: true, week }],
  }));
  for (const label of ["Equipe QA", "Pessoa QA", "Líder", "22:00", "06:00", "(+1 dia)", "Sem atendimento"]) {
    assert.ok(html.includes(label), label);
  }
  assert.ok(!html.includes("Online agora"), "draft schedule must not invent live presence");
});

test("queue preview keeps direct participants and team rosters distinct with theoretical weights", () => {
  const formData = createEmptyDistributionQueueFormData();
  formData.strategy = "weighted";
  formData.members = [
    { type: "user", entityId: "person-qa", name: "Pessoa QA", weight: 30 },
    { type: "team", entityId: "team-qa", name: "Equipe QA", weight: 10 },
  ];
  const html = renderToStaticMarkup(React.createElement(DistributionQueueCreationPreview, {
    formData,
    pipelineName: "Pipeline QA",
    stageName: "Entrada QA",
    criteria: [{ id: "criterion-qa", label: "Origem", values: ["Site"] }],
    tagNames: ["Interesse QA"],
    teamMembersById: { "team-qa": ["Pessoa da equipe QA"] },
  }));
  for (const label of ["Pipeline QA", "Entrada QA", "Origem", "Site", "Interesse QA", "Pessoa QA", "Equipe QA", "Pessoa da equipe QA", "75%", "25%", "Participação direta", "Conforme membros e escala da equipe", "O próximo responsável é definido"]) {
    assert.ok(html.includes(label), label);
  }
  assert.ok(!html.includes("Resposta no WhatsApp"));
});

test("queue schedule preserves legacy opt-in and the preview states closed collection without inventing hours", () => {
  const legacy = renderToStaticMarkup(React.createElement(DistributionQueueScheduleSection, { isLegacy: true, onChange() {}, onPoolNotificationsChange() {} }));
  assert.ok(legacy.includes('Definir horário da fila'));
  assert.ok(legacy.includes('funcionamento anterior'));
  const formData = createEmptyDistributionQueueFormData();
  formData.settings.operating_schedule.timezone = 'America/Sao_Paulo';
  formData.settings.operating_schedule.days[1] = { day_of_week: 1, is_active: true, is_all_day: false, start_time: '22:00', end_time: '06:00' };
  const html = renderToStaticMarkup(React.createElement(DistributionQueueCreationPreview, { formData, criteria: [], tagNames: [] }));
  for (const label of ['America/Sao_Paulo', '22:00', '06:00', 'do dia seguinte', 'bolsão da fila']) assert.ok(html.includes(label), label);
  assert.ok(!html.includes('08:00'));
});

test("WhatsApp reply preview requires its campaign condition and enabled setting", () => {
  const formData = createEmptyDistributionQueueFormData();
  const props = { formData, criteria: [], tagNames: [] };
  formData.settings.whatsapp_distribution_auto_reply_enabled = true;
  formData.settings.whatsapp_distribution_auto_reply_message = "Mensagem QA";
  let html = renderToStaticMarkup(React.createElement(DistributionQueueCreationPreview, props));
  assert.ok(!html.includes("Resposta no WhatsApp"));
  formData.conditions = [{ id: "whatsapp-qa", type: "whatsapp_message_contains", values: ["QA"], sessionId: "session-qa" }];
  html = renderToStaticMarkup(React.createElement(DistributionQueueCreationPreview, props));
  assert.ok(html.includes("Resposta no WhatsApp") && html.includes("Mensagem QA"));
  formData.settings.whatsapp_distribution_auto_reply_enabled = false;
  html = renderToStaticMarkup(React.createElement(DistributionQueueCreationPreview, props));
  assert.ok(!html.includes("Resposta no WhatsApp"));
});
