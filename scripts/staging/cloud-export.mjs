import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCloudSource } from './cloud-baseline-contract.mjs';
import { buildCloudExport } from './cloud-export-build.mjs';

export async function writeCloudExport(outputDirectory, draft) {
  assert.ok(path.isAbsolute(outputDirectory), 'Output directory must be absolute.');
  const parent = await fs.realpath(path.dirname(outputDirectory));
  let ancestor = parent;
  while (true) {
    try { await fs.lstat(path.join(ancestor, '.git')); assert.fail('SQL output must remain outside Git repositories.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const next = path.dirname(ancestor); if (next === ancestor) break; ancestor = next;
  }
  const directory = path.join(parent, path.basename(outputDirectory));
  await fs.mkdir(directory); // Exclusive new directory; never overwrite/reuse an existing package.
  for (const [filename, sql] of Object.entries(draft.files)) {
    assert.match(filename, /^\d{2}-[a-z0-9-]+\.sql$/);
    await fs.writeFile(path.join(directory, filename), sql, { flag: 'wx', mode: 0o600 });
  }
  await fs.writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(draft.manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return directory;
}

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) {
    assert.ok(['--target', '--output-dir', '--rehearsal-database'].includes(args[index]) && args[index + 1] && !options[args[index]], 'Invalid exporter arguments.');
    options[args[index]] = args[index + 1];
  }
  assert.ok(path.isAbsolute(options['--target'] ?? ''));
  const target = JSON.parse(await fs.readFile(options['--target'], 'utf8'));
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const draft = buildCloudExport(await loadCloudSource(repositoryRoot), { target, rehearsalDatabase: options['--rehearsal-database'] });
  await writeCloudExport(options['--output-dir'], draft);
  console.log(JSON.stringify({ result: 'draft-exported-for-local-rehearsal', ready: false, remoteApplySupported: false,
    projectRef: draft.manifest.target.projectRef, prefixMigrations: draft.manifest.source.prefixMigrations,
    pendingForwards: draft.manifest.source.forwardsPending.length, blockCounts: draft.manifest.blockCounts,
    files: draft.manifest.files.map(({ file, sha256 }) => ({ file, sha256 })) }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Cloud draft export failed closed. No database was accessed. Inspect source integrity, public target, rehearsal database name and an unused output directory outside Git.'); process.exitCode = 1; });
}
