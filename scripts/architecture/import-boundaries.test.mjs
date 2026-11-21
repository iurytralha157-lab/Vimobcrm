import assert from "node:assert/strict";
import test from "node:test";
import { compareBoundary, frontendViolation, goViolation, importSpecifiers } from "./check-import-boundaries.mjs";

test("frontend parser finds executable and type imports without matching comments", () => {
  const source = `
// import Fake from "@/components/features/leads/Fake";
import type { Lead } from "@/components/features/leads/types";
export { Card } from "@/components/features/leads/LeadCard";
const deferred = import("@/components/features/leads/LeadDialog");
type Shape = import("@/components/features/leads/model").Shape;
`;
  assert.deepEqual(importSpecifiers(source, "View.tsx").map(({ value }) => value), [
    "@/components/features/leads/types",
    "@/components/features/leads/LeadCard",
    "@/components/features/leads/LeadDialog",
    "@/components/features/leads/model",
  ]);
});

test("frontend boundaries allow domain entries and deny new private imports", () => {
  const view = "components/features/whatsapp/Conversation.tsx";
  assert.equal(frontendViolation(view, "@/components/features/leads"), null);
  assert.equal(frontendViolation(view, "../leads/index.ts"), null);
  assert.equal(frontendViolation(view, "../leads/LeadCard"), "components/features/leads/LeadCard");
  assert.equal(frontendViolation(view, "@/hooks/leads/use-lead"), "hooks/leads/use-lead");
  assert.equal(frontendViolation(view, "@/lib/api/leads"), null);
  assert.equal(frontendViolation(view, "./conversations/Composer"), null);
  assert.equal(frontendViolation("components/shared/layout/Header.tsx", "@/components/features/leads"), "components/features/leads");
  assert.equal(frontendViolation("components/ui/button.tsx", "@/contexts/AuthContext"), "contexts/AuthContext");
  assert.equal(frontendViolation("components/ui/button.tsx", "@/lib/utils"), null);
  const dashboard = "components/features/dashboard/Dashboard.tsx";
  assert.equal(frontendViolation(dashboard, "@/components/features/leads"), "components/features/leads");
  assert.equal(frontendViolation(dashboard, "@/hooks/leads", new Set(["leads"])), "hooks/leads");
  assert.equal(frontendViolation(dashboard, "@/lib/api/leads"), null);
});

test("Go boundaries allow documented shared packages and preserve legacy package edges across splits", () => {
  const path = "github.com/vimob-crm/vimob-crm/apps/api/internal/";
  assert.equal(goViolation("leads/repository.go", path + "distribution"), null);
  assert.equal(goViolation("leads/repository.go", path + "tenant"), null);
  assert.equal(goViolation("app/routes.go", path + "leads"), null);
  const legacy = goViolation("whatsapp/worker.go", path + "ai");
  assert.equal(goViolation("whatsapp/message_worker.go", path + "ai"), legacy);
  const added = goViolation("settings/repository.go", path + "leads");
  const current = new Map([[legacy, "whatsapp/message_worker.go:7"], [added, "settings/repository.go:9"]]);
  assert.deepEqual(compareBoundary([legacy, "expired -> leads"], current), {
    additions: [[added, "settings/repository.go:9"]],
    resolved: ["expired -> leads"],
  });
});
