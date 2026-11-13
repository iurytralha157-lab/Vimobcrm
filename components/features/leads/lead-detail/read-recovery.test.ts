import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import { getLeadDetailReadState } from '@/components/features/leads/lead-detail/read-recovery';
import type { VerifiedLeadRead } from '@/lib/lead-read-snapshot';

type Snapshot = {
  id: string;
  organization_id: string;
  assigned_user_id?: string | null;
  team_id?: string | null;
  can_operate?: boolean;
};
const lead = (patch: Partial<Snapshot> = {}): Snapshot => ({
  id: 'lead-a', organization_id: 'org-a', assigned_user_id: 'actor-a',
  team_id: 'team-a', can_operate: true, ...patch,
});
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

// Actual QueryObserver flags, including retained data after a rejected refetch.
// No HTTP, React mock, authentication service or database is involved.
function fixture(seed?: Snapshot | null, start = true) {
  const client = new QueryClient({ defaultOptions: { queries: {
    retry: false, gcTime: Infinity, staleTime: Infinity, refetchOnWindowFocus: false,
  } } });
  const key = ['lead', 'org-a', 'lead-a'];
  if (seed !== undefined) client.setQueryData(key, seed);
  const requests: Array<{ resolve: (data: Snapshot | null) => void; reject: (error: Error) => void }> = [];
  const observer = new QueryObserver<Snapshot | null, Error>(client, {
    queryKey: key,
    queryFn: () => new Promise((resolve, reject) => { requests.push({ resolve, reject }); }),
    refetchOnMount: start ? 'always' : false,
    retry: false,
  });
  const unsubscribe = observer.subscribe(() => {});
  const state = (verifiedRead?: VerifiedLeadRead) => getLeadDetailReadState({
    leadId: 'lead-a', organizationId: 'org-a', leadOrganizationId: 'org-a',
    query: observer.getCurrentResult(), verifiedRead,
  });
  return {
    client, key, observer, requests, state,
    async resolve(data: Snapshot | null, index = requests.length - 1) {
      requests[index].resolve(data); await turn();
    },
    async reject(status: number, index = requests.length - 1) {
      requests[index].reject(Object.assign(new Error('Synthetic read failure'), { status })); await turn();
    },
    close() { unsubscribe(); observer.destroy(); client.clear(); },
  };
}

test('cold initial read is refreshing and cannot suggest that cache authorizes an operation', () => {
  const f = fixture();
  try {
    const query = f.observer.getCurrentResult(), state = f.state();
    assert.equal(query.isLoading, true); assert.equal(query.isFetchedAfterMount, false);
    assert.equal(state.kind, 'refreshing'); assert.equal(state.canRetry, false);
    assert.equal(state.retrying, true); assert.ok(state.blockedReason);
  } finally { f.close(); }
});

for (const seed of [undefined, lead()]) test(`a rejected ${seed ? 'warm' : 'cold'} read is an error even though QueryObserver marks fetchedAfterMount`, async () => {
  const f = fixture(seed);
  try {
    await f.reject(503);
    const query = f.observer.getCurrentResult(), state = f.state();
    assert.equal(query.isFetchedAfterMount, true); assert.equal(query.isSuccess, false);
    assert.equal(query.isLoadingError, seed === undefined); assert.equal(query.isRefetchError, seed !== undefined);
    assert.equal(query.data?.id, seed?.id);
    assert.equal(state.kind, 'error'); assert.equal(state.hideDetails, false);
    assert.equal(state.canRetry, true); assert.equal(state.retrying, false); assert.ok(state.blockedReason);
  } finally { f.close(); }
});

test('retry stays blocked while fetching and reuses an in-flight GET until a valid success', async () => {
  const f = fixture(lead());
  try {
    await f.reject(503);
    const first = f.observer.refetch({ cancelRefetch: false });
    const second = f.observer.refetch({ cancelRefetch: false });
    assert.equal(f.requests.length, 2);
    assert.equal(f.observer.getCurrentResult().isError, true);
    assert.equal(f.state().retrying, true); assert.ok(f.state().blockedReason);
    await f.resolve(lead()); await Promise.all([first, second]);
    assert.equal(f.state().kind, 'ready'); assert.equal(f.state().blockedReason, undefined);
  } finally { f.close(); }
});

