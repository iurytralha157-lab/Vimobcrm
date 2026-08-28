import assert from "node:assert/strict";
import test from "node:test";

import {
  isSettingsLegacyIntegrationTab,
  isSettingsPageTab,
  normalizeSettingsTabAlias,
} from "./settings-tabs";

test("recognizes canonical settings tabs", () => {
  assert.equal(isSettingsPageTab("account"), true);
  assert.equal(isSettingsPageTab("team"), true);
  assert.equal(isSettingsPageTab("users"), false);
  assert.equal(isSettingsPageTab("unknown"), false);
});

test("recognizes legacy integration deep links", () => {
  assert.equal(isSettingsLegacyIntegrationTab("meta"), true);
  assert.equal(isSettingsLegacyIntegrationTab("whatsapp"), true);
  assert.equal(isSettingsLegacyIntegrationTab("account"), false);
});

test("normalizes the singular webhook alias", () => {
  assert.equal(normalizeSettingsTabAlias("webhook"), "webhooks");
  assert.equal(normalizeSettingsTabAlias("webhooks"), "webhooks");
  assert.equal(normalizeSettingsTabAlias(null), null);
});
