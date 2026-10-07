import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_WINDOWS_ROOT,
  parseArguments,
  parseOriginMainHead,
  validateReleasePreflight,
} from './release-image-preflight.mjs';

const sha = '0123456789abcdef0123456789abcdef01234567';
const web = `ghcr.io/iurytralha157-lab/vimob-crm-web:${sha}`;
const api = `ghcr.io/iurytralha157-lab/vimob-crm-api:${sha}`;
const fixture = () => ({
  platform: 'win32',
  canonicalRoot: CANONICAL_WINDOWS_ROOT,
  workingRoot: CANONICAL_WINDOWS_ROOT,
  scriptRoot: CANONICAL_WINDOWS_ROOT,
  gitRoot: CANONICAL_WINDOWS_ROOT,
  gitHead: sha,
  originMainHead: sha,
  gitStatus: '',
  options: {
    'expected-sha': sha,
    'web-image': web,
    'api-image': api,
    'bridge-image': api,
  },
});

test('accepts only the clean canonical checkout with matching full SHA image tags', () => {
  const result = validateReleasePreflight(fixture());
  assert.equal(result.ok, true);
  assert.equal(result.digestPinned, false);
});

test('rejects dirty checkout and stale HEAD independently', () => {
  const input = fixture();
  input.gitHead = 'a'.repeat(40);
  input.gitStatus = ' M hooks/use-whatsapp-attendance.ts\n?? scripts/qa/unknown.mjs';
  const result = validateReleasePreflight(input);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /HEAD .* differs/);
  assert.match(result.failures.join('\n'), /staged, unstaged, or untracked/);
});

test('rejects an old clean checkout even when its HEAD and image tags match', () => {
  const input = fixture();
  input.originMainHead = 'a'.repeat(40);
  const result = validateReleasePreflight(input);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /origin\/main .* differs from expected SHA/);
});

test('fails closed when origin/main cannot be verified', () => {
  const input = fixture();
  input.originMainHead = undefined;
  assert.match(validateReleasePreflight(input).failures.join('\n'), /Could not verify/);
  assert.equal(parseOriginMainHead(`${sha}\trefs/heads/main`), sha);
  for (const output of ['', `${sha}\trefs/heads/other`, `short\trefs/heads/main`]) {
    assert.throws(() => parseOriginMainHead(output), /Could not verify/);
  }
});

test('rejects another worktree even when its HEAD and images match', () => {
  const input = fixture();
  input.workingRoot = 'D:\\Vimob\\worktrees\\old-release';
  input.scriptRoot = 'D:\\Vimob\\worktrees\\old-release';
  input.gitRoot = 'D:\\Vimob\\worktrees\\old-release';
  const result = validateReleasePreflight(input);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /working directory is not the canonical checkout/);
  assert.match(result.failures.join('\n'), /script directory is not the canonical checkout/);
});

test('rejects a script loaded from another checkout even when invoked in canonical root', () => {
  const input = fixture();
  input.scriptRoot = 'D:\\Vimob\\worktrees\\old-release';
  assert.equal(validateReleasePreflight(input).ok, false);
});

test('rejects mixed Web/API/bridge commits, latest tags and another image repository', () => {
  const input = fixture();
  input.options['web-image'] = web.replace(sha, 'a'.repeat(40));
  input.options['api-image'] = 'ghcr.io/iurytralha157-lab/vimob-crm-api:latest';
  input.options['bridge-image'] = `ghcr.io/other/vimob-crm-api:${sha}`;
  const result = validateReleasePreflight(input);
  assert.equal(result.ok, false);
  assert.equal(result.failures.filter((failure) => failure.includes('image must be')).length, 3);
  assert.match(result.failures.join('\n'), /Webhook bridge must use the exact same API image reference/);
});

test('rejects short or uppercase SHA rather than silently normalizing it', () => {
  for (const invalidSha of [sha.slice(0, 8), sha.toUpperCase()]) {
    const input = fixture();
    input.options['expected-sha'] = invalidSha;
    assert.match(validateReleasePreflight(input).failures.join('\n'), /full lowercase 40-character/);
  }
});

test('requires all three digest pins together and identical API/bridge references', () => {
  const input = fixture();
  const digest = `sha256:${'b'.repeat(64)}`;
  input.options['api-image'] = `${api}@${digest}`;
  input.options['bridge-image'] = `${api}@${digest}`;
  assert.match(validateReleasePreflight(input).failures.join('\n'), /Digest pinning is partial/);

  input.options['web-image'] = `${web}@sha256:${'a'.repeat(64)}`;
  const result = validateReleasePreflight(input);
  assert.equal(result.ok, true);
  assert.equal(result.digestPinned, true);

  input.options['bridge-image'] = `${api}@sha256:${'c'.repeat(64)}`;
  assert.match(validateReleasePreflight(input).failures.join('\n'), /exact same API image reference/);
});

test('--require-digests rejects unpinned refs and malformed digest', () => {
  const input = fixture();
  input.options['require-digests'] = true;
  assert.match(validateReleasePreflight(input).failures.join('\n'), /requires @sha256/);

  input.options['web-image'] = `${web}@sha256:short`;
  assert.match(validateReleasePreflight(input).failures.join('\n'), /web image must be/);
});

test('CLI parser fails closed on missing, duplicate or unknown arguments', () => {
  const required = [
    '--expected-sha', sha,
    '--web-image', web,
    '--api-image', api,
    '--bridge-image', api,
  ];
  assert.deepEqual(parseArguments(required)['expected-sha'], sha);
  assert.throws(() => parseArguments(required.slice(0, -2)), /Missing required option/);
  assert.throws(() => parseArguments([...required, '--expected-sha', sha]), /Duplicate option/);
  assert.throws(() => parseArguments([...required, '--skip-clean']), /Unknown option/);
});
