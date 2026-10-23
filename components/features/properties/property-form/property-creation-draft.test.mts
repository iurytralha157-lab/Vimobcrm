import assert from "node:assert/strict";
import test from "node:test";
import { initialFormData, getPropertyValidationIssues } from "@/components/features/properties/property-form/property-form-model";
import { createPropertyCreationDraftStore, getPropertyCreationDraftStorage } from "@/components/features/properties/property-form/property-creation-draft";

const drafts = createPropertyCreationDraftStore(initialFormData);
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test("rascunho legado parcial recebe campos novos e conserva os tipos válidos", () => {
  const storage = memoryStorage();
  storage.setItem("draft", JSON.stringify({ title: "Casa", cep: "01001-000", autorizado_comercializacao: false, obsolete_field: "old" }));
  const result = drafts.read("draft", storage);
  assert.equal(result.warning, null);
  assert.equal(result.draft?.title, "Casa");
  assert.equal(result.draft?.autorizado_comercializacao, false);
  assert.equal(result.draft?.owner_name, initialFormData.owner_name);
  assert.equal(result.draft?.financing_mode, initialFormData.financing_mode);
  assert.equal(result.draft && "obsolete_field" in result.draft, false);
  assert.doesNotThrow(() => getPropertyValidationIssues(result.draft!));
});

test("JSON inválido ou tipo incorreto nunca alcança a renderização nem apaga a intenção", () => {
  const storage = memoryStorage();
  storage.setItem("draft:creation-intent", "immutable-unknown-request");
  for (const raw of ["{broken", "null", "[]", '{"title":42}', '{"autorizado_comercializacao":"false"}', '{"fotos":[42]}']) {
    storage.setItem("draft", raw);
    const result = drafts.read("draft", storage);
    assert.equal(result.draft, null);
    assert.ok(result.warning);
    assert.equal(storage.getItem("draft"), raw);
    assert.equal(storage.getItem("draft:creation-intent"), "immutable-unknown-request");
  }
});

test("armazenamento indisponível ou negado retorna aviso sem impedir renderizar", () => {
  assert.equal(drafts.read("draft", null).draft, null);
  const storage = memoryStorage();
  const denied = { ...storage, getItem: () => { throw new DOMException("blocked", "SecurityError"); } };
  assert.doesNotThrow(() => drafts.read("draft", denied));
  assert.ok(drafts.read("draft", denied).warning);
});

test("getter do navegador suporta SecurityError ao acessar localStorage", (context) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: Object.defineProperty({}, "localStorage", {
    get: () => { throw new DOMException("blocked", "SecurityError"); },
  }) });
  context.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  });
  assert.equal(getPropertyCreationDraftStorage(), null);
});

test("quota de autosave e erro de remoção não escapam e conservam o recibo pendente", () => {
  const storage = memoryStorage();
  storage.setItem("draft:created-property", "confirmed-receipt");
  const quota = { ...storage, setItem: () => { throw new DOMException("full", "QuotaExceededError"); } };
  assert.equal(drafts.save("draft", initialFormData, quota), false);
  const denied = { ...storage, removeItem: () => { throw new DOMException("blocked", "SecurityError"); } };
  assert.equal(drafts.clear("draft", denied), false);
  assert.equal(storage.getItem("draft:created-property"), "confirmed-receipt");
});

test("rascunho conserva o contrato de retirar seleção de mídias sem confirmação do servidor", () => {
  const storage = memoryStorage();
  assert.equal(drafts.save("draft", { ...initialFormData,
    imagem_principal: "blob:temporary", fotos: ["blob:temporary", "https://example.test/photo.jpg"],
  }, storage), true);
  const result = drafts.read("draft", storage);
  assert.deepEqual(result.draft?.fotos, []);
  assert.equal(result.draft?.imagem_principal, "");
  assert.deepEqual(result.draft?.hidden_site_image_urls, []);
});
