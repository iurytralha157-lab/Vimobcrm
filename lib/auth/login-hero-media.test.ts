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
const loginFormSource = readFileSync(
  "components/features/auth/login-form.tsx",
  "utf8",
);
const authContextSource = readFileSync("contexts/AuthContext.tsx", "utf8");
const authAPISource = readFileSync("lib/api/auth.ts", "utf8");
const globalStylesSource = readFileSync("app/globals.css", "utf8");

test("public auth surfaces inherit the canonical Vimob orange", () => {
  const authStylesStart = globalStylesSource.indexOf(".auth-login-page {");
  const authStylesEnd = globalStylesSource.indexOf(
    ".auth-login-page .auth-login-hero-title",
    authStylesStart,
  );

  assert.notEqual(authStylesStart, -1);
  assert.notEqual(authStylesEnd, -1);

  const authThemeOverrides = globalStylesSource.slice(authStylesStart, authStylesEnd);
  assert.match(globalStylesSource, /--vimob-accent:\s*#ff4529;/i);
  assert.match(
    authThemeOverrides,
    /--auth-action-background:\s*color-mix\([\s\S]*?var\(--vimob-accent\) 50%,[\s\S]*?transparent[\s\S]*?\);/,
  );
  assert.match(
    authThemeOverrides,
    /--auth-action-background-hover:\s*var\(--vimob-accent\);/,
  );
  assert.doesNotMatch(authThemeOverrides, /--primary\s*:/);
  assert.doesNotMatch(authThemeOverrides, /--ring\s*:/);
});

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

test("password recovery exposes a labelled heading and an honest back action", () => {
  assert.match(loginFormSource, /id="password-recovery-title"/);
  assert.match(loginFormSource, /aria-labelledby="password-recovery-title"/);
  assert.match(loginFormSource, /aria-describedby="password-recovery-description"/);
  assert.match(loginFormSource, /<h1[\s\S]*?>[\s\S]*?Recuperar senha[\s\S]*?<\/h1>/);
  assert.match(loginFormSource, /<ArrowLeftIcon\s*\/>\s*Voltar para o login/);
  assert.doesNotMatch(loginFormSource, /aria-label="Voltar para o login"/);
});

test("password recovery preserves the typed email and blocks concurrent requests", () => {
  assert.match(loginFormSource, /id="recovery-email"[\s\S]*?value=\{email\}/);
  assert.match(loginFormSource, /recoverySubmissionInFlightRef\.current/);
  assert.match(
    loginFormSource,
    /if \(recoverySubmissionInFlightRef\.current\) return;\s*recoverySubmissionInFlightRef\.current = true;/,
  );
  assert.match(loginFormSource, /finally \{\s*recoverySubmissionInFlightRef\.current = false;/);
  assert.match(loginFormSource, /PASSWORD_RECOVERY_REQUEST_WAIT_MS/);
  assert.match(
    loginFormSource,
    /runAuthOperationWithTimeout\(\s*\(\) => resetPassword\(normalizedEmail\)/,
  );
});

test("AuthContext delegates login and recovery to the validated auth API", () => {
  const signInStart = authContextSource.indexOf("const signIn = async");
  const resetStart = authContextSource.indexOf("const resetPassword = async", signInStart);
  const signOutStart = authContextSource.indexOf("const signOut = async", resetStart);

  assert.notEqual(signInStart, -1);
  assert.notEqual(resetStart, -1);
  assert.notEqual(signOutStart, -1);

  const signInSource = authContextSource.slice(signInStart, resetStart);
  const resetSource = authContextSource.slice(resetStart, signOutStart);
  assert.match(signInSource, /authAPI\.login\(email, password\)/);
  assert.doesNotMatch(signInSource, /supabase\.auth\.signInWithPassword/);
  assert.match(resetSource, /authAPI\.resetPassword\(email\)/);
  assert.doesNotMatch(resetSource, /supabase\.auth\.resetPasswordForEmail/);

  assert.match(authAPISource, /parseDomainInput\(loginSchema/);
  assert.match(authAPISource, /parseDomainInput\(resetPasswordSchema/);
});

test("login requests and post-login routing always reach a terminal UI state", () => {
  assert.match(loginFormSource, /runAuthOperationWithTimeout\(/);
  assert.match(loginFormSource, /LOGIN_OPERATION_WAIT_MS/);
  assert.match(loginFormSource, /POST_LOGIN_ROUTING_WAIT_MS/);
  assert.match(loginFormSource, /pendingLoginSawAuthenticatedUserRef\.current/);
  assert.match(loginFormSource, /setPendingPostLoginPath\(null\)/);
  assert.match(loginFormSource, /loginSubmissionInFlightRef\.current = false/);
  assert.match(loginFormSource, /setIsSubmittingLogin\(false\)/);
  assert.match(loginFormSource, /EMAIL_CONFIRMATION_RESEND_WAIT_MS/);
  assert.match(
    loginFormSource,
    /runAuthOperationWithTimeout\(\s*\(\) => authAPI\.resendSignupEmailConfirmation/,
  );
});
