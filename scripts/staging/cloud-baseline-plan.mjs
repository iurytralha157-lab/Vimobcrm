import assert from 'node:assert/strict';
import { classifyBlock, safeObjectRecord, validateCloudTarget } from './cloud-baseline-contract.mjs';
import { sha256, digestJSON, normalize } from '../supabase/local-schema-baseline-contract.mjs';

// TOC inventory only. This function deliberately cannot emit executable SQL.
// The complete artifacts are hash-verified before the caller inventories them.
export function inventoryDump(source, artifact) {
  const text = normalize(source), headers = [];
  let index = 0, line = 1, quote = null, escapes = false, dollar = null, blockDepth = 0;
  while (index < text.length) {
    const char = text[index], next = text[index + 1];
    if (char === '\n') { line++; index++; continue; }
    if (dollar) {
      if (text.startsWith(dollar, index)) { index += dollar.length; dollar = null; } else index++;
      continue;
    }
    if (blockDepth) {
      if (char === '/' && next === '*') { blockDepth++; index += 2; }
      else if (char === '*' && next === '/') { blockDepth--; index += 2; } else index++;
      continue;
    }
    if (quote) {
      if (escapes && char === '\\') {
        if (next === '\n') line++;
        index += 2; continue;
      }
      if (char === quote && next === quote) { index += 2; continue; }
      if (char === quote) quote = null;
      index++; continue;
    }
    if (char === '/' && next === '*') { blockDepth = 1; index += 2; continue; }
    if (char === '-' && next === '-') {
      const end = text.indexOf('\n', index), stop = end === -1 ? text.length : end;
      const comment = text.slice(index, stop);
      if ((index === 0 || text[index - 1] === '\n') && comment.startsWith('-- Name: ')) {
        const match = comment.match(/^-- Name: (.*); Type: ([A-Z ]+); Schema: ([^;]*); Owner: (.*)$/);
        assert.ok(match, 'Malformed pg_dump TOC header.');
        headers.push({ start: index, line, name: match[1], type: match[2], schema: match[3], owner: match[4] });
      }
      index = stop; continue;
    }
    if (char === "'" || char === '"') {
      escapes = char === "'" && /[Ee]/.test(text[index - 1] ?? '') && !/[A-Za-z0-9_$]/.test(text[index - 2] ?? '');
      quote = char; index++; continue;
    }
    if (char === '$') {
      const delimiter = text.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (delimiter) { dollar = delimiter; index += delimiter.length; continue; }
    }
    index++;
  }
  assert.ok(!quote && !dollar && !blockDepth, 'Unterminated SQL lexical structure.');
  assert.ok(headers.length > 0, 'Schema dump has no TOC inventory.');
  return headers.map((header, offset) => ({ ...header, artifact,
    source: text.slice(header.start, headers[offset + 1]?.start ?? text.length) }));
}

function literalRisks(block) {
  const risks = [];
  // Never retain the matched values: they can identify operational recipients.
  const emails = [...block.source.matchAll(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)];
  for (const match of emails) {
    const domain = match[0].slice(match[0].lastIndexOf('@') + 1).toLowerCase();
    if (domain === 'example.com' || domain.endsWith('.example') || domain.endsWith('.test')) continue;
    // WhatsApp JID suffixes in normalization expressions are not email recipients.
    if (['s.whatsapp.net', 'c.us', 'g.us'].includes(domain)) continue;
    risks.push({ category: 'OPERATIONAL_EMAIL_LITERAL',
      line: block.line + block.source.slice(0, match.index).split('\n').length - 1 });
  }
  if (/iemalzlfnbouobyjwlwi|(?:app|api|supabase)\.vimobcrm\.com\.br/i.test(block.source)) {
    risks.push({ category: 'PRODUCTION_ENDPOINT_LITERAL', line: block.line });
  }
  return risks.map(risk => ({ ...risk, artifact: block.artifact, schema: block.schema, object: block.name }));
}

