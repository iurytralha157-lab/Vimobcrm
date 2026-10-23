import assert from 'node:assert/strict';
import { classifyBlock, safeObjectRecord, validateCloudTarget } from './cloud-baseline-contract.mjs';
import { inventoryDump } from './cloud-baseline-plan.mjs';
import { normalize, sha256 } from '../supabase/local-schema-baseline-contract.mjs';
import { statements, values, assertDDL, isReviewedPrologue, isReviewedStorageSetting, assertReferenceInsert } from './cloud-export-sql.mjs';

const EXTENSIONS = new Map([['btree_gist', 'extensions'], ['pg_graphql', 'graphql'],
  ['pg_net', 'extensions'], ['pg_stat_statements', 'extensions'], ['pg_trgm', 'extensions'],
  ['pgcrypto', 'extensions'], ['supabase_vault', 'vault'], ['uuid-ossp', 'extensions']]);
const literal = value => `'${value.replaceAll("'", "''")}'`;

export function rehearsalGuard(target, database) {
  return `BEGIN;
SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';
SET LOCAL transaction_timeout = '180s';
SET LOCAL standard_conforming_strings = on;
SET LOCAL search_path = pg_catalog;
SET LOCAL check_function_bodies = false;
SET LOCAL default_tablespace = '';
SET LOCAL default_table_access_method = heap;
DO $vimob_guard$ BEGIN
  IF current_user <> 'postgres' OR (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN
    RAISE EXCEPTION 'cloud_draft_requires_postgres_non_superuser';
  END IF;
  IF current_database() <> ${literal(database)} OR current_setting('vimob.staging_project_ref',true) IS DISTINCT FROM ${literal(target.projectRef)} THEN
    RAISE EXCEPTION 'cloud_draft_rehearsal_identity_mismatch';
  END IF;
  IF current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'cloud_draft_requires_postgresql_17';
  END IF;
END $vimob_guard$;
`;
}

function defaultPrelude() {
  const validation = `DO $vimob_defaults$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole
    WHERE r.rolname='postgres' AND d.defaclnamespace=0) THEN
    RAISE EXCEPTION 'unexpected_postgres_global_defaults_require_review';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole
    JOIN pg_namespace n ON n.oid=d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE r.rolname='postgres' AND n.nspname IN ('public','private')
      AND (d.defaclobjtype NOT IN ('r','S','f','T') OR
        (a.grantee<>0 AND pg_get_userbyid(a.grantee) NOT IN ('postgres','anon','authenticated','service_role')))) THEN
    RAISE EXCEPTION 'unexpected_scoped_defaults_require_review';
  END IF;
END $vimob_defaults$;
`;
  return validation + ['public', 'private'].flatMap(schema => ['TABLES', 'SEQUENCES', 'FUNCTIONS', 'TYPES'].map(kind =>
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ${schema} REVOKE ALL ON ${kind} FROM PUBLIC,postgres,anon,authenticated,service_role;`)).join('\n') + '\n';
}

const emptyDomainGuard = `DO $vimob_empty$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private'))
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private'))
    OR EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ('public','private'))
    OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='private') THEN
    RAISE EXCEPTION 'cloud_draft_requires_fresh_application_domain';
  END IF;
END $vimob_empty$;
`;

const nativePublicationGuard = `DO $vimob_publication$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime'
    AND pg_get_userbyid(pubowner)='postgres' AND NOT puballtables
    AND pubinsert AND pubupdate AND pubdelete AND pubtruncate AND NOT pubviaroot)
    OR EXISTS (SELECT 1 FROM pg_publication_rel r JOIN pg_publication p ON p.oid=r.prpubid WHERE p.pubname='supabase_realtime') THEN
    RAISE EXCEPTION 'native_realtime_publication_requires_review';
  END IF;
