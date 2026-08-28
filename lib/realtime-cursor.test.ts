import assert from "node:assert/strict";
import test from "node:test";
import { nextRealtimeCursor, realtimeReconnectDelay } from "./realtime-cursor";

test("durable realtime cursor only advances for positive decimal ids", () => {
  assert.equal(nextRealtimeCursor(null, "12"), "12");
  assert.equal(nextRealtimeCursor("12", "11"), "12");
  assert.equal(nextRealtimeCursor("99", "100"), "100");
  assert.equal(nextRealtimeCursor("100", "connected"), "100");
  assert.equal(nextRealtimeCursor("100", "transient-1"), "100");
  assert.equal(nextRealtimeCursor("100", "0"), "100");
});

test("reconnect backoff has bounded jitter and a 15 second cap", () => {
  assert.equal(realtimeReconnectDelay(0, 0), 750);
  assert.equal(realtimeReconnectDelay(0, 1), 1_250);
  assert.equal(realtimeReconnectDelay(8, 0), 11_250);
  assert.equal(realtimeReconnectDelay(8, 1), 15_000);
});
