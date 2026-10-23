import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createImportTagResolver, importTagOutcomeUnknown, resolveImportRowTagsIfValid } from './import-contacts-validation';

const dialogSource = readFileSync(
  new URL('./ImportContactsDialog.tsx', import.meta.url),
  'utf8',
);

test('does not mutate tags for an import row that already failed validation', async () => {
  let mutations = 0;

  const result = await resolveImportRowTagsIfValid(
    ['Telefone inválido'],
    async () => {
      mutations += 1;
      return ['created-tag-id'];
    },
  );

  assert.equal(result, undefined);
  assert.equal(mutations, 0);
});

test('resolves tags for a valid import row', async () => {
  let mutations = 0;

  const result = await resolveImportRowTagsIfValid([], async () => {
    mutations += 1;
    return ['existing-tag-id'];
  });

  assert.deepEqual(result, ['existing-tag-id']);
  assert.equal(mutations, 1);
});

test('import dialog places tag creation behind the validated-row gate', () => {
  const leadValidationIndex = dialogSource.indexOf('leadCreateInputSchema.safeParse');
  const tagGateIndex = dialogSource.indexOf(
    'resolveImportRowTagsIfValid(validationErrors, async () => {',
  );
  const tagMutationIndex = dialogSource.indexOf('resolveTagIds(tagNames)', tagGateIndex);

  assert.ok(leadValidationIndex >= 0, 'lead validation must run before tag resolution');
  assert.ok(tagGateIndex > leadValidationIndex, 'tag gate must run after lead validation');
  assert.ok(tagMutationIndex > tagGateIndex, 'tag creation must remain inside the validated-row gate');
});

const tag = { id: 'tag-id', name: 'Quente', organization_id: 'org-a' };

test('409 tag creation reconciles the fresh catalog and reuses the existing ID', async () => {
  let creates = 0;
  const resolve = createImportTagResolver('org-a', [], {
    create: async () => { creates += 1; throw Object.assign(new Error('Already exists'), { code: 'tag_already_exists' }); },
    load: async () => [tag],
  });
  assert.deepEqual(await resolve(['Quente']), ['tag-id']);
  assert.deepEqual(await resolve(['quente']), ['tag-id']);
  assert.equal(creates, 1);
});

test('an uncertain create is never replayed; a later read can confirm it', async () => {
  let creates = 0;
  let found = false;
  const resolve = createImportTagResolver('org-a', [], {
    create: async () => { creates += 1; throw Object.assign(new Error('Timeout'), { code: 'api_timeout', status: 0 }); },
    load: async () => found ? [tag] : [],
  });
  await assert.rejects(resolve(['Quente']), /sem confirmação/);
  await assert.rejects(resolve(['Quente']), /sem confirmação/);
  found = true;
  assert.deepEqual(await resolve(['Quente']), ['tag-id']);
  assert.equal(creates, 1);
});

test('temporary catalog failures do not permanently mark a tag unavailable', async () => {
  let reads = 0;
  const resolve = createImportTagResolver('org-a', [], {
    create: async () => { throw Object.assign(new Error('Exists'), { code: 'tag_already_exists' }); },
    load: async () => { reads += 1; if (reads === 1) throw new Error('Temporary read failure'); return [tag]; },
  });
  await assert.rejects(resolve(['Quente']), /Temporary/);
  assert.deepEqual(await resolve(['Quente']), ['tag-id']);
});

test('tag resolution rejects foreign-organization and ambiguous catalog entries', () => {
  const adapter = { create: async () => tag, load: async () => [tag] };
  assert.throws(() => createImportTagResolver('org-b', [tag], adapter), /outra organização/);
  assert.throws(() => createImportTagResolver('org-a', [tag, { ...tag, id: 'tag-other', name: 'quente' }], adapter), /duplicados/);
});

test('invalid tag responses and aborted writes remain uncertain, while input rejection is confirmed', () => {
  assert.equal(importTagOutcomeUnknown({ code: 'domain_validation_error', direction: 'response' }), true);
  assert.equal(importTagOutcomeUnknown({ code: 'domain_validation_error', direction: 'input' }), false);
  assert.equal(importTagOutcomeUnknown(new DOMException('Aborted', 'AbortError')), true);
});
