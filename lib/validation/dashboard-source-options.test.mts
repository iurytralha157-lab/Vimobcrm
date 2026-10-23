import assert from 'node:assert/strict';
import test from 'node:test';

const { leadMetaFiltersResponseSchema } = await import(new URL('./pipelines.ts', import.meta.url).href);

test('imported long origins do not invalidate the entire Dashboard filter catalog', () => {
  const importedSource = `Importação histórica — ${'Campanha São Paulo '.repeat(30)}`.trim();
  const sources = [importedSource, 'origem legada '.repeat(500).trim(), ...Array.from({ length: 545 }, (_, index) => `origem-${index}`)];
  const response = leadMetaFiltersResponseSchema.parse({
    data: { sources, campaigns: [], adsets: [], ads: [] },
  });
  assert.deepEqual(response.data.sources, sources);
});
