import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import ts from 'typescript';
import { buildLeadHistory } from '../../../../hooks/lead-history/build-history.ts';
import * as historyPagination from '../../../../hooks/lead-history/pagination.ts';
import * as historyPaginationQuery from '../../../../hooks/lead-history/pagination-query.ts';
import * as tenantQueryCache from '../../../../lib/access/tenant-query-cache.ts';
import * as tracking from './tracking.ts';
import { getSafeAbsoluteHttpUrl } from '../../../../lib/safe-http-url.ts';
import * as leadValidation from '../../../../lib/validation/leads.ts';
import * as historyPaginationValidation from '../../../../lib/validation/lead-history-pagination.ts';
import { parseDomainInput, validateDomainResponse } from '../../../../lib/validation/common.ts';
import { hydrateLeadDetail } from './hydrate-lead-detail.ts';
import { prepareLeadPDFPreview } from '../../../../lib/lead-attachment-preview.ts';
import * as leadReadAccess from '../../../../lib/lead-read-access.ts';
import * as leadRequestIntent from '../../../../lib/lead-request-intent.ts';
import * as queuePool from '../../../../lib/queue-pool.ts';
import * as cadencePresentation from '../../../../lib/lead-cadence-presentation.ts';
import * as vimobError from '../../../../lib/api/vimob-error.ts';

const require = createRequire(import.meta.url);
const wrap = tag => function PrimitiveFixture({ children, ...props }) {
  for (const key of ['openDelay', 'closeDelay', 'asChild', 'sideOffset', 'collisionPadding', 'onOpenChange', 'open', 'side', 'align', 'variant', 'size']) delete props[key];
  return React.createElement(tag, props, children);
};
const icons = new Proxy({}, { get: () => function IconFixture() { return React.createElement('span'); } });
const UI = { Button: wrap('button'), Badge: wrap('span'), HoverCard: wrap('section'), HoverCardContent: wrap('section'),
  HoverCardTrigger: wrap('span'), Dialog: wrap('section'), DialogContent: wrap('section'), DialogTitle: wrap('h2') };

function load(path, overrides = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true }, reportDiagnostics: true });
  assert.equal(output.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const commonJSModule = { exports: {} };
  const mockRequire = id => {
    if (id in overrides) return overrides[id];
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === 'lucide-react') return icons;
    if (id.startsWith('@/components/ui/')) return UI;
    if (id === '@/lib/utils') return { cn: (...values) => values.filter(Boolean).join(' ') };
    if (id === '@/lib/validation/lead-history-pagination') return historyPaginationValidation;
    if (id === '@/lib/lead-read-access') return leadReadAccess;
    if (id === '@/lib/queue-pool') return queuePool;
    if (id === '@/lib/lead-cadence-presentation') return cadencePresentation;
    if (id === '@/lib/api/vimob-error') return vimobError;
    if (id === '@/lib/api/lead-move-contract') return {};
    if (id === '@/hooks/leads/use-cadence-overdue-count') return { useCadenceOverdueCount: state => state?.deal_status === 'open' ? cadencePresentation.countOverdueCadenceTasks(cadencePresentation.getPendingCadenceDeadlines(state.tasks || []), Date.now()) : 0 };
    if (id === '@/lib/api/lead-request-intent') return load('../../../../lib/api/lead-request-intent.ts', {
      '@/lib/lead-request-intent': leadRequestIntent,
      '@/lib/api/vimob-client': {
        getVimobAPIAccessTokenUserId: () => null,
        getVimobAPIAccessTokenSessionId: () => null,
      },
    });
    throw new Error(`Unexpected dependency ${id}`);
  };
  vm.runInNewContext(`(function(require,module,exports){${output.outputText}\n})`,
    { Blob, AbortController, Error, Promise, Date, URL, setTimeout, clearTimeout, ...globals })(mockRequire, commonJSModule, commonJSModule.exports);
  return commonJSModule.exports;
}

function viewer(fetch, access = { authorizedAttachment: null, isFetching: true, isError: false, cancel() {}, refetch() {} }) { return load('../LeadAttachmentViewer.tsx', {
  '@/lib/lead-attachment-preview': { prepareLeadPDFPreview },
  '@/hooks/use-lead-attachments': { useLeadAttachmentAccess: () => access },
}, { fetch }); }
const controller = () => new AbortController();

