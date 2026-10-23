import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const contactsScreen = readFileSync(
  new URL('../ContactsScreen.tsx', import.meta.url),
  'utf8',
);
const sharedFilters = readFileSync(
  new URL('../../../shared/SharedFilters.tsx', import.meta.url),
  'utf8',
);
const sharedUserFilter = readFileSync(
  new URL('../../../shared/SharedUserFilter.tsx', import.meta.url),
  'utf8',
);

test('contacts exposes the unassigned filter without narrowing all pipelines', () => {
  assert.match(contactsScreen, /includeUnassignedUserOption:\s*true/);
  assert.match(
    contactsScreen,
    /pipelineId:\s*selectedPipeline !== "all" \? selectedPipeline : null/,
  );
  assert.doesNotMatch(contactsScreen, /useFilterOptionsPipelineId/);
  assert.match(sharedFilters, /<SharedUserFilter[\s\S]{0,200}value=\{userId\} onChange=\{onUserChange\}/);
  assert.match(sharedFilters, /includeUnassigned=\{includeUnassignedUserOption\}/);
  assert.match(sharedUserFilter, /includeUnassigned &&[\s\S]{0,200}choose\("unassigned"\)/);
  assert.match(sharedFilters, /userId === "unassigned"/);
});
