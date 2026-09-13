import assert from "node:assert/strict";
import test from "node:test";

import {
  createPublicSiteSessionStartCoordinator,
  getPublicSiteSessionActivityKey,
  getPublicSiteSessionStartedKey,
  getPublicSiteSessionKey,
  hasPublicSiteSessionStarted,
  PUBLIC_SITE_SESSION_INACTIVITY_MS,
  markPublicSiteSessionStarted,
  resolvePublicSiteSessionId,
  type PublicSiteSessionStorage,
} from "./public-session";

function memoryStorage(): PublicSiteSessionStorage {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("reuses the id inside the same browser session", () => {
  const storage = memoryStorage();
  let creations = 0;
  const create = () => `session-${++creations}`;

  assert.equal(
    resolvePublicSiteSessionId(storage, "org-a", create),
    "session-1",
  );
  assert.equal(
    resolvePublicSiteSessionId(storage, "org-a", create),
    "session-1",
  );
  assert.equal(creations, 1);
});

test("creates an independent id for a new browser session", () => {
  const firstSession = memoryStorage();
  const secondSession = memoryStorage();

  assert.equal(
    resolvePublicSiteSessionId(firstSession, "org-a", () => "session-first"),
    "session-first",
  );
  assert.equal(
    resolvePublicSiteSessionId(secondSession, "org-a", () => "session-second"),
    "session-second",
  );
});

test("keeps an existing non-empty session id", () => {
  const storage = memoryStorage();
  storage.setItem(getPublicSiteSessionKey("org-a"), "existing-session");

  assert.equal(
    resolvePublicSiteSessionId(storage, "org-a", () => "replacement-session"),
    "existing-session",
  );
});

test("rejects an empty generated id instead of persisting invalid attribution", () => {
  const storage = memoryStorage();

  assert.throws(
    () => resolvePublicSiteSessionId(storage, "org-a", () => "   "),
    /must not be empty/,
  );
  assert.equal(storage.getItem(getPublicSiteSessionKey("org-a")), null);
});

test("isolates sessions for organizations sharing the same site origin", () => {
  const storage = memoryStorage();

  assert.equal(
    resolvePublicSiteSessionId(storage, "org-a", () => "session-a"),
    "session-a",
  );
  assert.equal(
    resolvePublicSiteSessionId(storage, "org-b", () => "session-b"),
    "session-b",
  );
  assert.notEqual(
    getPublicSiteSessionKey("org-a"),
    getPublicSiteSessionKey("org-b"),
  );
});

test("records session_start once per organization and browser session", () => {
  const storage = memoryStorage();

  assert.equal(
    markPublicSiteSessionStarted(storage, "org-a", "session-a"),
    true,
  );
  assert.equal(
    hasPublicSiteSessionStarted(storage, "org-a", "session-a"),
    true,
  );
  assert.equal(
    markPublicSiteSessionStarted(storage, "org-a", "session-a"),
    false,
  );
  assert.equal(
    markPublicSiteSessionStarted(storage, "org-a", "session-a-2"),
    true,
  );
  assert.equal(
    markPublicSiteSessionStarted(storage, "org-b", "session-b"),
    true,
  );
  assert.notEqual(
    getPublicSiteSessionStartedKey("org-a"),
    getPublicSiteSessionStartedKey("org-b"),
  );
});

test("confirms session_start only after success and retries failures", async () => {
  const storage = memoryStorage();
  const coordinate = createPublicSiteSessionStartCoordinator();
  let attempts = 0;
  const options = {
    hasStarted: () =>
      hasPublicSiteSessionStarted(storage, "org-a", "session-a"),
    start: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary failure");
    },
    markStarted: () => {
      markPublicSiteSessionStarted(storage, "org-a", "session-a");
    },
  };

  assert.equal(await coordinate("org-a:session-a", options), false);
  assert.equal(
    hasPublicSiteSessionStarted(storage, "org-a", "session-a"),
    false,
  );
  assert.equal(await coordinate("org-a:session-a", options), true);
  assert.equal(attempts, 2);
  assert.equal(
    hasPublicSiteSessionStarted(storage, "org-a", "session-a"),
    true,
  );
});

test("shares one in-flight session_start and marks it after the request", async () => {
  const storage = memoryStorage();
  const coordinate = createPublicSiteSessionStartCoordinator();
  let finishRequest: (() => void) | undefined;
  let attempts = 0;
  const request = new Promise<void>((resolve) => {
    finishRequest = resolve;
  });
  const options = {
    hasStarted: () =>
      hasPublicSiteSessionStarted(storage, "org-a", "session-a"),
    start: async () => {
      attempts += 1;
      await request;
    },
    markStarted: () => {
      markPublicSiteSessionStarted(storage, "org-a", "session-a");
    },
  };

  const first = coordinate("org-a:session-a", options);
  const second = coordinate("org-a:session-a", options);
  await Promise.resolve();
  assert.equal(attempts, 1);
  assert.equal(
    hasPublicSiteSessionStarted(storage, "org-a", "session-a"),
    false,
  );

  finishRequest?.();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(attempts, 1);
  assert.equal(
    hasPublicSiteSessionStarted(storage, "org-a", "session-a"),
    true,
  );
});

test("rotates an active session after thirty minutes without activity", () => {
  const storage = memoryStorage();
  let creations = 0;
  const create = () => `session-${++creations}`;
  const startedAt = 1_000;

  assert.equal(
    resolvePublicSiteSessionId(storage, "org-a", create, { now: startedAt }),
    "session-1",
  );
  assert.equal(
    resolvePublicSiteSessionId(storage, "org-a", create, {
      now: startedAt + PUBLIC_SITE_SESSION_INACTIVITY_MS,
    }),
    "session-1",
  );
  assert.equal(
    resolvePublicSiteSessionId(storage, "org-a", create, {
      now: startedAt + 2 * PUBLIC_SITE_SESSION_INACTIVITY_MS + 1,
    }),
    "session-2",
  );
  assert.equal(
    storage.getItem(getPublicSiteSessionActivityKey("org-a")),
    String(startedAt + 2 * PUBLIC_SITE_SESSION_INACTIVITY_MS + 1),
  );
});

test("a heartbeat neither extends nor rotates a session by itself", () => {
  const storage = memoryStorage();
  let creations = 0;
  const create = () => `session-${++creations}`;
  const startedAt = 1_000;

  assert.equal(
    resolvePublicSiteSessionId(storage, "org-a", create, { now: startedAt }),
    "session-1",
  );
  assert.equal(
    resolvePublicSiteSessionId(storage, "org-a", create, {
      now: startedAt + PUBLIC_SITE_SESSION_INACTIVITY_MS + 1,
      recordActivity: false,
    }),
    "session-1",
  );
  assert.equal(
    storage.getItem(getPublicSiteSessionActivityKey("org-a")),
    String(startedAt),
  );
  assert.equal(
    resolvePublicSiteSessionId(storage, "org-a", create, {
      now: startedAt + PUBLIC_SITE_SESSION_INACTIVITY_MS + 1,
    }),
    "session-2",
  );
  assert.equal(
    markPublicSiteSessionStarted(storage, "org-a", "session-1"),
    true,
  );
  assert.equal(
    markPublicSiteSessionStarted(storage, "org-a", "session-2"),
    true,
  );
});