test('viewer rejeita HTTP expirado, arquivo vazio e HTML rotulado PDF', async () => {
  for (const response of [
    { ok: false, blob: async () => new Blob(['expired']) },
    { ok: true, blob: async () => new Blob([]) },
    { ok: true, blob: async () => new Blob(['<html>login</html>']) },
  ]) {
    const { readLeadAttachmentBlob } = viewer(async () => response);
    await assert.rejects(readLeadAttachmentBlob('https://example.invalid/a.pdf', controller().signal, true));
  }
});

test('viewer aceita assinatura PDF sintética e o transporte recebe cancelamento', async () => {
  let requestSignal;
  const pdf = new Blob(['%PDF-1.7\nfixture\n%%EOF\n']);
  const { readLeadAttachmentBlob } = viewer(async (_url, options) => {
    requestSignal = options.signal;
    return { ok: true, blob: async () => pdf };
  });
  const result = await readLeadAttachmentBlob('https://example.invalid/a.pdf', controller().signal, true);
  assert.equal(await result.text(), await pdf.text());
  assert.equal(result.type, 'application/pdf');
  assert.equal(requestSignal.aborted, false);
});

test('fechar durante leitura do corpo impede retorno de blob tardio', async () => {
  let settleBody; let bodyStarted;
  const ready = new Promise(resolve => { bodyStarted = resolve; });
  const { readLeadAttachmentBlob } = viewer(async () => ({ ok: true,
    blob: () => new Promise(resolve => { settleBody = resolve; bodyStarted(); }) }));
  const parent = controller();
  const request = readLeadAttachmentBlob('https://example.invalid/a.pdf', parent.signal, true);
  await ready;
  parent.abort();
  settleBody(new Blob(['%PDF-1.7\nfixture']));
  await assert.rejects(request, error => error.name === 'AbortError');
});

test('viewer encerra requisição sem resposta por timeout', async () => {
  const { readLeadAttachmentBlob } = viewer((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
  }));
  await assert.rejects(readLeadAttachmentBlob('https://example.invalid/a.pdf', controller().signal, true, 5),
    error => error.name === 'AbortError');
});

test('PDF inicialmente apresenta estado de preparação, sem iframe de URL não validada', () => {
  const { LeadAttachmentViewer } = viewer(() => { throw new Error('Network must not run during SSR'); }, {
    authorizedAttachment: { file_url: 'https://example.invalid/a.pdf' }, isFetching: false, cancel() {}, refetch() {},
  });
  const html = renderToStaticMarkup(React.createElement(LeadAttachmentViewer, { open: true, onOpenChange: () => {},
    attachment: { id: 'a', file_name: 'contrato.pdf', file_type: 'pdf', file_url: 'https://example.invalid/a.pdf' } }));
  assert.match(html, /Preparando PDF/);
  assert.doesNotMatch(html, /<iframe/);
});

test('tarefas concluídas oferecem consulta e nenhuma ação de conclusão em leitura', () => {
  const { LeadCadencePanel } = load('../LeadCadencePanel.tsx', { react: { ...React, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useEffect() {} } });
  let inspected = 0;
  const props = {
    state: { deal_status: 'won', cadence_enabled: true, stage_name: 'Contato', enrollment: {},
      summary: { total: 1, completed: 1 }, tasks: [{ id: 't', type: 'call', title: 'Retornar', status: 'completed', is_done: true }] },
    isLoading: false, canOperate: false, onTaskClick: () => assert.fail('must not complete'), onTaskInspect: () => { inspected++; },
  };
  const html = renderToStaticMarkup(React.createElement(LeadCadencePanel, props));
  assert.match(html, /aria-label="Consultar Retornar"/);
  assert.doesNotMatch(html, /<button[^>]*disabled/);
  const findInspect = node => {
    if (!React.isValidElement(node)) return null;
    if (node.props['aria-label'] === 'Consultar Retornar') return node;
    return React.Children.toArray(node.props.children).map(findInspect).find(Boolean);
  };
  findInspect(LeadCadencePanel(props)).props.onClick();
  assert.equal(inspected, 1);
});

