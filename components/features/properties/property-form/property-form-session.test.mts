import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { capturePropertyFormAction } from "@/components/features/properties/property-form/property-form-session";
import { PropertyFormSubmission } from "@/lib/properties/property-form-submission";
import { propertyUpdateInputSchema } from "@/lib/validation/properties";
import { initialFormData, buildPropertyMutationInput } from "@/components/features/properties/property-form/property-form-model";

// Execute the actual submit handler with inert API boundaries. No React app,
// browser session, network or server is started by this regression harness.
function editSubmitFixture(changeSessionInPreflight: boolean) {
  const source = readFileSync(new URL("../PropertyFormScreen.tsx", import.meta.url), "utf8");
  const start = source.indexOf("  const handleSubmit = async");
  const end = source.indexOf("  const handleReloadAfterConflict", start);
  assert.ok(start >= 0 && end > start);
  const handler = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  let session = "session-a";
  const calls = { preflight: [] as (string | null)[], patches: [] as (string | null)[], reads: [] as (string | null)[], publications: [] as (string | null)[] };
  const noOp = () => {};
  const property = { id: "property-a", organization_id: "organization-a", updated_at: "2026-10-13T12:00:00Z" };
  const env = {
    isFormScopeCurrent: () => true,
    formScope: { actorId: "actor-a", organizationId: "organization-a" },
    capturePropertyFormAction, getVimobAPIAccessTokenSessionId: () => session,
    isRecoveringEditDraft: false, isCepLoading: false, isPreparingPhotos: false,
    submission: { current: new PropertyFormSubmission() }, setIsSaving: noOp,
    createdPropertyForMediaRetryRef: { current: null }, isEditing: true,
    setHasTriedSubmit: noOp, creationRecoveryError: null, pendingCreation: null, validationIssues: [],
    buildPropertyMutationInput,
    formData: { ...initialFormData, title: "Casa sintética", tipo_de_imovel: "Casa" },
    catalogLocationIdForMutation: () => "", cities: [], neighborhoods: [],
    canAssignProperty: true, canManagePropertyCatalogs: true, canEditOwnerDetails: true,
    propertyId: property.id, property, activeOrganizationId: property.organization_id,
    hydratedPropertyUpdatedAtRef: { current: property.updated_at }, hydratedPropertySnapshotRef: { current: property },
    propertyUpdateInputSchema,
    captureAutomaticSitePublicationAction: async (_organization: string, _property: string, _api: unknown, options: { expectedSessionId: string | null; canContinue: () => boolean }) => {
      calls.preflight.push(options.expectedSessionId);
      assert.equal(options.canContinue(), true);
      if (changeSessionInPreflight) session = "session-b";
      await Promise.resolve();
      return { publicationId: null, publicationUpdatedAt: null };
    },
    updateProperty: { mutateAsync: async (input: { requestIntent: { expectedSessionId: string | null; onRequestStart: () => void } }) => {
      input.requestIntent.onRequestStart();
      calls.patches.push(input.requestIntent.expectedSessionId);
      return property;
    } },
    propertiesAPI: { getProperty: async (_property: string, _organization: string, intent: { expectedSessionId: string | null; onRequestStart: () => void }) => {
      intent.onRequestStart(); calls.reads.push(intent.expectedSessionId); return { data: property };
    } },
    readBackPropertyLocation: async (_data: unknown, read: () => Promise<typeof property>) => ({ savedProperty: await read(), matches: true }),
    markPropertyFormPristine: noOp, setHasConcurrencyConflict: noOp, clearDraft: noOp, draftKey: "draft-key",
    confirmSavedPropertyPublication: async (_organization: string, _property: string, _publication: unknown, action: ReturnType<typeof capturePropertyFormAction>) => {
      action.assertCurrent(); calls.publications.push(action.expectedSessionId);
    },
    isPropertyWorkspaceConflict: () => false, getErrorMessage: () => "synthetic error",
    toast: { error: noOp, info: noOp }, setSchemaValidationIssues: noOp, focusValidationIssue: noOp,
  };
  const submit = new Function(...Object.keys(env), `${handler}\nreturn handleSubmit;`)(...Object.values(env)) as (event: { preventDefault: () => void }) => Promise<void>;
  return { submit: () => submit({ preventDefault: noOp }), calls };
}

test("sessão é fixada antes do preflight e troca do mesmo ator impede continuação", async () => {
  let session: string | null = "session-a";
  const action = capturePropertyFormAction(() => true, () => session);
  const dispatched: string[] = [];
  await Promise.resolve().then(() => { session = "session-b"; });
  if (action.isCurrent()) dispatched.push(action.expectedSessionId!);
  assert.deepEqual(dispatched, []);
  assert.equal(action.expectedSessionId, "session-a");
  assert.throws(action.assertCurrent, (error: unknown) => error instanceof Error && "code" in error && error.code === "property_action_scope_changed");
});

test("refresh de JWT na mesma sessão permite prosseguir", async () => {
  let session = "same-session";
  const action = capturePropertyFormAction(() => true, () => session);
  await Promise.resolve().then(() => { session = "same-session"; });
  assert.equal(action.isCurrent(), true);
  assert.doesNotThrow(action.assertCurrent);
});

test("novo clique de recuperação captura a sessão nova sem alterar o clique antigo", () => {
  let session = "session-a";
  const previous = capturePropertyFormAction(() => true, () => session);
  session = "session-b";
  const retry = capturePropertyFormAction(() => true, () => session);
  assert.equal(previous.isCurrent(), false);
  assert.equal(retry.isCurrent(), true);
  assert.equal(retry.expectedSessionId, "session-b");
});

test("troca de escopo ou sessão ausente recusa envio mesmo com sessão antes válida", () => {
  let scopeCurrent = true;
  const action = capturePropertyFormAction(() => scopeCurrent, () => "session-a");
  scopeCurrent = false;
  assert.equal(action.isCurrent(), false);
  assert.throws(action.assertCurrent);
  const missing = capturePropertyFormAction(() => true, () => null);
  assert.equal(missing.isCurrent(), false);
  assert.throws(missing.assertCurrent);
});

test("handler real não envia PATCH quando a sessão muda durante preflight", async () => {
  const fixture = editSubmitFixture(true);
  await fixture.submit();
  assert.deepEqual(fixture.calls, { preflight: ["session-a"], patches: [], reads: [], publications: [] });
});

test("handler real propaga a mesma sessão do clique ao PATCH, readback e publicação", async () => {
  const fixture = editSubmitFixture(false);
  await fixture.submit();
  assert.deepEqual(fixture.calls, {
    preflight: ["session-a"], patches: ["session-a"], reads: ["session-a"], publications: ["session-a"],
  });
});