export function buildCloudPlan(source, target = null) {
  const selectedTarget = target ? validateCloudTarget(target) : null;
  const groups = { 'domain-candidate': [], 'managed-platform-preserved': [],
    'platform-overlay-review': [], 'cloud-extension-prerequisite': [] };
  const review = [], risks = [];
  for (const artifact of source.artifacts) {
    assert.equal(sha256(normalize(artifact.source)), artifact.sha256, 'Artifact bytes changed after source validation.');
  }
  for (const artifact of source.artifacts.filter(row => row.kind === 'schema')) {
    for (const block of inventoryDump(artifact.source, artifact.file)) {
      const record = safeObjectRecord(block);
      try { groups[classifyBlock(block)].push(record); }
      catch (error) { review.push({ ...record, reason: error.message }); }
      if (block.type === 'FUNCTION' && (block.schema === 'public' || block.schema === 'private')) {
        risks.push(...literalRisks(block));
      }
    }
  }
  for (const forward of source.forwards) {
    assert.equal(sha256(normalize(forward.source)), forward.sha256, 'Forward bytes changed after source validation.');
    risks.push(...literalRisks({ source: forward.source, artifact: forward.file, line: 1,
      schema: 'forward-migration', name: forward.file }));
  }
  const blockers = [
    { code: 'CLOUD_PLATFORM_COMPARISON_REQUIRED', action: 'Compare native Cloud Auth/Storage/Realtime interfaces, extensions and required grants without restoring platform-owned objects.' },
    { code: 'POSTGRES_PRIVILEGE_REHEARSAL_REQUIRED', action: 'Rehearse the derived application SQL and managed-schema overlays with the actual non-superuser permissions; do not reuse the local superuser executor.' },
    { code: 'PROJECTED_CATALOG_VERIFICATION_REQUIRED', action: 'Create and verify an application-only catalog including owners, effective ACLs, RLS, policies, triggers and publication membership. The full local platform hash is not a Cloud compatibility claim.' },
    { code: 'FORWARD_CLOUD_COMPATIBILITY_REVIEW_REQUIRED', action: 'Review every post-baseline migration for Cloud permissions, platform DDL and operational effects before execution. Source-lock integrity alone is not a compatibility check.' },
    { code: 'STAGING_SERVICES_CONFIGURATION_REQUIRED', action: 'Create empty test buckets, dedicated Auth URLs/accounts, and an explicit Edge Functions allowlist; leave cron, Vault provider secrets and external workers unprovisioned.' },
    { code: 'NO_EXECUTABLE_CLOUD_EXPORTER', action: 'Review the inventory and write a separately tested Cloud exporter/installer before applying SQL. This command only emits a JSON preparation plan.' },
  ];
  if (!selectedTarget) blockers.unshift({ code: 'TARGET_NOT_SELECTED', action: 'Select a new Cloud staging project; provide only its public reference and matching HTTPS origin.' });
  if (review.length) blockers.push({ code: 'UNKNOWN_OBJECTS_REQUIRE_REVIEW', count: review.length,
    action: 'Review unknown dump types, owners, schemas or managed policies explicitly; no fallback includes them.' });
  if (risks.length) blockers.push({ code: 'OPERATIONAL_LITERALS_REQUIRE_ISOLATION', count: risks.length,
    action: 'Review the listed functions. A derived staging override must remove operational recipients/destinations or permanently prevent their dispatch before enabling any worker; preserve canonical artifact hashes.' });
  return {
    kind: 'vimob-cloud-staging-baseline-plan-v1', classification: 'offline-preparation-only',
    ready: false, databaseAccessed: false, executableSQLIncluded: false, applySupported: false,
    historicalMigrationsExecuted: false, productionDataIncluded: false, target: selectedTarget,
    source: { baselineId: source.manifest.baselineId, prefixMigrations: source.manifest.sourceChain.length,
      sourceChainSHA256: source.manifest.sourceChainSHA256,
      artifacts: source.artifacts.map(({ file, kind, sha256: hash }) => ({ file, kind, sha256: hash })),
      forwards: source.forwards.map(({ file, sha256: hash }) => ({ file, sha256: hash })),
      referenceTables: source.manifest.referenceDataTables,
      expectedReferenceDataSHA256: source.manifest.expectedDataSHA256 },
    projectionSHA256: digestJSON(groups), counts: Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.length])),
    projection: groups, unknownObjects: review, literalRisks: risks, blockers,
    excludedData: ['tenants', 'leads', 'users', 'sessions', 'provider credentials', 'Vault secrets', 'cron jobs', 'Storage objects', 'outboxes', 'worker state'],
    supplementalArtifactsPreserved: source.artifacts.filter(row => row.kind === 'extension-binding').map(({ file, sha256: hash }) => ({ file, sha256: hash,
      decision: 'Do not replay local platform wrappers, extension internals or platform ACLs on Cloud.' })),
    planSHA256: sha256(JSON.stringify({ groups, review, risks, target: selectedTarget })),
  };
}
