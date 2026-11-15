import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts/supabase/package-google-calendar-recovery.mjs');
// Do not forward runtime secrets or NODE_OPTIONS to the packaging subprocess.
const environment = { SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? '' };

function invoke(output, permissions = []) {
  return spawnSync(process.execPath, ['--permission', '--allow-fs-read=*', ...permissions, script, output], {
    cwd: root, encoding: 'utf8', windowsHide: true, env: environment, timeout: 30_000,
  });
}

test('rejects a worktree child beginning with two dots before attempting any side effect', async () => {
  const child = path.join(root, `..qa-output-${randomUUID()}`);
  await assert.rejects(access(child), { code: 'ENOENT' });
  // No writes or subprocesses are permitted, including when the guard regresses.
  const result = invoke(child);
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  await assert.rejects(access(child), { code: 'ENOENT' });
  assert.match(result.stderr, /Recovery output must remain outside the source worktree/);
  assert.doesNotMatch(result.stderr, /ERR_ACCESS_DENIED/);
});

test('packages a legitimate external directory with matching file hashes and no environment files', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'vimob-google-package-test-'));
  const output = path.join(temporary, 'release');
  try {
    const result = invoke(output, ['--allow-child-process', `--allow-fs-write=${temporary}`]);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.output, output);
    assert.equal(summary.secrets, 0);
    assert.equal(summary.remote_operations, 0);
    const inventory = JSON.parse(await readFile(path.join(output, 'inventory.json'), 'utf8'));
    assert.equal(inventory.files.filter(item => item.destination.startsWith('functions/')).length, 9);
    assert.ok(inventory.files.every(item => !/(^|\/)\.env|(^|\/)production-manifest\.json$/.test(item.destination)));
    for (const item of inventory.files) {
      const bytes = await readFile(path.join(output, item.destination));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, item.destination);
    }
  } finally {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
    assert.ok(path.basename(temporary).startsWith('vimob-google-package-test-'));
    await rm(temporary, { recursive: true, force: true });
  }
});
