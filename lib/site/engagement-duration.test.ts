import assert from "node:assert/strict";
import test from "node:test";

import { createEngagementDurationTracker } from "./engagement-duration";

test("reports only elapsed visible time", () => {
  let currentTime = 1_000;
  const tracker = createEngagementDurationTracker(true, () => currentTime);

  currentTime += 5_500;
  assert.equal(tracker.flush(), 5);
  currentTime += 2_000;
  assert.equal(tracker.flush(), 2);
});

test("does not count time while the page is hidden", () => {
  let currentTime = 0;
  const tracker = createEngagementDurationTracker(true, () => currentTime);

  currentTime = 2_000;
  assert.equal(tracker.pause(), 2);
  currentTime = 102_000;
  assert.equal(tracker.flush(), 0);

  tracker.resume();
  currentTime = 105_000;
  assert.equal(tracker.flush(), 3);
});

test("does not double count repeated page lifecycle events", () => {
  let currentTime = 0;
  const tracker = createEngagementDurationTracker(true, () => currentTime);

  currentTime = 4_000;
  assert.equal(tracker.pause(), 4);
  assert.equal(tracker.pause(), 0);
  currentTime = 10_000;
  assert.equal(tracker.pause(), 0);
});

test("preserves sub-second visible time across a hidden interval", () => {
  let currentTime = 0;
  const tracker = createEngagementDurationTracker(true, () => currentTime);

  currentTime = 600;
  assert.equal(tracker.pause(), 0);
  currentTime = 100_600;
  tracker.resume();
  currentTime = 101_100;
  assert.equal(tracker.flush(), 1);
});
