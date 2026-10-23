import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function loadModule(path, imports = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const record = { exports: {} };
  vm.runInNewContext(compiled, { exports: record.exports, module: record, require: (name) => imports[name] || {} });
  return record.exports;
}
const clocks = loadModule("../lib/teams/availability-clock.ts");
const { formatAvailabilitySummary } = loadModule("./use-member-availability.ts", { "@/lib/teams/availability-clock": clocks });

test("summary preserves a second-wide saved interval and minute precision", () => {
  const day = { day_of_week: 1, is_active: true, is_all_day: false, start_time: "09:15:30", end_time: "09:15:45" };
  assert.equal(formatAvailabilitySummary([day]), "Seg 09:15:30 - 09:15:45");
  assert.equal(formatAvailabilitySummary([{ ...day, start_time: "09:15:00", end_time: "18:45:00" }]), "Seg 09:15 - 18:45");
});
test("summary explicitly marks null and invalid saved clocks for review", () => {
  for (const start_time of [null, "invalid", "09:15:30.123"]) assert.equal(formatAvailabilitySummary([{ day_of_week: 1, is_active: true, is_all_day: false, start_time, end_time: "18:00:00" }]), "Escala precisa de revisão");
  assert.equal(formatAvailabilitySummary([{ day_of_week: 1, is_active: true, is_all_day: true, start_time: null, end_time: null }]), "24h (Seg)");
});
