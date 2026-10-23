import assert from "node:assert/strict";
import test from "node:test";
import { PropertyCepRequests } from "@/lib/properties/property-cep-request";
import { PropertyFormSubmission } from "@/lib/properties/property-form-submission";
import { propertyUpdateInputSchema } from "@/lib/validation/properties";
import { propertySchemaIssuesToForm } from "@/components/features/properties/property-form/property-form-schema-issues";
import { initialFormData } from "@/components/features/properties/property-form/property-form-model";
import { selectPropertyOwner } from "@/components/features/properties/property-form/property-owner-selection";

test("mudança manual impede resposta de CEP atrasada mesmo quando o transporte resolve após abort", async () => {
  const requests = new PropertyCepRequests();
  const pending = requests.begin();
  let resolve!: (value: string) => void;
  const lookup = new Promise<string>((finish) => { resolve = finish; });
  let selectedUF = "RJ";
  const apply = lookup.then((uf) => {
    if (requests.isCurrent(pending)) selectedUF = uf;
  });
  requests.invalidate();
  resolve("SP");
  await apply;
  assert.equal(selectedUF, "RJ");
  assert.equal(pending.controller.signal.aborted, true);
});

test("uma falha antiga não encerra a reconsulta atual do mesmo CEP", () => {
  const requests = new PropertyCepRequests();
  const previous = requests.begin();
  const current = requests.begin();
  assert.equal(requests.owns(previous), false);
  requests.finish(previous);
  assert.equal(requests.isCurrent(current), true);
});

test("o guard do envio bloqueia callbacks atrasados e duplo clique até confirmação completa", () => {
  const submission = new PropertyFormSubmission();
  const first = submission.begin();
  assert.notEqual(first, null);
  assert.equal(submission.canEdit(), false);
  assert.equal(submission.begin(), null);
  submission.finish(first!);
  assert.equal(submission.canEdit(), true);
  const second = submission.begin();
  submission.finish(first!);
  assert.equal(submission.canEdit(), false);
  submission.finish(second!);
  assert.equal(submission.canEdit(), true);
});

test("proprietário B não herda contatos de A; modo manual limpa apenas os dados do proprietário", () => {
  const first = selectPropertyOwner({ ...initialFormData, title: "Casa" }, { id: "owner-a", name: "A", cellphone: "111" });
  const second = selectPropertyOwner(first, { id: "owner-b", name: "B", email: "b@example.test" });
  assert.equal(second.owner_cellphone, "");
  assert.equal(second.owner_email, "b@example.test");
  const manual = selectPropertyOwner(second, null);
  assert.equal(manual.owner_name, "");
  assert.equal(manual.owner_cellphone, "");
  assert.equal(manual.owner_email, "");
  assert.equal(manual.title, "Casa");
  assert.equal(first.owner_cellphone, "111");
});

test("suítes negativas rejeitadas pelo schema geram foco e mensagem no campo correto", () => {
  const parsed = propertyUpdateInputSchema.safeParse({
    title: "Casa", suites: -1, expected_updated_at: "2026-10-12T12:00:00Z",
  });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.deepEqual(propertySchemaIssuesToForm(parsed.error.issues), [{
    label: "Suítes", tab: "characteristics", fieldId: "property-suites",
  }]);
});
