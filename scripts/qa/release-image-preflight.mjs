#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const CANONICAL_WINDOWS_ROOT = 'D:\\Vimob\\workspaces\\vimob-crm';
const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const IMAGE_REPOSITORIES = Object.freeze({
  web: 'ghcr.io/iurytralha157-lab/vimob-crm-web',
  api: 'ghcr.io/iurytralha157-lab/vimob-crm-api',
  bridge: 'ghcr.io/iurytralha157-lab/vimob-crm-api',
});
const REQUIRED_OPTIONS = Object.freeze([
  'expected-sha',
  'web-image',
  'api-image',
  'bridge-image',
]);
const ALLOWED_OPTIONS = new Set([...REQUIRED_OPTIONS, 'require-digests']);

export function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index].replace(/^--/, '');
    if (!argv[index].startsWith('--') || !ALLOWED_OPTIONS.has(name)) {
      throw new Error(`Unknown option: ${argv[index]}`);
    }
    if (Object.hasOwn(options, name)) throw new Error(`Duplicate option: --${name}`);
    if (name === 'require-digests') {
      options[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
    options[name] = value;
    index += 1;
  }
  for (const name of REQUIRED_OPTIONS) {
    if (!options[name]) throw new Error(`Missing required option: --${name}`);
  }
  return options;
}

function samePath(left, right, platform) {
  const normalize = platform === 'win32' ? (value) => value.toLowerCase() : (value) => value;
  return normalize(path.normalize(left)) === normalize(path.normalize(right));
}

export function validateReleasePreflight({
  platform,
  canonicalRoot,
  workingRoot,
  scriptRoot,
  gitRoot,
  gitHead,
  originMainHead,
  gitStatus,
  options,
}) {
  const failures = [];
  if (platform !== 'win32') {
    failures.push('This local guard is intended for the canonical Windows checkout.');
  }
  for (const [name, actual] of [
    ['working directory', workingRoot],
    ['script directory', scriptRoot],
    ['Git root', gitRoot],
  ]) {
    if (!samePath(actual, canonicalRoot, platform)) {
      failures.push(`${name} is not the canonical checkout: ${actual}`);
    }
  }

  const expectedSha = options['expected-sha'];
  if (!RELEASE_SHA_PATTERN.test(expectedSha)) {
    failures.push('Expected SHA must be the full lowercase 40-character Git commit ID.');
  }
  if (gitHead !== expectedSha) {
    failures.push(`HEAD ${gitHead} differs from expected SHA ${expectedSha}.`);
  }
  if (!RELEASE_SHA_PATTERN.test(originMainHead ?? '')) {
    failures.push('Could not verify the full commit ID of origin/main.');
  } else if (originMainHead !== expectedSha) {
    failures.push(`origin/main ${originMainHead} differs from expected SHA ${expectedSha}.`);
  }
  if (gitStatus.trim()) {
    failures.push('Git checkout has staged, unstaged, or untracked files.');
  }

  const imageRefs = {};
  for (const service of ['web', 'api', 'bridge']) {
    const value = options[`${service}-image`];
    const expectedTag = `${IMAGE_REPOSITORIES[service]}:${expectedSha}`;
    const digestSuffix = value.startsWith(`${expectedTag}@`) ? value.slice(expectedTag.length + 1) : null;
    if (value !== expectedTag && (!digestSuffix || !DIGEST_PATTERN.test(digestSuffix))) {
      failures.push(`${service} image must be ${expectedTag} or that exact tag pinned with @sha256:<64 hex>.`);
    }
    imageRefs[service] = { value, digest: digestSuffix };
  }
  if (imageRefs.bridge.value !== imageRefs.api.value) {
    failures.push('Webhook bridge must use the exact same API image reference.');
  }
  const digestCount = Object.values(imageRefs).filter((reference) => reference.digest).length;
  if (digestCount > 0 && digestCount !== 3) {
    failures.push('Digest pinning is partial; pin web, API and bridge together.');
  }
  if (options['require-digests'] && digestCount !== 3) {
    failures.push('--require-digests requires @sha256:<64 hex> on all three image references.');
  }

  return { ok: failures.length === 0, failures, expectedSha, digestPinned: digestCount === 3 };
}

function git(args, cwd, { timeout = 0 } = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    windowsHide: true,
  }).trimEnd();
}

export function parseOriginMainHead(output) {
  const match = /^([0-9a-f]{40})\trefs\/heads\/main$/.exec(output.trim());
  if (!match) throw new Error('Could not verify origin/main from git ls-remote.');
  return match[1];
}

export function runPreflight(options, { cwd = process.cwd(), platform = process.platform } = {}) {
  const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const canonicalRoot = realpathSync(CANONICAL_WINDOWS_ROOT);
  const workingRoot = realpathSync(cwd);
  const actualScriptRoot = realpathSync(scriptRoot);
  // Inspect only local files. No registry, Portainer, database or production calls.
  const gitRoot = realpathSync(git(['rev-parse', '--show-toplevel'], workingRoot));
  const gitHead = git(['rev-parse', '--verify', 'HEAD'], workingRoot);
  const gitStatus = git(['status', '--porcelain=v1', '--untracked-files=all'], workingRoot);
  let originMainHead;
  try {
    originMainHead = parseOriginMainHead(git(['ls-remote', '--exit-code', 'origin', 'refs/heads/main'], workingRoot, { timeout: 15_000 }));
  } catch {
    throw new Error('Could not verify origin/main from git ls-remote. Check network and origin, then retry.');
  }
  return validateReleasePreflight({
    platform,
    canonicalRoot,
    workingRoot,
    scriptRoot: actualScriptRoot,
    gitRoot,
    gitHead,
    originMainHead,
    gitStatus,
    options,
  });
}

function usage() {
  return [
    'Run from D:\\Vimob\\workspaces\\vimob-crm after committing all intended changes:',
    'node scripts/qa/release-image-preflight.mjs --expected-sha <40-hex> --web-image <ref> --api-image <ref> --bridge-image <ref>',
    'For digest-pinned references, append @sha256:<64-hex> to each image and add --require-digests.',
  ].join('\n');
}

if (process.argv[1] && samePath(path.resolve(process.argv[1]), fileURLToPath(import.meta.url), process.platform)) {
  try {
    const result = runPreflight(parseArguments(process.argv.slice(2)));
    if (!result.ok) {
      for (const failure of result.failures) process.stderr.write(`FAIL: ${failure}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`PASS: canonical clean checkout, HEAD and web/API/bridge match ${result.expectedSha}.\n`);
      process.stdout.write(result.digestPinned
        ? 'All three planned references include digest pins.\n'
        : 'Tag-only references: registry contents and deployed digests remain unverified.\n');
    }
  } catch (error) {
    process.stderr.write(`FAIL: ${error.message}\n\n${usage()}\n`);
    process.exitCode = 1;
  }
}
