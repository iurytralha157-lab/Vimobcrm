import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const normalize = text => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
export const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
export const digestJSON = value => sha256(JSON.stringify(value));
const HASH = /^[0-9a-f]{64}$/;
const FILE = /^\d{14}_[a-z0-9_]+\.sql$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function mapInBatches(values, callback) {
  const results = [];
  for (let index = 0; index < values.length; index += 16) {
    results.push(...await Promise.all(values.slice(index, index + 16).map(callback)));
  }
  return results;
}

export function validateTarget(target) {
  assert.equal(target.kind, 'vimob-local-schema-baseline-target-v1');
  assert.match(target.runId, UUID);
  assert.ok(path.isAbsolute(target.runManifest));
  assert.match(target.databaseName, /^vimob_local_baseline_[a-z0-9_]{1,40}$/);
  return target;
}

export function validateManifest(manifest) {
  assert.equal(manifest.kind, 'vimob-local-schema-baseline-v1');
  assert.equal(manifest.classification, 'local-schema-baseline');
  assert.equal(manifest.originalHistoryExecution, false);
  assert.equal(manifest.productionDataIncluded, false);
  assert.equal(manifest.scope, 'fresh-local-database-only');
  assert.match(manifest.baselineId, /^[a-z0-9][a-z0-9_-]{3,79}$/);
  assert.match(manifest.sourceChainSHA256, HASH);
  assert.match(manifest.expectedCatalogSHA256, HASH);
  assert.ok(Array.isArray(manifest.sourceChain) && manifest.sourceChain.length > 0);
  assert.deepEqual(manifest.sourceChain.map(row => row.file), [...manifest.sourceChain.map(row => row.file)].sort());
  assert.equal(new Set(manifest.sourceChain.map(row => row.file)).size, manifest.sourceChain.length);
  for (const row of manifest.sourceChain) {
    assert.match(row.file, FILE);
    assert.match(row.sha256, HASH);
  }
  assert.equal(digestJSON(manifest.sourceChain), manifest.sourceChainSHA256);
  assert.ok(manifest.artifacts?.length > 0);
  for (const artifact of manifest.artifacts) {
    assert.ok(typeof artifact.file === 'string' && artifact.file.length > 0);
    assert.equal(path.isAbsolute(artifact.file), false);
    assert.ok(!artifact.file.split(/[\\/]/).includes('..'));
    assert.match(artifact.sha256, HASH);
    assert.ok(['schema', 'reference-data', 'extension-binding'].includes(artifact.kind));
    assert.equal(artifact.schemaOnly, artifact.kind !== 'reference-data');
    if (artifact.kind === 'reference-data') {
      assert.ok(artifact.sourceMigrationHashes?.length > 0);
      for (const source of artifact.sourceMigrationHashes) assert.ok(manifest.sourceChain.some(row => row.file === source.file && row.sha256 === source.sha256));
    }
  }
  assert.ok(manifest.provenance?.knownHistoricalExceptions?.length >= 3);
  assert.equal(manifest.provenance?.sourceContainsOnlySyntheticData, true);
  assert.equal(manifest.provenance?.originalHistoryStillArchived, true);
  assert.match(manifest.expectedDataSHA256, HASH);
  assert.deepEqual(manifest.referenceDataTables, ['private.queue_timezone_catalog', 'public.admin_subscription_plans',
    'public.available_permissions', 'public.help_articles', 'public.home_publications']);
  if (manifest.catalogOptions?.excludeLocalCron) assert.equal(manifest.catalogOptions.reason, 'pg_cron is installed only in its configured database; local clone has no cron scheduler');
  return manifest;
}

export async function readBaseline(repositoryRoot, filename) {
  const manifestPath = await fs.realpath(filename);
  const approvedDirectory = await fs.realpath(path.join(repositoryRoot, 'supabase/reconciliation/local-bootstrap'));
  assert.equal(path.dirname(manifestPath).toLowerCase(), approvedDirectory.toLowerCase(), 'Baseline manifest must be in the reviewed local-bootstrap directory.');
  const manifest = validateManifest(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
  const lock = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'supabase/migrations.source-lock.json'), 'utf8'));
  assert.equal(lock.algorithm, 'sha256-utf8-lf-v1');
  const files = (await fs.readdir(path.join(repositoryRoot, 'supabase/migrations'))).filter(file => FILE.test(file)).sort();
  assert.deepEqual(files.slice(0, manifest.sourceChain.length), manifest.sourceChain.map(row => row.file), 'Baseline must cover an exact canonical prefix.');
  assert.deepEqual(lock.migrations.slice(0, manifest.sourceChain.length), manifest.sourceChain, 'Canonical source-lock differs from the baseline reviewed prefix.');
  await mapInBatches(manifest.sourceChain, async row => {
    const source = normalize(await fs.readFile(path.join(repositoryRoot, 'supabase/migrations', row.file), 'utf8'));
    assert.equal(sha256(source), row.sha256, `Archived canonical migration changed: ${row.file}`);
  });
  const artifacts = await mapInBatches(manifest.artifacts, async row => {
    const artifactPath = await fs.realpath(path.join(approvedDirectory, row.file));
    assert.ok(artifactPath.toLowerCase().startsWith(`${approvedDirectory.toLowerCase()}${path.sep}`), 'Artifact symlink escapes the reviewed directory.');
    const source = await fs.readFile(artifactPath, 'utf8');
    assert.equal(sha256(normalize(source)), row.sha256, `Baseline artifact changed: ${row.file}`);
    assert.ok(source.trim().length > 0);
    return { ...row, source };
  });
  const forwards = await mapInBatches(files.slice(manifest.sourceChain.length), async file => {
    const source = normalize(await fs.readFile(path.join(repositoryRoot, 'supabase/migrations', file), 'utf8'));
    const digest = sha256(source);
    assert.equal(lock.migrations.find(row => row.file === file)?.sha256, digest, `Unreviewed forward migration: ${file}`);
    return { file, sha256: digest, source };
  });
  return { manifest, artifacts, forwards };
}
