import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { leadCreateInputSchema, leadUpdateInputSchema, apiCreateLeadResponseSchema, apiLeadResponseSchema } from '../../lib/validation/leads.ts';
import { assertLeadFinancialFields } from '../../lib/validation/lead-financial-values.ts';
import { parseDomainInput, validateDomainResponse } from '../../lib/validation/common.ts';
import { toQueuePool } from '../../lib/queue-pool.ts';
import { buildLeadEditFields, changedLeadFields } from '../../lib/lead-edit-session.ts';
import { replaceOwnedPropertyDraft, rollbackLeadPropertySelection } from '../../components/features/leads/lead-detail/property-selection-rollback.ts';
import { mergeLeadDetailMutation } from '../../components/features/leads/lead-detail/hydrate-lead-detail.ts';
import { deferred, evaluateProduction, leadHookRuntime, productionDeclaration, turn } from './lead-request-runtime-fixture.mjs';

const ID = '30000000-0000-4000-8000-000000000001', ORG = '30000000-0000-4000-8000-000000000002';
const hookSource = process.env.LEAD_FINANCIAL_HOOK_SOURCE || 'hooks/use-leads.ts';
function api() {
  const requests = [];
  const source = ts.createSourceFile('leads.ts', readFileSync('lib/api/leads.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const body = source.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)).map(node => node.getText(source)).join('\n');
  const lead = { id: ID, organizationId: ORG, name: 'Synthetic', source: 'manual', status: 'new', dealStatus: 'open',
    priority: 'normal', reentryCount: 0, createdAt: '2026-10-19T12:00:00Z', updatedAt: '2026-10-19T12:00:00Z' };
  const value = evaluateProduction(body, { leadCreateInputSchema, leadUpdateInputSchema, apiCreateLeadResponseSchema, apiLeadResponseSchema,
    parseDomainInput, validateDomainResponse, toQueuePool, captureCurrentLeadRequestIntent: intent => intent,
    vimobAPIRequest: async (url, options) => {
      requests.push({ url, options });
      return { data: { ...lead, interestValue: options.body.interestValue ?? undefined, commissionPercentage: options.body.commissionPercentage ?? undefined }, leadId: ID, leadVisible: true };
    },
  }, 'leadsAPI');
  return { requests, value };
}

for (const value of [NaN, Infinity, -Infinity, -1, '-1e-999', '1e-999', '0x10', '1'.repeat(41)]) {
  test(`actual API rejects invalid amount before POST/PATCH: ${String(value)}`, async () => {
    const r = api(), input = { name: 'Synthetic', valor_interesse: value }, before = structuredClone(input);
    await assert.rejects(r.value.createLead(ORG, input));
    await assert.rejects(r.value.updateLead(ID, { valor_interesse: value }, ORG));
    assert.equal(r.requests.length, 0); assert.deepEqual(input, before);
  });
}
for (const value of [-1, NaN, Infinity, 101, '100.0000000000000000001']) {
  test(`actual API rejects invalid commission before PATCH: ${String(value)}`, async () => {
    const r = api(); await assert.rejects(r.value.updateLead(ID, { commission_percentage: value }, ORG));
    assert.equal(r.requests.length, 0);
  });
}
test('actual API preserves omitted/null/zero and parses immutable detached wire fields', async () => {
  const r = api();
  await r.value.createLead(ORG, { name: 'Synthetic', valor_interesse: 0 });
  assert.equal(r.requests.at(-1).options.body.interestValue, '0');
  await r.value.createLead(ORG, { name: 'Synthetic', valor_interesse: null });
  assert.equal(r.requests.at(-1).options.body.interestValue, undefined);
  for (const value of [null, 0, 12.5]) {
    const input = { valor_interesse: value, commission_percentage: value }, before = structuredClone(input);
    await r.value.updateLead(ID, input, ORG);
    assert.equal(r.requests.at(-1).options.body.interestValue, value == null ? null : String(value));
    assert.equal(r.requests.at(-1).options.body.commissionPercentage, value == null ? null : String(value));
    assert.deepEqual(input, before);
  }
  await r.value.updateLead(ID, { name: 'Contact edit only' }, ORG);
  assert.equal(r.requests.at(-1).options.body.interestValue, undefined);
});

for (const patch of [{ valor_interesse: -1 }, { valor_interesse: NaN }, { valor_interesse: Infinity },
  { commission_percentage: -1 }, { commission_percentage: 101 }, { commission_percentage: Infinity }]) {
  test(`actual mutation denies invalid finance before its cache/write boundary: ${Object.keys(patch)[0]}/${String(Object.values(patch)[0])}`, async () => {
    const r = leadHookRuntime();
    try {
      const observer = new MutationObserver(r.client(), r.render(hookSource, 'useUpdateLead'));
      await assert.rejects(observer.mutate({ id: 'lead-a', ...patch }));
      assert.equal(r.requests.length, 0); assert.equal(r.cachePatches.length, 0); assert.deepEqual(r.events, []);
      assert.equal(r.client().getQueryData(['lead', 'org-a', 'lead-a']), undefined);
    } finally { r.close(); }
  });
}
test('financial-only guard leaves unrelated legacy fields/IDs alone and accepts null/zero', async () => {
  const r = leadHookRuntime();
  try {
    const observer = new MutationObserver(r.client(), r.render(hookSource, 'useUpdateLead'));
    await observer.mutate({ id: 'lead-a', name: 'Synthetic', valor_interesse: 0, commission_percentage: null });
    assert.equal(r.requests.length, 1); assert.equal(r.requests[0].args[1].valor_interesse, 0);
    assert.equal(r.requests[0].args[1].commission_percentage, null);
  } finally { r.close(); }
});

function propertyFixture({ fail = false, wait = false } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), pending = deferred();
  const calls = [], notices = [], requests = [];
  const lead = { id: ID, organization_id: ORG, updated_at: '2026-10-19T12:00:00Z', deal_status: 'open', valor_interesse: 10, commission_percentage: 5 };
  let localLead = lead, editForm = { property_id: '', valor_interesse: '10', commission_percentage: '5' }, current = true;
  const propertySaveOperationRef = { current: null };
  const deps = { assertLeadFinancialFields, lead, localLead, editForm, queryClient: client, activeOrganization: { organizationId: ORG }, profile: null,
    canOperateLead: true, propertySaveOperationRef, contactSaveOperationRef: { current: null },
    captureDetailOperation: () => { calls.push('capture'); return { isCurrent: () => current }; },
    setEditForm: next => { calls.push('draft'); editForm = next(editForm); },
    setLocalLead: next => { calls.push('local'); localLead = next(localLead); },
    updatePipelineLeadCache: (...args) => { calls.push('cache'); return args; }, restorePipelineCache: () => calls.push('restore'),
    appendOptimisticLeadHistoryEvent: () => { calls.push('history'); return 'optimistic'; }, removeOptimisticLeadHistoryEvent: () => calls.push('removeHistory'),
    updateLead: { mutateAsync: async input => { requests.push(input); if (wait) return pending.promise; if (fail) throw Error('Synthetic failure'); return { ...lead, ...input }; } },
    toast: { error: text => notices.push(text), warning: text => notices.push(text) },
    replaceOwnedPropertyDraft, rollbackLeadPropertySelection, mergeLeadDetailMutation,
    requiresWonLeadFinancialReview: () => false, WON_LEAD_FINANCIAL_REVIEW_MESSAGE: 'Financial review',
  };
  const declaration = productionDeclaration(process.env.LEAD_FINANCIAL_DETAIL_SOURCE || 'components/features/leads/LeadDetailDialog.tsx',
    node => ts.isVariableDeclaration(node) && node.name.getText() === 'handleSelectInterestProperty');
  const select = evaluateProduction('const ' + declaration, deps, 'handleSelectInterestProperty');
  return { select, calls, notices, requests, ref: propertySaveOperationRef, lead: () => localLead, draft: () => editForm,
    finish: () => pending.resolve({ ...lead, ...requests[0] }), retire: () => { current = false; }, close: () => client.clear() };
}
for (const patch of [{ preco: -1 }, { preco: NaN }, { preco: Infinity }, { preco: -Infinity }, { preco: '12' },
  { commission_percentage: -1 }, { commission_percentage: 101 }, { commission_percentage: NaN }, { commission_percentage: Infinity }, { commission_percentage: '5' }]) {
  test(`actual property selection blocks invalid snapshot before any optimism: ${String(Object.values(patch)[0])}/${Object.keys(patch)[0]}`, async () => {
    const r = propertyFixture();
    try {
      const property = { id: ID, preco: 50, commission_percentage: 5, ...patch }, before = structuredClone(property);
      await r.select(property); assert.deepEqual(property, before);
      assert.deepEqual(r.calls, []); assert.deepEqual(r.requests, []); assert.equal(r.ref.current, null);
      assert.equal(r.notices.length, 1); assert.equal(r.lead().valor_interesse, 10); assert.equal(r.draft().valor_interesse, '10');
    } finally { r.close(); }
  });
}
for (const [price, commission] of [[0, 0], [null, null], [undefined, undefined], [100.5, 7.5]]) {
  test(`actual property selection preserves price/commission semantics ${String(price)}/${String(commission)}`, async () => {
    const r = propertyFixture();
    try {
      await r.select({ id: ID, preco: price, commission_percentage: commission });
      assert.equal(r.requests.length, 1); assert.equal(r.requests[0].valor_interesse, price ?? null);
      assert.equal(r.requests[0].commission_percentage, commission ?? undefined);
      assert.equal(r.lead().commission_percentage, commission ?? 5); assert.equal(r.ref.current, null);
      assert.equal(r.notices.length, 0);
    } finally { r.close(); }
  });
}
test('valid property rejection restores owned fields, and a late closed ACK skips component hydration', async () => {
  const rejected = propertyFixture({ fail: true });
  try { await rejected.select({ id: ID, preco: 50, commission_percentage: 6 }); assert.equal(rejected.lead().valor_interesse, 10); assert.equal(rejected.draft().valor_interesse, '10'); }
  finally { rejected.close(); }
  const retired = propertyFixture({ wait: true });
  try { const pending = retired.select({ id: ID, preco: 50, commission_percentage: 6 }); await turn(); retired.retire(); const calls = retired.calls.length; retired.finish(); await pending; assert.deepEqual(retired.calls.slice(calls), ['removeHistory']); }
  finally { retired.close(); }
});

test('actual money mask and edit diff preserve zero, blank, typed prices and ordinary contact edits', () => {
  const path = 'components/features/leads/CreateLeadDialog.tsx';
  const formatSource = productionDeclaration(path, node => ts.isFunctionDeclaration(node) && node.name?.text === 'formatCurrencyInput');
  const parseSource = productionDeclaration(path, node => ts.isFunctionDeclaration(node) && node.name?.text === 'parseCurrencyInput');
  const helpers = evaluateProduction(formatSource + '\n' + parseSource, { formatPropertyCurrency: value => `R$ ${value.toFixed(2).replace('.', ',')}` }, '({formatCurrencyInput,parseCurrencyInput})');
  assert.equal(helpers.parseCurrencyInput(helpers.formatCurrencyInput(0)), 0);
  assert.equal(helpers.parseCurrencyInput(''), undefined);
  assert.equal(helpers.parseCurrencyInput(helpers.formatCurrencyInput('123450')), 1234.5);
  const base = { name: 'Synthetic', phone: '', email: '', feedback: '', source: 'manual', cargo: '', empresa: '', profissao: '', renda_familiar: '',
    valor_interesse: helpers.formatCurrencyInput(0), property_id: '', interest_property_ids: [], person_type: 'individual', gender: '', social_name: '', birth_date: '', cpf: '', rg: '', cnpj: '', corporate_name: '', trade_name: '', state_registration: '' };
  const fields = buildLeadEditFields(base, helpers.parseCurrencyInput); assert.equal(fields.valor_interesse, 0);
  assert.equal(buildLeadEditFields({ ...base, valor_interesse: '' }, helpers.parseCurrencyInput).valor_interesse, null);
  assert.deepEqual(changedLeadFields(fields, buildLeadEditFields({ ...base, name: 'Renamed' }, helpers.parseCurrencyInput)), { name: 'Renamed' });
});
