import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RUNTIME_ROOT } from './queue-local-homologation-target.mjs';

const runFile = promisify(execFile);
export const BROWSER_OS_POWERSHELL = 'C:/Users/andre/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
const samePath = (actual, expected) => typeof actual === 'string' && path.resolve(actual).toLowerCase() === path.resolve(expected).toLowerCase();
const recordPath = path.join(RUNTIME_ROOT, 'browser-cleanup-obligations.json');

export function assertOwnedBrowserWorker(manifest, receipt, process) {
  assert.equal(receipt.kind, 'vimob-queue-local-process-v1');
  assert.equal(receipt.mode, 'runtime');
  assert.equal(receipt.runId, manifest.runId);
  assert.ok(Number.isSafeInteger(receipt.pid) && receipt.pid > 0);
  assert.equal(receipt.runtimeMode, 'production_worker');
  assert.equal(receipt.attestationStatus, 'VERIFIED');
  assert.ok(samePath(receipt.executable, path.join(RUNTIME_ROOT, 'bin/queue-homologation-runtime.exe')));
  assert.ok(samePath(receipt.cwd, path.join(RUNTIME_ROOT, 'process-cwd')));
  assert.equal(process.ProcessId, receipt.pid);
  assert.ok(samePath(process.ExecutablePath, receipt.executable));
  const arguments_ = String(process.CommandLine).match(/"[^"]*"|[^\s"]+/g)?.map(value => value.replace(/^"|"$/g, ''));
  assert.equal(arguments_?.length, 4);
  assert.ok(samePath(arguments_[0], receipt.executable));
  assert.equal(arguments_[1], '-manifest');
  assert.ok(samePath(arguments_[2], path.join(RUNTIME_ROOT, 'manifest.json')));
  assert.equal(arguments_[3], '-worker');
  const requested = Date.parse(receipt.launchRequestedAt), recorded = Date.parse(receipt.recordedAt), started = Date.parse(process.startedAt);
  assert.ok([requested, recorded, started].every(Number.isFinite));
  assert.equal(process.startedAt, receipt.osStartedAt, 'The OS birthtime must exactly match this process instance, not merely a launch window.');
  assert.ok(recorded >= requested && started >= requested - 2_000 && started <= recorded + 2_000, 'PID creation must belong to this exact launch receipt.');
  return { pid: receipt.pid, executable: receipt.executable, runId: receipt.runId, runtimeMode: receipt.runtimeMode,
    startedAt: process.startedAt, verifiedAt: new Date().toISOString(), cwd: receipt.cwd, cwdProvenance: 'fixed_launcher_receipt_driver_never_loads_dotenv', receipt };
}

export async function readRuntimeOSIdentity(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  // Only a numeric already-validated PID enters this fixed read-only command.
  const script = `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object ProcessId,ExecutablePath,CommandLine,@{n='startedAt';e={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress`;
  const { stdout } = await runFile(BROWSER_OS_POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15_000 });
  if (!stdout.trim() || stdout.trim() === 'null') return null;
  return JSON.parse(stdout);
}

const optionalJSON = filename => fs.readFile(filename, 'utf8').then(JSON.parse, error => { if (error.code === 'ENOENT') return null; throw error; });

export async function inspectOwnedBrowserWorker(manifest, options = {}) {
  const receipt = await (options.readReceipt || (() => optionalJSON(path.join(RUNTIME_ROOT, 'runtime-process.json'))))();
  const obligations = await (options.readObligations || (() => optionalJSON(recordPath)))();
  const candidates = receipt ? [{ receipt, provenance: 'current_launcher_receipt' }] : [];
  if (obligations) {
    assert.equal(obligations.kind, 'vimob-queue-browser-cleanup-obligations-v1');
    assert.equal(obligations.runId, manifest.runId);
    if (obligations.finalGlobalDrainRequired) {
      for (const event of obligations.events.filter(value => value.status === 'DEFERRED')) {
        assert.ok(event.worker?.receipt, 'Unresolved cleanup must retain its attested process receipt.');
        candidates.push({ receipt: event.worker.receipt, provenance: 'durable_deferred_obligation' });
      }
    }
  }
  const seen = new Set();
  for (const candidate of candidates) {
    const current = candidate.receipt;
    assert.equal(current.kind, 'vimob-queue-local-process-v1');
    assert.equal(current.mode, 'runtime');
    assert.equal(current.runId, manifest.runId);
    assert.ok(Number.isSafeInteger(current.pid) && current.pid > 0);
    const key = `${current.pid}/${current.osStartedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const process = await (options.readProcess || readRuntimeOSIdentity)(current.pid);
    options.audit?.push({ pid: current.pid, expectedStartedAt: current.osStartedAt, provenance: candidate.provenance,
      state: process ? 'present' : 'exited', observedAt: new Date().toISOString() });
    if (!process) continue;
    // A reused PID is not the recorded worker and must never silently satisfy
    // a pending obligation. Stop no process and require explicit inspection.
    return assertOwnedBrowserWorker(manifest, current, process);
  }
  return null;
}

export async function recordBrowserDrain(manifest, command, status, detail) {
  assert.ok(['DEFERRED', 'PASSED'].includes(status));
  let record = await fs.readFile(recordPath, 'utf8').then(JSON.parse, error => { if (error.code === 'ENOENT') return null; throw error; });
  if (record) { assert.equal(record.kind, 'vimob-queue-browser-cleanup-obligations-v1'); assert.equal(record.runId, manifest.runId); }
  else record = { kind: 'vimob-queue-browser-cleanup-obligations-v1', runId: manifest.runId, events: [] };
  const event = { at: new Date().toISOString(), command, status, ...detail };
  record.events.push(event);
  if (status === 'DEFERRED') { record.status = 'DEFERRED'; record.finalGlobalDrainRequired = true; delete record.resolvedAt; }
  if (status === 'PASSED' && command === 'global-cleanup') { record.status = 'PASSED'; record.finalGlobalDrainRequired = false; record.resolvedAt = event.at; }
  await fs.writeFile(recordPath, JSON.stringify(record, null, 2), { mode: 0o600 });
  return { status, report: recordPath, finalGlobalDrainRequired: record.finalGlobalDrainRequired === true };
}