END $vimob_publication$;
`;

export function buildCloudExport(source, { target, rehearsalDatabase }) {
  validateCloudTarget(target);
  assert.match(rehearsalDatabase, /^vimob_cloud_rehearsal_[a-z0-9_]{1,40}$/);
  const groups = { domain: [], auth: [], storage: [], realtime: [], extensions: [] };
  const preserved = [], declarations = [], references = [], counts = {};
  for (const artifact of source.artifacts) {
    assert.equal(sha256(normalize(artifact.source)), artifact.sha256, 'Artifact changed after source verification.');
    if (artifact.kind !== 'schema') continue;
    const blocks = inventoryDump(artifact.source, artifact.file);
    for (const statement of statements(normalize(artifact.source).slice(0, blocks[0].start))) {
      assert.ok(isReviewedPrologue(statement), 'Unexpected dump/session preamble.');
    }
    for (const block of blocks) {
      const schemaACL = block.schema === '-' && block.type === 'ACL' && ['SCHEMA public', 'SCHEMA private'].includes(block.name);
      if (schemaACL) assert.equal(block.owner, block.name === 'SCHEMA public' ? 'pg_database_owner' : 'postgres', 'Unexpected application schema ACL owner.');
      const classification = schemaACL ? 'domain-candidate' : classifyBlock(block);
      if (classification === 'domain-candidate') {
        let exportSource = block.source;
        for (const statement of statements(block.source)) {
          if (isReviewedStorageSetting(statement)) exportSource = exportSource.replace(statement.source, '');
          else {
            try { assertDDL(statement, ['public', 'private']); }
            catch { throw new Error(`Unexpected domain DDL in ${block.artifact}:${block.line}, TOC type ${block.type}.`); }
          }
        }
        groups.domain.push({ ...block, exportSource });
      } else if (classification === 'cloud-extension-prerequisite') {
        const sql = statements(block.source);
        assert.equal(sql.length, 1, 'Unexpected extension block contents.');
        assert.deepEqual(values(sql[0]), ['create', 'extension', 'if', 'not', 'exists', block.name, 'with', 'schema', EXTENSIONS.get(block.name)],
          'Only reviewed unpinned extension declarations are accepted.');
        groups.extensions.push(block);
      } else if (classification === 'platform-overlay-review') {
        if (block.type === 'PUBLICATION') {
          assert.equal(block.name, 'supabase_realtime'); declarations.push(block); continue;
        }
        const category = block.type === 'PUBLICATION TABLE' ? 'realtime' : block.schema;
        assert.ok(['auth', 'storage', 'realtime'].includes(category));
        for (const statement of statements(block.source)) {
          assertDDL(statement, block.type === 'PUBLICATION TABLE' ? ['public', 'private'] : [block.schema], { overlay: true });
        }
        groups[category].push(block);
      } else preserved.push(safeObjectRecord(block));
    }
  }
  assert.equal(declarations.length, 1, 'Expected the reviewed native publication declaration.');
  assert.deepEqual(groups.extensions.map(block => block.name).sort(), [...EXTENSIONS.keys()].sort());
  const privateSchemas = groups.domain.filter(block => block.type === 'SCHEMA');
  assert.equal(privateSchemas.length, 1); assert.equal(privateSchemas[0].name, 'private');
  const referenceArtifacts = source.artifacts.filter(row => row.kind === 'reference-data');
  assert.equal(referenceArtifacts.length, 1);
  for (const statement of statements(normalize(referenceArtifacts[0].source))) {
    if (isReviewedPrologue(statement)) continue;
    const table = assertReferenceInsert(statement, source.manifest.referenceDataTables);
    counts[table] = (counts[table] ?? 0) + 1; references.push(statement.source);
  }
  assert.deepEqual(Object.keys(counts).sort(), [...source.manifest.referenceDataTables].sort());
  const files = {};
  const emit = (filename, text) => { files[filename] = `${rehearsalGuard(target, rehearsalDatabase)}${text}\nCOMMIT;\n`; };
  emit('00-extension-proposals.sql', groups.extensions.map(block => block.source).join('\n'));
  let chunk = emptyDomainGuard + privateSchemas[0].exportSource + '\n' + defaultPrelude(), ordinal = 1;
  const flushDomain = () => { emit(`10-domain-${String(ordinal++).padStart(3, '0')}.sql`, chunk); chunk = ''; };
  for (const block of groups.domain.filter(block => block !== privateSchemas[0])) {
    assert.ok(Buffer.byteLength(block.exportSource) <= 480_000, 'A single domain TOC block exceeds the reviewed phase limit.');
    if (Buffer.byteLength(chunk) + Buffer.byteLength(block.exportSource) > 480_000) flushDomain();
    chunk += `${block.exportSource}\n`;
  }
  if (chunk) flushDomain();
  emit('20-auth-overlay.sql', groups.auth.map(block => block.source).join('\n'));
  emit('21-storage-overlays.sql', groups.storage.map(block => block.source).join('\n'));
  emit('22-realtime-overlays.sql', nativePublicationGuard + groups.realtime.map(block => block.source).join('\n'));
  emit('30-static-reference-data.sql', references.join('\n'));
  const manifest = {
    kind: 'vimob-cloud-baseline-draft-export-v1', classification: 'local-rehearsal-draft-only',
    ready: false, remoteApplySupported: false, target, rehearsalDatabase,
    historicalMigrationsExecuted: false, productionDataIncluded: false,
    source: { baselineId: source.manifest.baselineId, sourceChainSHA256: source.manifest.sourceChainSHA256,
      prefixMigrations: source.manifest.sourceChain.length,
      artifacts: source.artifacts.map(({ file, kind, sha256: hash }) => ({ file, kind, sha256: hash })),
      forwardsPending: source.forwards.map(({ file, sha256: hash }) => ({ file, sha256: hash })) },
    files: Object.entries(files).map(([file, sql]) => ({ file, sha256: sha256(sql), bytes: Buffer.byteLength(sql) })),
    blockCounts: Object.fromEntries(Object.entries(groups).map(([name, blocks]) => [name, blocks.length])),
    staticReferenceInsertCounts: counts, staticReferenceTables: source.manifest.referenceDataTables,
    expectedReferenceDataSHA256: source.manifest.expectedDataSHA256,
    platformBlocksPreserved: preserved.length,
    transformations: [
      'Only reviewed public/private blocks and explicit Auth/Storage/Realtime overlays are emitted; complete raw dumps are never restored. Domain phases split only between TOC blocks below 480KB.',
      'Application function bodies, proconfig, postgres ownership and grants retain original normalized source bytes.',
      'The two schema-level ACL blocks for public/private are explicitly included even though pg_dump records their TOC schema as unscoped; public remains owned by native pg_database_owner.',
      'The original pg_dump session preamble is allowlist-verified and replaced with bounded transaction-local rehearsal settings; psql controls are not emitted.',
      'Only postgres defaults scoped to public/private are reset before object creation; unexpected global defaults are rejected and platform-role defaults remain untouched.',
      'Native supabase_realtime publication is asserted, not recreated; reviewed table membership is emitted separately.',
      'Platform internals, platform wrappers, platform ACLs, migrations ledgers, jobs, Vault data and tenant/user rows are excluded.',
      'Extension proposals have no VERSION pinning; pg_cron is not inferred as an installation requirement from absence in this local baseline.',
      'The literal support_email in the receipt issuer snapshot is preserved in the private draft source without printing it; its presence does not establish dispatch.',
    ],
    remainingValidation: ['local non-superuser restore', 'effective ACL/owner/grantor and domain catalog comparison',
      'reference-data verification and absence of side-effect rows', 'canonical forward execution', 'Cloud permission and platform differences', 'application acceptance tests'],
  };
  return { manifest, files };
}
