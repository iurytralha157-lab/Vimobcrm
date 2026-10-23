import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error -- Node's type-stripping runner needs the extension.
import { collectContactExportPages, prepareContactExportDownload } from './contact-export-pages.ts';

type Row = { id: string };
const rows = (start: number, length: number): Row[] => Array.from({ length }, (_, index) => ({ id: String(start + index) }));

test('collects every page and performs a final version check after generation', async () => {
  const calls: Array<{ page: number; limit: number; expectedExportVersion?: string }> = [];
  const result = await collectContactExportPages<Row>({ fetchPage: async (query) => {
    calls.push(query);
    return { ...query, total: 501, exportVersion: 'stable', data: query.limit === 1 ? rows(1, 1) : query.page === 1 ? rows(1, 500) : rows(501, 1) };
  } });
  assert.equal(result.contacts.length, 501);
  const file = await prepareContactExportDownload(async () => 'generated', result.verifyVersion);
  assert.equal(file, 'generated');
  assert.deepEqual(calls, [{ page: 1, limit: 500, expectedExportVersion: undefined }, { page: 2, limit: 500, expectedExportVersion: 'stable' }, { page: 1, limit: 1, expectedExportVersion: 'stable' }]);
});

test('rejects offset churn even when the new total matches the accumulated length', async () => {
  await assert.rejects(collectContactExportPages<Row>({ fetchPage: async (query) => ({ ...query, total: query.page === 1 ? 1_000 : 999, exportVersion: query.page === 1 ? 'before' : 'after', data: query.page === 1 ? rows(1, 500) : rows(502, 499) }) }), /lista de contatos mudou/);
});

test('rejects changed membership even when the total stays equal', async () => {
  await assert.rejects(collectContactExportPages<Row>({ fetchPage: async (query) => ({ ...query, total: 501, exportVersion: query.page === 1 ? 'before' : 'after', data: query.page === 1 ? rows(1, 500) : rows(999, 1) }) }), /lista de contatos mudou/);
});

test('rejects duplicate IDs instead of silently hiding pagination inconsistency', async () => {
  await assert.rejects(collectContactExportPages<Row>({ fetchPage: async (query) => ({ ...query, total: 501, exportVersion: 'stable', data: query.page === 1 ? rows(1, 500) : rows(500, 1) }) }), /lista de contatos mudou/);
});

test('fails closed if the backend supplies no version, including empty pages', async () => {
  await assert.rejects(collectContactExportPages<Row>({ fetchPage: async (query) => ({ ...query, total: 0, data: [] }) }), /integridade/);
});

test('handles a valid empty envelope without inventing a row count', async () => {
  const result = await collectContactExportPages<Row>({ fetchPage: async (query) => ({ ...query, total: 0, exportVersion: 'empty', data: [] }) });
  assert.deepEqual(result.contacts, []);
});

test('cancel during file serialization never returns a downloadable file', async () => {
  const controller = new AbortController();
  let finish!: (value: string) => void;
  const generated = new Promise<string>((resolve) => { finish = resolve; });
  let validated = false;
  const promise = prepareContactExportDownload(() => generated, async () => { validated = true; }, controller.signal);
  controller.abort();
  finish('file');
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(validated, false);
});

test('a final set change prevents returning the generated file', async () => {
  let calls = 0;
  const result = await collectContactExportPages<Row>({ fetchPage: async (query) => ({ ...query, total: 1, exportVersion: ++calls === 1 ? 'before' : 'after', data: rows(1, 1) }) });
  await assert.rejects(prepareContactExportDownload(async () => 'file', result.verifyVersion), /lista de contatos mudou/);
});

test('cancel during final verification never returns a downloadable file', async () => {
  const controller = new AbortController();
  await assert.rejects(prepareContactExportDownload(async () => 'file', async () => { controller.abort(); }, controller.signal), { name: 'AbortError' });
});

test('cancel while fetching prevents accepting the response', async () => {
  const controller = new AbortController();
  await assert.rejects(collectContactExportPages<Row>({ signal: controller.signal, fetchPage: async (query) => {
    controller.abort();
    return { ...query, total: 1, exportVersion: 'stable', data: rows(1, 1) };
  } }), { name: 'AbortError' });
});
