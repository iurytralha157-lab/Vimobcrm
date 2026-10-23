import assert from 'node:assert/strict';
import path from 'node:path';
import { readBaseline, sha256 } from '../supabase/local-schema-baseline-contract.mjs';

export const PRODUCTION_PROJECT_REF = 'iemalzlfnbouobyjwlwi';
export const PLATFORM_SCHEMAS = new Set(['_realtime', 'auth', 'extensions', 'graphql',
  'graphql_public', 'net', 'pg_catalog', 'pgbouncer', 'realtime', 'storage', 'supabase_functions', 'vault']);
const TYPES = new Set(['ACL', 'CHECK CONSTRAINT', 'COMMENT', 'CONSTRAINT', 'DEFAULT', 'DEFAULT ACL',
  'EVENT TRIGGER', 'EXTENSION', 'FK CONSTRAINT', 'FUNCTION', 'INDEX', 'INDEX ATTACH', 'POLICY',
  'PUBLICATION', 'PUBLICATION TABLE', 'ROW SECURITY', 'SCHEMA', 'SEQUENCE', 'SEQUENCE OWNED BY',
  'TABLE', 'TABLE ATTACH', 'TRIGGER', 'TYPE', 'VIEW']);
const OWNERS = new Set(['-', '', 'postgres', 'pg_database_owner', 'pgbouncer', 'supabase_admin',
  'supabase_auth_admin', 'supabase_functions_admin', 'supabase_realtime_admin', 'supabase_storage_admin']);
const OVERLAYS = new Set([
  'auth|TRIGGER|users on_auth_user_created',
  'realtime|POLICY|messages whatsapp_authorized_private_broadcast',
  'realtime|POLICY|messages whatsapp_broadcast_requires_active_session',
  'storage|POLICY|objects Users manage own avatar',
  'storage|POLICY|objects automation admins manage media',
  'storage|POLICY|objects contract_docs_delete',
  'storage|POLICY|objects contract_docs_insert',
  'storage|POLICY|objects contract_docs_select',
  'storage|POLICY|objects org admins manage logo assets',
  'storage|POLICY|objects org admins manage site images',
  'storage|POLICY|objects whatsapp media backend-only boundary',
]);

export function validateCloudTarget(target) {
  assert.ok(target && typeof target === 'object' && !Array.isArray(target), 'Target must be an object.');
  assert.deepEqual(Object.keys(target).sort(), ['environment', 'kind', 'projectRef', 'supabaseUrl']);
  assert.equal(target.kind, 'vimob-cloud-staging-target-v1');
  assert.equal(target.environment, 'staging', 'Only an explicitly marked staging target is accepted.');
  assert.match(target.projectRef, /^[a-z]{20}$/, 'A new Supabase Cloud project reference is required.');
  assert.notEqual(target.projectRef, PRODUCTION_PROJECT_REF, 'Production project is forbidden.');
  assert.equal(target.supabaseUrl, `https://${target.projectRef}.supabase.co`,
    'Only the exact Cloud HTTPS origin matching the selected project is accepted.');
  return { kind: target.kind, environment: target.environment, projectRef: target.projectRef, supabaseUrl: target.supabaseUrl };
}

export async function loadCloudSource(repositoryRoot) {
  // This reuses only the immutable source validator, never the local executor.
  return readBaseline(repositoryRoot, path.join(repositoryRoot,
    'supabase/reconciliation/local-bootstrap/baseline-20261016.json'));
}

export function classifyBlock(block) {
  const { schema, type, name, owner } = block;
  assert.ok(TYPES.has(type), 'Unknown dump object type requires explicit review.');
  assert.ok(OWNERS.has(owner), 'Unknown dump owner requires explicit review.');
  if (type === 'PUBLICATION' || type === 'PUBLICATION TABLE') {
    assert.equal(owner, 'postgres', 'Application publication owner must be postgres.');
    assert.ok(schema === '-' || schema === 'public' || schema === 'private', 'Unknown publication schema.');
    return 'platform-overlay-review';
  }
  if (schema === 'public' || schema === 'private') {
    if (type === 'DEFAULT ACL' && owner === 'supabase_admin') return 'managed-platform-preserved';
    assert.equal(owner, 'postgres', 'Application objects must be owned by postgres.');
    return 'domain-candidate';
  }
  if (OVERLAYS.has(`${schema}|${type}|${name}`)) return 'platform-overlay-review';
  if (PLATFORM_SCHEMAS.has(schema)) {
    if ((schema === 'storage' || schema === 'realtime') && type === 'POLICY') {
      assert.fail('Unknown managed-schema policy requires explicit review.');
    }
    if (schema === 'auth' && type === 'TRIGGER') assert.fail('Unknown Auth trigger requires explicit review.');
    return 'managed-platform-preserved';
  }
  assert.equal(schema, '-', 'Unknown schema requires explicit review.');
  if (type === 'SCHEMA') {
    if (name === 'private') {
      assert.equal(owner, 'postgres');
      return 'domain-candidate';
    }
    assert.ok(PLATFORM_SCHEMAS.has(name), 'Unknown schema declaration requires explicit review.');
    return 'managed-platform-preserved';
  }
  if (type === 'EXTENSION') return 'cloud-extension-prerequisite';
  assert.ok(type === 'COMMENT' || type === 'EVENT TRIGGER' || type === 'ACL',
    'Unscoped dump object requires explicit review.');
  return 'managed-platform-preserved';
}

export function safeObjectRecord(block) {
  return { artifact: block.artifact, line: block.line, schema: block.schema,
    type: block.type, name: block.name, owner: block.owner, sha256: sha256(block.source) };
}
