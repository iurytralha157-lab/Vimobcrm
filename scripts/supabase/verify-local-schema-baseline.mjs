import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBaseline } from './local-schema-baseline-contract.mjs';
import { assertSQLArtifact } from './local-schema-baseline-artifacts.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === '--manifest' && path.isAbsolute(args[1]))) {
  throw new Error('Usage: node scripts/supabase/verify-local-schema-baseline.mjs [--manifest absolute-path]');
}
const filename = args.length ? args[1] : path.join(repositoryRoot, 'supabase/reconciliation/local-bootstrap/baseline-20261016.json');
try {
  const baseline = await readBaseline(repositoryRoot, filename);
  for (const artifact of baseline.artifacts) assertSQLArtifact(artifact.source);
  console.log(JSON.stringify({ result: 'passed', classification: 'local-schema-baseline', databaseAccessed: false,
    originalHistoryExecuted: false, baselineId: baseline.manifest.baselineId,
    prefixMigrations: baseline.manifest.sourceChain.length, sourceChainSHA256: baseline.manifest.sourceChainSHA256,
    artifacts: baseline.artifacts.map(({ file, kind, sha256 }) => ({ file, kind, sha256 })),
    reviewedForwards: baseline.forwards.map(({ file, sha256 }) => ({ file, sha256 })) }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
