import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { QueryClient } from '@tanstack/react-query';
import { evaluateProduction } from './lead-request-runtime-fixture.mjs';
import { compareServerRevisions } from '../../lib/compare-server-revisions.ts';

// Execute the production hook with deterministic React lifecycle scheduling and
// a real QueryCache. Queued updaters exercise retirement after setState is called.
export function leadFieldOptimismRuntime({ client: suppliedClient, lead: initialLead,
  getLead, setLead: suppliedSetter, scope: initialScope = {} } = {}) {
  const client = suppliedClient ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let lead = initialLead ?? { id: 'lead-a', organization_id: 'org-a', updated_at: '2026-10-16T10:00:00.000001Z',
    assigned_user_id: 'owner-a', assignee: { id: 'owner-a', name: 'Original' }, can_operate: true,
    stage_id: 'stage-a', stage: { id: 'stage-a' }, tags: [{ id: 'tag-a', name: 'A' }] };
  let scope = { leadId: lead.id, organizationId: lead.organization_id, actorId: 'actor-a', sessionId: 'sid-a', ...initialScope };
  let cursor = 0, mounted = true, defer = false, visit = 0;
  const slots = [], queued = [], invalidations = [];
  const read = getLead ?? (() => lead);
  const setLead = value => {
    const apply = () => suppliedSetter ? suppliedSetter(value) : (lead = typeof value === 'function' ? value(lead) : value);
    if (defer) queued.push(apply); else apply();
  };
  const changed = (left, right) => !left || right.some((value, index) => !Object.is(value, left[index]));
  const react = {
    useRef: value => { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo: (build, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: build() }; return slots[index].value; },
    useCallback: (callback, deps) => react.useMemo(() => callback, deps),
    useLayoutEffect: (setup, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; } },
  };
  react.useEffect = react.useLayoutEffect;
  const path = process.env.PIPELINE_FIELD_OPTIMISM_SOURCE || 'hooks/leads/use-lead-field-optimism.ts';
  const parsed = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const source = parsed.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)).map(node => node.getText(parsed)).join('\n');
  const production = evaluateProduction(source, { ...react, compareServerRevisions, useQueryClient: () => scope.client ?? client },
    '({ useLeadFieldOptimism, isDefiniteLeadFieldRejection })');
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = filters => { invalidations.push(filters); return invalidate(filters); };
  const render = (patch = {}) => {
    const next = { ...scope, ...patch };
    if (['leadId', 'organizationId', 'actorId', 'sessionId', 'client'].some(key => next[key] !== scope[key])) visit++;
    scope = next; cursor = 0;
    return production.useLeadFieldOptimism({ ...scope, setLead });
  };
  return {
    client, invalidations, render, read,
    isDefiniteLeadFieldRejection: production.isDefiniteLeadFieldRejection,
    operation: () => { const captured = visit; return { isCurrent: () => mounted && captured === visit }; },
    patch: patch => setLead(current => ({ ...current, ...patch })),
    deferUpdaters: () => { defer = true; },
    flush: () => { defer = false; while (queued.length) queued.shift()(); },
    canonical: async (family = 'lead', same = true) => {
      const key = family === 'stages-with-leads' ? [family, scope.organizationId, 'pipeline-a'] : [family, scope.organizationId, scope.leadId];
      const data = family === 'stages-with-leads' ? [{ id: 'stage-a', leads: [read()] }] : read();
      client.setQueryData(key, data); const before = client.getQueryData(key);
      await client.fetchQuery({ queryKey: key, queryFn: async () => same ? structuredClone(data) : data, staleTime: 0 });
      return client.getQueryData(key) === before;
    },
    close: () => {
      mounted = false; slots.forEach(slot => slot?.cleanup?.()); client.invalidateQueries = invalidate;
      if (!suppliedClient) client.clear();
    },
  };
}
