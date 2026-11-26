import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../../components/features/integrations/MetaIntegrationSettings.tsx", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../../lib/api/integrations/meta.ts", import.meta.url),
  "utf8",
);
const editorSource = readFileSync(
  new URL("../../components/features/integrations/MetaFormConfigDialog.tsx", import.meta.url),
  "utf8",
);

function section(start, end, text = source) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Meta connect section ${start} is missing`);
  return text.slice(from, to);
}

function runProduction(body, references, result) {
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return Function(...Object.keys(references), js + "\nreturn " + result)(...Object.values(references));
}

test("the Page confirmation wizard opens only for a usable OAuth flow", () => {
  const callback = section("const handleOAuthStatusResult = useCallback", "useEffect(() => {",);
  assert.match(callback, /canUseMetaOAuthFlow\(flow, organizationId\)\s*&&\s*openOAuthWizard\(/);
  assert.match(callback, /showOAuthAuthorizationUnavailable\(\);[\s\S]*Autorize a conta novamente/);

  const connect = section("const connectAndLoadPage = async", "const handleSelectPage = async");
  const expiryCheck = connect.indexOf("Date.parse(oauthFlowExpiresAt) <= Date.now()");
  const post = connect.indexOf("connectPage.mutateAsync(");
  assert.ok(expiryCheck >= 0 && post > expiryCheck, "expired authorizations must be rejected before POST");
  assert.match(connect, /connectPage\.mutateAsync\(\{\s*pageId: page\.id,\s*flowId: selectedAccount\.flowId,\s*\}\)/);
});

test("a failed Page POST cannot claim success or open forms from an old connected row", () => {
  const connect = section("const connectAndLoadPage = async", "const handleSelectPage = async");
  const errorBranch = connect.indexOf("if (connectError) {");
  const successBranch = connect.indexOf("if (!integration) {", errorBranch);
  const errorBody = connect.slice(errorBranch, successBranch);
  assert.ok(errorBranch >= 0 && successBranch > errorBranch);
  assert.match(errorBody, /return;\s*}/);
  assert.doesNotMatch(errorBody, /retainPendingOAuthPages\(|loadFormsForIntegration\(/);
  assert.ok(connect.indexOf("retainPendingOAuthPages(") > successBranch);
  assert.ok(connect.indexOf("await loadFormsForIntegration(integration)") > successBranch);
});

test("Page confirmation has enough time for the backend's provider and Vault work", () => {
  const timeout = apiSource.match(/const META_OAUTH_CONNECT_TIMEOUT_MS = ([\d_]+);/);
  assert.ok(timeout, "Meta Page POST needs its own explicit timeout");
  assert.ok(Number(timeout[1].replaceAll("_", "")) > 45_000, "Page POST must outlive the 45-second backend budget");
  assert.match(apiSource, /body\.action === 'connect_page' \? \{ timeoutMs: META_OAUTH_CONNECT_TIMEOUT_MS \}/);
});

test("a saved form hydrates only its owning Page and a closed or replaced editor ignores older results", async () => {
  const owner = { id: "integration-1", organization_id: "tenant", page_id: "page-1", is_connected: true };
  const selectedIntegration = { ...owner, id: "integration-2", page_id: "page-2" };
  const integrationById = new Map([[owner.id, owner], [selectedIntegration.id, selectedIntegration]]);
  const editorRequestSequenceRef = { current: 0 };
  const requests = [], errors = [];
  let editing = null;
  const { openConfig, closeConfigDialog } = runProduction(
    section("const openConfig =", "const filteredConfiguredForms"),
    {
      organizationId: "tenant", selectedIntegration, integrationById, editorRequestSequenceRef,
      setEditing: value => { editing = typeof value === "function" ? value(editing) : value; },
      toast: { error: error => errors.push(error) },
      fetchForms: { mutateAsync: ({ pageId }) => new Promise(resolve => requests.push({ pageId, resolve })) },
      refetchConfigs: () => {},
    },
    "{ openConfig, closeConfigDialog }",
  );
  const form = { id: "form-1", name: "Formulário", status: "ACTIVE" };
  const config = { integration_id: owner.id, organization_id: "tenant", form_id: form.id };
  const question = { key: "custom_question", label: "Pergunta da Meta", type: "text" };

  assert.deepEqual(requests, []);
  openConfig(form);
  openConfig({ ...form, questions: [question] }, config);
  assert.deepEqual(requests, []);
  openConfig(form, { ...config, organization_id: "another-tenant" });
  assert.deepEqual(requests, []);
  assert.equal(errors.length, 1);

  openConfig(form, config, selectedIntegration);
  assert.equal(requests[0].pageId, owner.page_id);
  assert.equal(editing.questionLookup.status, "loading");
  openConfig(form, config);
  requests[0].resolve({ forms: [{ ...form, questions: [{ ...question, label: "Resultado antigo" }] }] });
  await Promise.resolve();
  assert.equal(editing.questionLookup.status, "loading");

  requests[1].resolve({ forms: [{ ...form, id: "form-2", questions: [{ ...question, label: "Outra ficha" }] }, { ...form, questions: [question] }] });
  await Promise.resolve();
  assert.equal(editing.form, form, "questions must arrive separately from the original editable form");
  assert.deepEqual(editing.questionLookup, { status: "loaded", questions: [question] });

  openConfig(form, config);
  closeConfigDialog(false);
  requests[2].resolve({ forms: [{ ...form, questions: [question] }] });
  await Promise.resolve();
  assert.equal(editing, null);
});

test("the editor counts only displayed mappings and keeps saved fields unavailable at Meta", () => {
  const mapping = {
    full_name: "name", email: "email", phone_number: "phone", message: "message",
    qual_e_seu_nome: "name", custom_question: "custom", ignorado: "_ignore",
  };
  const config = { field_mapping: mapping, custom_fields_config: ["custom_question"] };
  const model = section("const FALLBACK_META_FIELDS =", "const PURPOSE_OPTIONS =", editorSource)
    + section("const formQuestions = getEditorQuestions(", "const updateFieldMapping", editorSource);
  const render = (questionLookup, fieldMapping = mapping) => runProduction(model, {
    form: {}, config, fieldMapping, questionLookup,
  }, "{ formQuestions, mappedCount }");

  const fallback = render({ status: "unavailable" });
  assert.equal(fallback.formQuestions.length, 7);
  assert.equal(fallback.mappedCount, 6);
  assert.ok(fallback.formQuestions.some(({ key }) => key === "qual_e_seu_nome"));

  const loaded = render({ status: "loaded", questions: [
    { key: "full_name", label: "Nome completo da Meta", type: "FULL_NAME" },
    { key: "custom_question", label: "Qual sua preferência?", type: "CUSTOM" },
  ] }, { ...mapping, hidden_unsaved_key: "name" });
  assert.equal(loaded.formQuestions.length, 7);
  assert.equal(loaded.mappedCount, 6);
  assert.equal(loaded.formQuestions[0].label, "Nome completo da Meta");
  assert.equal(loaded.formQuestions[1].label, "Qual sua preferência?");
  assert.equal(mapping.qual_e_seu_nome, "name");
});
