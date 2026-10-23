import assert from "node:assert/strict";
import test from "node:test";

import { normalizeEvolutionLabelColor } from "./label-color.ts";

test("provider decimal color index stays an int4 for the Go/API contract", () => {
  assert.equal(normalizeEvolutionLabelColor({ color: 4 }), 4);
  assert.equal(normalizeEvolutionLabelColor({ Color: " 12 " }), 12);
  assert.equal(normalizeEvolutionLabelColor({ colorIndex: 0 }), 0);
  assert.equal(normalizeEvolutionLabelColor({ color: "invalid", colorIndex: "7" }), 7);
});

test("missing, hex, fractional and out-of-range colors become null", () => {
  assert.equal(normalizeEvolutionLabelColor({}), null);
  assert.equal(normalizeEvolutionLabelColor({ hexColor: "#FF4529" }), null);
  assert.equal(normalizeEvolutionLabelColor({ color: "#FF4529" }), null);
  assert.equal(normalizeEvolutionLabelColor({ color: 1.5 }), null);
  assert.equal(normalizeEvolutionLabelColor({ color: 2_147_483_648 }), null);
});
