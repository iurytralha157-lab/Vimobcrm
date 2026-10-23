import assert from 'node:assert/strict';
import test from 'node:test';
import { assertOwnedBrowserWorker, inspectOwnedBrowserWorker } from './queue-browser-cleanup.mjs';
import { RUNTIME_ROOT } from './queue-local-homologation-target.mjs';

test('only the live exact production worker launch can defer browser terminal drain', () => {
  const manifest = { runId: '11111111-1111-4111-8111-111111111111' };
  const receipt = { kind: 'vimob-queue-local-process-v1', mode: 'runtime', runtimeMode: 'production_worker', attestationStatus: 'VERIFIED', runId: manifest.runId,
    pid: 12345, executable: `${RUNTIME_ROOT}/bin/queue-homologation-runtime.exe`, cwd: `${RUNTIME_ROOT}/process-cwd`,
    launchRequestedAt: '2026-10-15T05:00:00Z', recordedAt: '2026-10-15T05:00:02Z', osStartedAt: '2026-10-15T05:00:01Z' };
  const process = { ProcessId: 12345, ExecutablePath: receipt.executable, startedAt: '2026-10-15T05:00:01Z',
    CommandLine: `"${receipt.executable}" -manifest "${RUNTIME_ROOT}/manifest.json" -worker` };
  assert.equal(assertOwnedBrowserWorker(manifest, receipt, process).pid, 12345);
  for (const change of [
    (r, p) => { r.runId = 'other-run'; }, (r, p) => { r.cwd = 'D:/Vimob/workspaces/vimob-crm'; },
    (r, p) => { r.runtimeMode = 'qa_fail_fast_cycles'; }, (r, p) => { p.ProcessId++; },
    (r, p) => { p.ExecutablePath = `${RUNTIME_ROOT}/bin/vimob-api.exe`; },
    (r, p) => { p.CommandLine = p.CommandLine.replace('-worker', '-once'); },
    (r, p) => { p.CommandLine = p.CommandLine.replace('manifest.json', 'unrelated.json'); },
    (r, p) => { p.startedAt = '2026-10-15T06:00:00Z'; },
    (r, p) => { p.startedAt = '2026-10-15T05:00:02Z'; },
  ]) { const r = structuredClone(receipt), p = structuredClone(process); change(r, p); assert.throws(() => assertOwnedBrowserWorker(manifest, r, p)); }
});

test('a missing or substituted launcher receipt cannot erase a live deferred worker obligation', async () => {
  const manifest = { runId: '11111111-1111-4111-8111-111111111111' };
  const receipt = { kind: 'vimob-queue-local-process-v1', mode: 'runtime', runtimeMode: 'production_worker', attestationStatus: 'VERIFIED', runId: manifest.runId,
    pid: 12345, executable: `${RUNTIME_ROOT}/bin/queue-homologation-runtime.exe`, cwd: `${RUNTIME_ROOT}/process-cwd`,
    launchRequestedAt: '2026-10-15T05:00:00Z', recordedAt: '2026-10-15T05:00:02Z', osStartedAt: '2026-10-15T05:00:01Z' };
  const process = { ProcessId: 12345, ExecutablePath: receipt.executable, startedAt: receipt.osStartedAt,
    CommandLine: `"${receipt.executable}" -manifest "${RUNTIME_ROOT}/manifest.json" -worker` };
  const obligations = { kind: 'vimob-queue-browser-cleanup-obligations-v1', runId: manifest.runId, finalGlobalDrainRequired: true,
    events: [{ status: 'DEFERRED', worker: { receipt } }] };
  const base = { readReceipt: async () => null, readObligations: async () => obligations, readProcess: async () => process };
  assert.equal((await inspectOwnedBrowserWorker(manifest, base)).pid, receipt.pid);
  await assert.rejects(() => inspectOwnedBrowserWorker(manifest, { ...base, readProcess: async () => ({ ...process, startedAt: '2026-10-15T05:00:02Z' }) }));
  await assert.rejects(() => inspectOwnedBrowserWorker(manifest, { ...base, readReceipt: async () => ({ ...receipt, runId: 'replaced' }) }));
  const audit = [];
  assert.equal(await inspectOwnedBrowserWorker(manifest, { ...base, readProcess: async () => null, audit }), null);
  assert.equal(audit[0].state, 'exited');
  assert.equal(audit[0].provenance, 'durable_deferred_obligation');
});
