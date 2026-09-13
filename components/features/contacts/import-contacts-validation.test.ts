import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { resolveImportRowTagsIfValid } from './import-contacts-validation';

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
  const tagMutationIndex = dialogSource.indexOf('createTag.mutateAsync', tagGateIndex);

  assert.ok(leadValidationIndex >= 0, 'lead validation must run before tag resolution');
  assert.ok(tagGateIndex > leadValidationIndex, 'tag gate must run after lead validation');
  assert.ok(tagMutationIndex > tagGateIndex, 'tag creation must remain inside the validated-row gate');
});
