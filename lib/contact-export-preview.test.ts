import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error -- Node's type-stripping runner needs the extension.
import { getContactExportFilterPreview } from './contact-export-preview.ts';

test('preview includes values for arrays, assignments and business status', () => {
  const result = getContactExportFilterPreview({ teamId: 'team-a', campaignIds: ['campaign-a', 'campaign-b'], dealStatus: 'won', unassigned: true, search: 'Ana' }, { teamId: 'Equipe Centro', campaignIds: 'Campanha A, Campanha B' });
  assert.deepEqual(result, [
    { key: 'teamId', label: 'Equipe', value: 'Equipe Centro' },
    { key: 'campaignIds', label: 'Campanhas', value: 'Campanha A, Campanha B' },
    { key: 'dealStatus', label: 'Status do negócio', value: 'Ganho' },
    { key: 'unassigned', label: 'Sem responsável', value: 'Sim' },
    { key: 'search', label: 'Busca', value: 'Ana' },
  ]);
});

test('preview omits inactive filters and keeps exact fallback values', () => {
  assert.deepEqual(getContactExportFilterPreview({ unassigned: false, tagIds: [], source: 'custom-origin', createdFrom: 'invalid-date' }), [
    { key: 'source', label: 'Origem', value: 'custom-origin' },
    { key: 'createdFrom', label: 'Data inicial', value: 'invalid-date' },
  ]);
});