function historyHook(getLeadHistoryRaw) {
  return load('../../../../hooks/use-lead-history.ts', {
    '@tanstack/react-query': { useQuery: options => options, useQueryClient: () => new QueryClient() },
    '@/contexts/AuthContext': { useAuth: () => ({ activeOrganization: { organizationId: 'org-a' } }) },
    '@/hooks/use-lead-timeline': { formatResponseTime: String },
    '@/lib/api/leads': { leadsAPI: { getLeadHistoryRaw } },
    '@/lib/property-display-utils': { formatPropertyCurrency: String },
    '@/lib/utils/formatting': { formatBRLCurrencyWithDefaultDecimals: String },
    './lead-history': { buildLeadHistory },
    './lead-history/pagination': historyPagination,
    './lead-history/pagination-query': historyPaginationQuery,
    '@/lib/access/tenant-query-cache': tenantQueryCache,
  }).useLeadHistory('lead-a');
}

test('consumidores simultâneos compartilham request; reabrir atualiza mantendo array legado', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { refetchOnMount: false } } });
  let count = 0; let settle;
  const options = historyHook(async (_id, org, { signal }) => {
    assert.equal(org, 'org-a'); assert.ok(signal);
    count++;
    if (count === 1) await new Promise(resolve => { settle = resolve; });
    return { activityEvents: [{ id: `a${count}`, type: 'note', content: 'Fixture', created_at: '2026-10-12T12:00:00Z' }] };
  });
  const first = new QueryObserver(client, options); const second = new QueryObserver(client, options);
  const stopFirst = first.subscribe(() => {}); const stopSecond = second.subscribe(() => {});
  assert.equal(count, 1);
  settle(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(Array.isArray(client.getQueryData(['lead-history-v2', 'lead-a'])));
  stopFirst(); stopSecond();
  const reopened = new QueryObserver(client, options); const stopReopened = reopened.subscribe(() => {});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(count, 2);
  assert.equal(client.getQueryData(['lead-history-v2', 'lead-a'])[0].id, 'activity-a2');
  stopReopened(); client.clear();
});

test('histórico cancelado não transforma resposta tardia em cache', async () => {
  const client = new QueryClient(); let settle; let signal;
  const options = historyHook(async (_id, _org, request) => {
    signal = request.signal;
    return new Promise(resolve => { settle = resolve; });
  });
  const observer = new QueryObserver(client, options); const stop = observer.subscribe(() => {});
  await client.cancelQueries({ queryKey: options.queryKey });
  assert.equal(signal.aborted, true);
  settle({ activityEvents: [{ id: 'late', type: 'note', content: 'Fixture', created_at: '2026-10-12T12:00:00Z' }] });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(client.getQueryData(options.queryKey), undefined);
  stop(); client.clear();
});

test('utm_term continua termo da campanha e não vira nome de formulário', () => {
  const details = tracking.buildCampaignTrackingDetails(null, { id: 'lead-a', source: 'website', utm_term: 'apartamento centro' });
  assert.equal(details.form_name, null);
  assert.equal(details.utm_term, 'apartamento centro');
});

test('rastreamento sem dados expõe erro/retry e tipografia Pipeline fica no portal próprio', () => {
  const { CampaignTrackingHover } = load('./CampaignTrackingHover.tsx', {
    'date-fns/locale': { ptBR: {} }, './utils': { formatDateSafely: value => value }, './tracking': tracking,
    '@/lib/safe-http-url': { getSafeAbsoluteHttpUrl },
  });
  const pipeline = renderToStaticMarkup(React.createElement(CampaignTrackingHover, {
    leadMeta: null, error: true, onRetry: () => {}, variant: 'pipeline',
  }));
  assert.match(pipeline, /Campanha indisponível/);
  assert.match(pipeline, /role="alert"/);
  assert.match(pipeline, /Tentar novamente/);
  assert.match(pipeline, /calc\(100dvh-72px\)/);
  assert.match(pipeline, /\[&amp;_div\]:text-xs/);
  const standard = renderToStaticMarkup(React.createElement(CampaignTrackingHover, {
    leadMeta: { campaign_name: 'Fixture' },
  }));
  assert.doesNotMatch(standard, /\[&amp;_div\]:text-xs/);
  assert.match(standard, /max-h-\[420px\]/);
});