test('a fresh read-only capability is a valid read, not a recoverable permission error', async () => {
  const f = fixture();
  try {
    await f.resolve(lead({ can_operate: false }));
    const state = f.state();
    assert.equal(state.kind, 'ready'); assert.equal(state.hideDetails, false);
    assert.equal(state.canRetry, false); assert.match(state.blockedReason || '', /visualização/);
  } finally { f.close(); }
});

test('background revalidation keeps an already confirmed lead visible and blocks actions until it resolves', async () => {
  const f = fixture();
  try {
    await f.resolve(lead());
    const pending = f.observer.refetch();
    const state = f.state();
    assert.equal(state.kind, 'revalidating');
    assert.equal(state.hideDetails, false);
    assert.equal(state.message, '');
    assert.ok(state.blockedReason);
    await f.resolve(lead()); await pending;
    assert.equal(f.state().kind, 'ready');
  } finally { f.close(); }
});

for (const status of [401, 403, 404]) test(`HTTP ${status} hides even a retained successful snapshot and keeps that state during retry`, async () => {
  const f = fixture(lead());
  try {
    await f.reject(status);
    assert.equal(f.observer.getCurrentResult().data?.id, 'lead-a');
    assert.equal(f.state().kind, 'unavailable'); assert.equal(f.state().hideDetails, true);
    const pending = f.observer.refetch({ cancelRefetch: false });
    assert.equal(f.state().hideDetails, true); assert.equal(f.state().retrying, true);
    await f.resolve(lead()); await pending; assert.equal(f.state().kind, 'ready');
  } finally { f.close(); }
});

test('successful null is unavailable instead of a permanent disabled detail without explanation', async () => {
  const f = fixture(lead());
  try {
    await f.resolve(null);
    assert.equal(f.observer.getCurrentResult().isSuccess, true);
    assert.equal(f.state().kind, 'unavailable'); assert.equal(f.state().hideDetails, true);
    assert.equal(f.state().canRetry, true);
  } finally { f.close(); }
});

for (const patch of [{ id: 'lead-b' }, { organization_id: 'org-b' }]) test(`a success with a different identity never becomes ready: ${JSON.stringify(patch)}`, async () => {
  const f = fixture();
  try {
    await f.resolve(lead(patch)); assert.equal(f.observer.getCurrentResult().isSuccess, true);
    assert.equal(f.state().kind, 'unavailable'); assert.equal(f.state().hideDetails, true);
    assert.ok(f.state().blockedReason);
  } finally { f.close(); }
});

test('a cache handoff can confirm only the same lead, organization and capability context', () => {
  const f = fixture(lead(), false);
  try {
    const confirmedAt = f.client.getQueryState(f.key)!.dataUpdatedAt;
    const verifiedRead = { data: lead(), organizationId: 'org-a', selectionVersion: 1,
      visibilityScopeKey: 'actor-a:sid-a', confirmedAt };
    assert.equal(f.observer.getCurrentResult().isFetchedAfterMount, false);
    assert.equal(f.state().kind, 'refreshing'); assert.equal(f.state(verifiedRead).kind, 'ready');
    for (const data of [lead({ id: 'lead-b' }), lead({ organization_id: 'org-b' }), lead({ assigned_user_id: 'actor-b' }), lead({ can_operate: false })]) {
      assert.notEqual(f.state({ ...verifiedRead, data }).kind, 'ready');
    }
  } finally { f.close(); }
});

test('a missing or foreign expected organization hides content and cannot dispatch recovery', () => {
  const f = fixture(lead(), false);
  try {
    for (const organizationId of [null, 'org-b']) {
      const state = getLeadDetailReadState({ leadId: 'lead-a', organizationId,
        leadOrganizationId: 'org-a', query: f.observer.getCurrentResult() });
      assert.equal(state.kind, 'unavailable'); assert.equal(state.hideDetails, true);
      assert.equal(state.canRetry, false);
    }
  } finally { f.close(); }
});

test('a successful record missing can_operate requests recovery instead of claiming permission denial', async () => {
  const f = fixture();
  try {
    await f.resolve(lead({ can_operate: undefined }));
    assert.equal(f.state().kind, 'error'); assert.equal(f.state().canRetry, true);
    assert.match(f.state().message, /confirmar as ações/);
  } finally { f.close(); }
});
