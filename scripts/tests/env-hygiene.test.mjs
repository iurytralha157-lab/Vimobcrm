import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("Docker build context excludes local secrets and generated workspaces", () => {
  const dockerignore = read(".dockerignore");
  for (const entry of [
    ".env",
    ".env.*",
    ".codex-tmp",
    ".codex-worktrees",
    ".cache",
    ".next-*",
  ]) {
    assert.match(dockerignore, new RegExp(`^${entry.replaceAll(".", "\\.").replaceAll("*", ".*")}$`, "mu"));
  }
});

test("both deployment stacks forward every operational worker switch", () => {
  const stacks = [
    read("deploy/portainer-stack.yml"),
    read("deploy/portainer-stack.build.yml"),
  ];
  const switches = [
    "AUTOMATION_RUNTIME_WORKER_ENABLED",
    "PROPERTY_DEVELOPMENT_RESERVATION_WORKER_ENABLED",
    "PROPERTY_PUBLICATION_WORKER_ENABLED",
    "ASAAS_RECONCILIATION_ENABLED",
    "META_WEBHOOK_WORKER_ENABLED",
  ];

  for (const stack of stacks) {
    for (const name of switches) {
      const expected = `      ${name}: ` + "${" + `${name}:-true}`;
      assert.ok(stack.split(/\r?\n/u).includes(expected), `${name} must be forwarded`);
    }
  }
});

test("the canonical example documents every forwarded worker switch once", () => {
  const example = read(".env.example");
  for (const name of [
    "AUTOMATION_RUNTIME_WORKER_ENABLED",
    "PROPERTY_DEVELOPMENT_RESERVATION_WORKER_ENABLED",
    "PROPERTY_PUBLICATION_WORKER_ENABLED",
    "ASAAS_RECONCILIATION_ENABLED",
    "META_WEBHOOK_WORKER_ENABLED",
  ]) {
    const matches = example.match(new RegExp(`^${name}=`, "gmu")) ?? [];
    assert.equal(matches.length, 1, `${name} must be documented exactly once`);
  }
});

test("the local normalizer is value-redacting and fail-closed", () => {
  const source = read("scripts/qa/normalize-local-env.mjs");
  assert.match(source, /duplicate_env_keys/u);
  assert.match(source, /invalid_env_line/u);
  assert.match(source, /NOTIFICATION_DISPATCH_WORKER_ENABLED/u);
  assert.doesNotMatch(source, /console\.log\([^)]*(rawValue|value)/u);
});
