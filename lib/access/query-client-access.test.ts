import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { activateQueryClientAccess, captureQueryClientAccess } from '@/lib/access/query-client-access';

test('normal child close and cache clear do not retire provider access', () => {
  const client = new QueryClient();
  const retire = activateQueryClientAccess(client);
  const current = captureQueryClientAccess(client);
  client.clear();
  assert.equal(current(), true);
  retire();
  assert.equal(current(), false);
  assert.equal(captureQueryClientAccess(client)(), false);
});

test('a replacement visit never revives a captured visit, including ABA and Strict Mode cleanup', () => {
  const client = new QueryClient();
  const retireA = activateQueryClientAccess(client);
  const capturedA = captureQueryClientAccess(client);
  retireA();
  const retireB = activateQueryClientAccess(client);
  const capturedB = captureQueryClientAccess(client);
  retireA();
  assert.equal(capturedA(), false);
  assert.equal(capturedB(), true);
  retireB();
  const retireA2 = activateQueryClientAccess(client);
  assert.equal(capturedA(), false);
  assert.equal(capturedB(), false);
  assert.equal(captureQueryClientAccess(client)(), true);
  retireA2();
});

test('retiring one client leaves other tenants and clients unchanged', () => {
  const a = new QueryClient(), b = new QueryClient();
  const retireA = activateQueryClientAccess(a), retireB = activateQueryClientAccess(b);
  const capturedA = captureQueryClientAccess(a), capturedB = captureQueryClientAccess(b);
  retireA();
  assert.equal(capturedA(), false);
  assert.equal(capturedB(), true);
  retireB();
});

test('standalone capture survives until the first provider registration', () => {
  const client = new QueryClient();
  const standalone = captureQueryClientAccess(client);
  assert.equal(standalone(), true);
  const retire = activateQueryClientAccess(client);
  assert.equal(standalone(), false);
  retire();
  assert.equal(standalone(), false);
});
