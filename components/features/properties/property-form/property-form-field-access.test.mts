import assert from "node:assert/strict";
import test from "node:test";

const modulePath = "./property-form-field-access.ts";
const {
  getPropertyChargeFieldAccess,
  getPropertyFinancingModeAccess,
} = await import(modulePath);

test("isenção legada bloqueia valor para editor sem acesso ao metadata", () => {
  assert.deepEqual(
    getPropertyChargeFieldAccess({
      isExempt: true,
      canManageMetadata: false,
    }),
    {
      amountDisabled: true,
      showExemptionControl: false,
      showManagedExemptionNotice: true,
    },
  );
  assert.equal(
    getPropertyChargeFieldAccess({
      isExempt: false,
      canManageMetadata: false,
    }).amountDisabled,
    false,
  );
});

test("MCMV legado permanece visível e imutável para editor sem acesso ao metadata", () => {
  assert.deepEqual(
    getPropertyFinancingModeAccess({
      financingMode: "mcmv",
      canManageMetadata: false,
    }),
    {
      selectDisabled: true,
      showMcmvOption: true,
      showManagedModeNotice: true,
    },
  );
  assert.equal(
    getPropertyFinancingModeAccess({
      financingMode: "sim",
      canManageMetadata: false,
    }).selectDisabled,
    false,
  );
  assert.equal(
    getPropertyFinancingModeAccess({
      financingMode: "mcmv",
      canManageMetadata: true,
    }).selectDisabled,
    false,
  );
});
