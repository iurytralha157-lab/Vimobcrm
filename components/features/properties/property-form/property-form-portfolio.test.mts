import assert from "node:assert/strict";
import test from "node:test";

const modulePath = "./property-form-portfolio.ts";
const {
  buildPropertyFormProgress,
  buildPropertyPortfolioInput,
  dealForPortfolioType,
  getPortfolioLocks,
  getPortfolioValidationIssues,
  portfolioTypeForDeal,
  propertyPortfolioToFormFields,
} = await import(modulePath);

const base = {
  tipo_de_negocio: "Venda",
  portfolio_type: "ready",
  third_party_kind: "",
  partner_name: "",
  partner_contact: "",
  commission_split_percent: "",
  third_party_authorized_until: "",
};
const manager = { canManage: true, canEditOwnerDetails: true };

test("the form can never send a pair the API refuses", () => {
  assert.equal(portfolioTypeForDeal("ready", "Lançamento"), "launch");
  assert.equal(portfolioTypeForDeal("launch", "Venda"), "ready");
  assert.equal(portfolioTypeForDeal("third_party", "Lançamento"), "third_party");
  assert.equal(dealForPortfolioType("launch", "Venda"), "Lançamento");
  assert.equal(dealForPortfolioType("ready", "Lançamento"), "Venda");
  assert.equal(dealForPortfolioType("ready", "Aluguel"), null);
  assert.equal(dealForPortfolioType("third_party", "Lançamento"), null);
  // A stale draft with an inconsistent pair is corrected on the way out.
  const stale = buildPropertyPortfolioInput({ ...base, tipo_de_negocio: "Lançamento" }, manager);
  assert.deepEqual(stale, { portfolio_type: "launch" });
});

test("non third-party properties send no third-party fields", () => {
  assert.deepEqual(buildPropertyPortfolioInput({ ...base, partner_name: "Sobra" }, manager), { portfolio_type: "ready" });
});

test("a private owner sends no partner data", () => {
  const input = buildPropertyPortfolioInput({ ...base, portfolio_type: "third_party", third_party_kind: "private_owner", partner_name: "Sobra", partner_contact: "x" }, manager);
  assert.equal(input.third_party_kind, "private_owner");
  assert.equal("partner_name" in input, false);
  assert.equal("partner_contact" in input, false);
});

test("partner contact and manager fields stay out when the viewer may not change them", () => {
  const form = { ...base, portfolio_type: "third_party", third_party_kind: "partner", partner_name: "Imob Lago", partner_contact: "61 9", commission_split_percent: "40,5", third_party_authorized_until: "2027-01-31" };
  assert.deepEqual(buildPropertyPortfolioInput(form, manager), {
    portfolio_type: "third_party",
    third_party_kind: "partner",
    partner_name: "Imob Lago",
    partner_contact: "61 9",
    commission_split_percent: 40.5,
    third_party_authorized_until: "2027-01-31",
  });
  assert.deepEqual(buildPropertyPortfolioInput(form, { canManage: false, canEditOwnerDetails: false }), {
    portfolio_type: "third_party",
    third_party_kind: "partner",
    partner_name: "Imob Lago",
  });
});

test("validation points at the field the API would otherwise reject", () => {
  const ids = (form: object) => getPortfolioValidationIssues({ ...base, ...form }).map((issue: { fieldId: string }) => issue.fieldId);
  assert.deepEqual(ids({}), []);
  assert.deepEqual(ids({ portfolio_type: "third_party" }), ["property-third-party-kind"]);
  assert.deepEqual(ids({ portfolio_type: "third_party", third_party_kind: "partner" }), ["property-partner-name"]);
  assert.deepEqual(ids({ portfolio_type: "third_party", third_party_kind: "private_owner", commission_split_percent: "120" }), ["property-commission-split"]);
});

test("a non-numeric split is reported instead of reaching the API", () => {
  const ids = getPortfolioValidationIssues({ ...base, portfolio_type: "third_party", third_party_kind: "private_owner", commission_split_percent: "abc" }).map((issue: { fieldId: string }) => issue.fieldId);
  assert.deepEqual(ids, ["property-commission-split"]);
});

test("reclassifying is locked only for who the API would refuse", () => {
  const partner = { storedType: "third_party", storedKind: "partner" };
  assert.deepEqual(getPortfolioLocks({ ...partner, canManage: true, canEditOwnerDetails: true }), { typeLockReason: null, kindLockReason: null });
  assert.ok(getPortfolioLocks({ ...partner, canManage: false, canEditOwnerDetails: true }).typeLockReason);
  assert.equal(getPortfolioLocks({ ...partner, canManage: false, canEditOwnerDetails: true }).kindLockReason, null);
  const noContact = getPortfolioLocks({ ...partner, canManage: true, canEditOwnerDetails: false });
  assert.ok(noContact.typeLockReason && noContact.kindLockReason);
  assert.deepEqual(getPortfolioLocks({ storedType: "ready", canManage: false, canEditOwnerDetails: false }), { typeLockReason: null, kindLockReason: null });
  assert.equal(getPortfolioLocks({ storedType: "third_party", storedKind: "private_owner", canManage: true, canEditOwnerDetails: false }).typeLockReason, null);
});

test("hydration fills in stored values and repairs a stale classification", () => {
  assert.equal(propertyPortfolioToFormFields({ tipo_de_negocio: "Lançamento" }).portfolio_type, "launch");
  const fields = propertyPortfolioToFormFields({ tipo_de_negocio: "Venda", portfolio_type: "third_party", third_party_kind: "partner", partner_name: "Imob", commission_split_percent: 50 });
  assert.equal(fields.third_party_kind, "partner");
  assert.equal(fields.commission_split_percent, "50");
  assert.equal(fields.partner_contact, "");
});

test("the checklist follows the validation issues", () => {
  const items = buildPropertyFormProgress({ bairro: "Noroeste", cidade: "Brasília" }, [{ tab: "media" }]);
  assert.equal(items.find((item: { label: string }) => item.label === "Ao menos uma foto").done, false);
  assert.equal(items.find((item: { label: string }) => item.label === "Endereço").done, true);
});
