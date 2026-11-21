import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = process.argv[2];
if (!output || !path.isAbsolute(output) || path.relative(root, output) === '') {
  throw new Error('Pass a new absolute output directory outside the source worktree.');
}
const relative = path.relative(root, output);
if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
  throw new Error('Recovery output must remain outside the source worktree.');
}
const planned = spawnSync(process.execPath, ['scripts/supabase/plan-google-calendar-edge-release.mjs', '--json'], {
  cwd: root, encoding: 'utf8', windowsHide: true,
});
if (planned.error) throw planned.error;
if (planned.status !== 0) throw new Error('The existing Google release dependency planner did not pass.');
const plan = JSON.parse(planned.stdout);
const files = [
  ...plan.release_directories.map(item => `${item.path}/index.ts`),
  ...plan.shared_files,
  ...plan.database_prerequisite.migrations,
  'scripts/maintenance/google-calendar-outbound-preflight.sql',
  'scripts/maintenance/google-calendar-runtime-contracts.sql',
  'docs/google-tasks.md',
];
const contents = await Promise.all(files.map(async source => ({ source, bytes: await readFile(path.join(root, source)) })));
await mkdir(output, { recursive: false });
const inventory = [];
for (const { source, bytes } of contents) {
  const destination = source.startsWith('supabase/functions/')
    ? source.replace('supabase/functions/', 'functions/')
    : source.startsWith('supabase/migrations/') ? source.replace('supabase/migrations/', 'database/') : source;
  const target = path.join(output, destination);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
  inventory.push({ source, destination, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(path.join(output, 'inventory.json'), JSON.stringify({
  kind: 'vimob-google-calendar-outbound-recovery-v2',
  generated_at: new Date().toISOString(),
  scope: 'Offline source package only. No environment, secrets, global router or global manifest included.',
  policy: { preserve_connect_mode: true, preserve_immediate_dispatch: true, inbound_enabled: false },
  database_prerequisite: plan.database_prerequisite,
  required_function_entries: plan.release_directories.map(item => ({
    slug: item.path.split('/').at(-1), status: 'ACTIVE', lifecycle: 'LIVE', verify_jwt: false,
  })),
  files: inventory,
}, null, 2), { flag: 'wx' });
await writeFile(path.join(output, 'SHA256SUMS'), `${inventory.map(item => `${item.sha256}  ${item.destination}`).join('\n')}\n`, { flag: 'wx' });
console.log(JSON.stringify({ output, files: inventory.length, secrets: 0, remote_operations: 0 }));
