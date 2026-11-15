import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ts = require("typescript");
const icon = () => React.createElement("svg");
const node = ({ children }) => React.createElement("div", null, children);
const dependencies = {
  react: React,
  "react/jsx-runtime": require("react/jsx-runtime"),
  "lucide-react": Object.fromEntries(["CircleDollarSign", "FileText", "Globe2", "KeyRound", "Plus"].map(name => [name, icon])),
  "@/components/features/marketing/marketing-ui": { EmptyNote: node, Panel: node, PANEL_SOFT: "" },
  "@/components/ui/button": { Button: node },
  "@/components/ui/skeleton": { Skeleton: node },
  "@/lib/property-display-utils": { formatPropertyDate: () => "15/11/2026" },
  "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
  "../../property-ui": { PROPERTY_SECONDARY_BUTTON_CLASS: "", PropertyChipTabs: () => null, PropertyFieldGrid: () => null, filledFields: () => [] },
  "../property-workspace-model": { HISTORY_CATEGORY_LABELS: { registration: "Cadastro" }, KEY_MOVEMENT_LABELS: {}, hasField: () => false, historyCategory: () => "registration" },
};
const compiled = ts.transpileModule(readFileSync(new URL("./HistoryTab.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const evaluated = { exports: {} };
vm.runInNewContext(compiled, { module: evaluated, exports: evaluated.exports, require: name => {
  assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
  return dependencies[name];
} });

function renderEvent(message) {
  return renderToStaticMarkup(React.createElement(evaluated.exports.HistoryTab, {
    workspace: { property: {}, recent_key_movements: [], offers: [], ownerships: [] },
    canManage: false, normalizedResourcesAvailable: false, loading: false, error: false, fetching: false,
    onRetry() {}, createdByName: null,
    events: [{ id: "synthetic-event", type: "property_updated", title: "Alteração sintética", created_at: "2026-11-15T12:00:00Z", metadata: { message } }],
  }));
}

test("histórico renderiza o título uma única vez quando message repete o título", () => {
  assert.equal(renderEvent("  Alteração sintética  ").split("Alteração sintética").length - 1, 1);
});

test("histórico preserva um detalhe que acrescenta informação ao título", () => {
  assert.match(renderEvent("Comentário interno atualizado"), /Comentário interno atualizado/);
});
