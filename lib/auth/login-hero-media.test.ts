import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const heroSource = readFileSync(
  "components/features/auth/LoginHeroMedia.tsx",
  "utf8",
);
const layoutSource = readFileSync(
  "components/features/auth/AuthSplitLayout.tsx",
  "utf8",
);
const selectOrganizationSource = readFileSync(
  "components/features/auth/screens/SelectOrganizationScreen.tsx",
  "utf8",
);

test("the active login hero loops and has a replay fallback", () => {
  assert.match(layoutSource, /<LoginHeroMedia\s*\/>/);
  assert.match(heroSource, /\bautoPlay\b/);
  assert.match(heroSource, /\bmuted\b/);
  assert.match(heroSource, /\bloop\b/);
  assert.match(heroSource, /\bplaysInline\b/);
  assert.match(heroSource, /onEnded=\{\(event\)\s*=>/);
  assert.match(heroSource, /video\.currentTime\s*=\s*0/);
  assert.match(heroSource, /video\.play\(\)/);
});

test("the login hero clips every media frame to the rounded panel", () => {
  assert.match(layoutSource, /overflow-hidden rounded-\[16px\]/);
  assert.match(heroSource, /rounded-\[inherit\]/);
});

test("the login hero resynchronizes playback after tab visibility changes", () => {
  assert.match(
    heroSource,
    /document\.addEventListener\("visibilitychange",\s*syncPlayback\)/,
  );
  assert.match(
    heroSource,
    /document\.removeEventListener\("visibilitychange",\s*syncPlayback\)/,
  );
  assert.match(heroSource, /document\.visibilityState\s*===\s*"hidden"/);
});

test("organization selection falls back when a configured brand logo fails", () => {
  assert.match(selectOrganizationSource, /const \[failedLogoUrl, setFailedLogoUrl\]/);
  assert.match(selectOrganizationSource, /logoUrl !== failedLogoUrl/);
  assert.match(selectOrganizationSource, /onError=\{\(\)\s*=>/);
  assert.match(selectOrganizationSource, /setFailedLogoUrl\(logoUrl\)/);
  assert.match(selectOrganizationSource, /'\/images\/logo-black\.png'/);
  assert.match(selectOrganizationSource, /'\/images\/logo-white\.png'/);
});

test("organization cards align avatar and action feedback in a compact layout", () => {
  assert.match(selectOrganizationSource, /min-h-\[124px\][^\"]*\bpx-5 py-4\b/);
  assert.match(
    selectOrganizationSource,
    /AvatarFallback className="[^"]*group-hover:bg-primary[^"]*group-focus-visible:bg-primary/,
  );
  assert.match(
    selectOrganizationSource,
    /className="mt-3 flex items-center justify-between gap-3"/,
  );
});