test('GET/schema/mapper distinguem tags omitidas, null, vazias e preenchidas', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const org = '22222222-2222-4222-8222-222222222222';
  const tag = { id: '33333333-3333-4333-8333-333333333333', name: 'Fixture', color: '#123456' };
  const base = { id, organizationId: org, name: 'Fixture', source: 'manual', status: 'new', dealStatus: 'open',
    priority: 'normal', reentryCount: 0, createdAt: '2026-10-12T12:00:00Z', updatedAt: '2026-10-12T12:01:00Z' };
  for (const tags of [undefined, null, [], [tag]]) {
    const payload = tags === undefined ? { ...base } : { ...base, tags };
    const { leadsAPI } = load('../../../../lib/api/leads.ts', {
      '@/lib/validation': { ...leadValidation, parseDomainInput, validateDomainResponse },
      './vimob-client': { vimobAPIRequest: async (path, options) => {
        assert.equal(path, `/v1/leads/${id}`); assert.equal(options.organizationId, org);
        return { data: payload };
      } },
    });
    const { data } = await leadsAPI.getLead(id, org);
    assert.equal(Object.hasOwn(data, 'tags'), Array.isArray(tags));
    const hydrated = hydrateLeadDetail({ ...data, tags: [tag] }, data);
    if (Array.isArray(tags)) {
      assert.deepEqual(JSON.parse(JSON.stringify(data.tags)), tags);
      assert.equal(hydrated.tags.length, tags.length);
    } else {
      assert.equal(hydrated.tags.length, 1);
    }
  }
  assert.equal(leadValidation.apiLeadSchema.safeParse({ ...base, tags: [{ id: tag.id, name: 42, color: '#123456' }] }).success, false);
  for (const flag of [true, false, undefined]) {
    const { leadsAPI } = load('../../../../lib/api/leads.ts', {
      '@/lib/validation': { ...leadValidation, parseDomainInput, validateDomainResponse },
      './vimob-client': { vimobAPIRequest: async () => ({ data: { ...base, financialReviewRequired: flag } }) },
    });
    const { data } = await leadsAPI.getLead(id, org);
    assert.equal(data.financial_review_required, flag === true);
  }
  assert.equal(leadValidation.apiLeadSchema.safeParse({ ...base, financialReviewRequired: 'true' }).success, false);
});

test('API paginada preserva endpoint legado, transmite cursor/org/sinal e rejeita resposta incompatível', async () => {
  const leadId = '11111111-1111-4111-8111-111111111111';
  const organizationId = '22222222-2222-4222-8222-222222222222';
  const abort = new AbortController(); const requests = [];
  let response = { data: {
    timelineEvents: [], activityEvents: [], entryEvents: [], distributionLogs: [], assignmentLogs: [], auditLogs: [], users: [],
    lead: { id: leadId, created_at: '2026-10-01T00:00:00Z' }, leadMeta: {},
    historyCoverage: { complete: false, canonicalPresence: { leadCreated: false, firstResponse: false, assignment: false } },
  }, pagination: { nextCursor: null, hasOlder: false, snapshotAt: '2026-10-12T12:00:00.123456Z' } };
  const { leadsAPI } = load('../../../../lib/api/leads.ts', {
    '@/lib/validation': { ...leadValidation, parseDomainInput, validateDomainResponse },
    './vimob-client': { vimobAPIRequest: async (path, options) => { requests.push({ path, options }); return response; } },
  });
  const result = await leadsAPI.getLeadHistoryPage(leadId, organizationId, { signal: abort.signal, pageSize: 50, cursor: 'synthetic-cursor' });
  assert.equal(result.pagination.hasOlder, false);
  assert.equal(requests[0].path, `/v1/leads/${leadId}/history-raw`);
  assert.equal(requests[0].options.organizationId, organizationId);
  assert.equal(requests[0].options.signal, abort.signal);
  assert.deepEqual({ ...requests[0].options.query }, { pageSize: 50, cursor: 'synthetic-cursor' });
  response = { data: response.data };
  await assert.rejects(leadsAPI.getLeadHistoryPage(leadId, organizationId), /Contrato invalido/);
  await assert.rejects(leadsAPI.getLeadHistoryPage(leadId, organizationId, { pageSize: 201 }), /Contrato invalido/);
  assert.equal(requests.length, 2);
  assert.equal(await leadsAPI.getLeadHistoryRaw(leadId, organizationId, { signal: abort.signal }), response.data);
  assert.equal(requests[2].options.query, undefined);
});
