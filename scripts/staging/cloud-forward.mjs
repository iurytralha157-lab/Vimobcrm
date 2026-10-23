import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCloudSource } from './cloud-baseline-contract.mjs';
import { buildCloudForwards } from './cloud-forward-build.mjs';
import { writeCloudExport } from './cloud-export.mjs';

export async function readBaselineTrial(directory) {
  assert.ok(path.isAbsolute(directory), 'Baseline trial directory must be absolute.');
  const canonicalDirectory = await fs.realpath(directory);
  const manifestPath = await fs.realpath(path.join(canonicalDirectory, 'manifest.json'));
  assert.equal(path.dirname(manifestPath).toLowerCase(), canonicalDirectory.toLowerCase(), 'Manifest must remain inside the trial directory.');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const files = {};
  assert.ok(Array.isArray(manifest.files));
  for (const entry of manifest.files) {
    assert.match(entry.file, /^\d{2}-[a-z0-9-]+\.sql$/);
    const filename = await fs.realpath(path.join(canonicalDirectory, entry.file));
    assert.equal(path.dirname(filename).toLowerCase(), canonicalDirectory.toLowerCase(), 'SQL must remain inside the trial directory.');
    files[entry.file] = await fs.readFile(filename, 'utf8');
  }
  return { manifest, files };
}

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) {
    assert.ok(['--baseline-trial-dir', '--target', '--readback', '--output-dir'].includes(args[index]) && args[index + 1] && !options[args[index]], 'Invalid forward preparation arguments.');
    options[args[index]] = args[index + 1];
  }
  for (const key of ['--baseline-trial-dir', '--target', '--readback', '--output-dir']) assert.ok(path.isAbsolute(options[key] ?? ''));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const source = await loadCloudSource(root);
  const trial = await readBaselineTrial(options['--baseline-trial-dir']);
  const target = JSON.parse(await fs.readFile(options['--target'], 'utf8'));
  const readback = JSON.parse(await fs.readFile(options['--readback'], 'utf8'));
  const prepared = buildCloudForwards(source, trial, { target, readback });
  await writeCloudExport(options['--output-dir'], prepared);
  console.log(JSON.stringify({ result: 'canonical-forwards-prepared-not-executed', ready: false, trialPassed: false,
    projectRef: target.projectRef, count: prepared.manifest.count, firstOrdinal: prepared.manifest.firstOrdinal,
    lastOrdinal: prepared.manifest.lastOrdinal, outerTransactionsRemoved: prepared.manifest.outerTransactionsRemoved,
    files: prepared.manifest.files.map(({ file, ordinal, sha256, canonicalFile, canonicalSHA256, payloadSHA256 }) =>
      ({ file, ordinal, sha256, canonicalFile, canonicalSHA256, payloadSHA256 })) }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Cloud forward preparation failed closed. No database was accessed. Verify canonical sources, immutable baseline trial hashes, fresh project readback and a new output directory outside Git.'); process.exitCode = 1; });
}
