import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRunnerLifecycle, terminateOwnedChild } from './runner-lifecycle.mjs';

function child(pid = 123) {
  return Object.assign(new EventEmitter(), { pid, exitCode: null, signalCode: null, stdout: new EventEmitter() });
}
const fixture = (overrides = {}) => {
  const owned = child();
  const runtime = createRunnerLifecycle({ cwd: 'test-repo', spawnProcess: () => owned, terminateChild: async () => {}, ...overrides });
  return { owned, runtime };
};

test('starts the current Node with native argv, fixed cwd, no shell and a hidden Windows window', async () => {
  let launch;
  const { owned, runtime } = fixture({ spawnProcess: (...args) => { launch = args; return owned; } });
  runtime.startNode('Next', ['C:\\repo with spaces\\next.js', 'dev'], { VIMOB_API_URL: 'http://127.0.0.1:54400' });
  assert.equal(launch[0], process.execPath);
  assert.deepEqual(launch[1], ['C:\\repo with spaces\\next.js', 'dev']);
  assert.equal(launch[2].cwd, 'test-repo');
  assert.equal(launch[2].shell, false);
  assert.equal(launch[2].windowsHide, true);
  assert.equal(launch[2].env.VIMOB_API_URL, 'http://127.0.0.1:54400');
  await runtime.cleanup();
});

test('reports a retained spawn error without waiting 120 attempts or probing HTTP', async () => {
  let fetches = 0;
  const { owned, runtime } = fixture({ fetchUrl: async () => { fetches += 1; return new Response(); } });
  const owner = runtime.startNode('Fake backend', ['fixture'], {}, 'fake up');
  owned.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' }));
  await assert.rejects(runtime.waitFor('http://127.0.0.1:1', owner), /Fake backend failed to start \(ENOENT\)/);
  assert.equal(fetches, 0);
  await runtime.cleanup();
});

test('does not borrow an occupied port before the owned process announces readiness', async () => {
  for (const exitCode of [0, 1]) {
    let fetches = 0;
    const { owned, runtime } = fixture({ fetchUrl: async () => { fetches += 1; return new Response(); } });
    const owner = runtime.startNode('Fake backend', ['fixture'], {}, 'fake up');
    queueMicrotask(() => { owned.exitCode = exitCode; owned.emit('exit', exitCode, null); });
    await assert.rejects(runtime.waitFor('http://127.0.0.1:1', owner), new RegExp(`Fake backend exited \\(code ${exitCode}`));
    assert.equal(fetches, 0);
    await runtime.cleanup();
  }
});

test('aborts a pending startup request when its child exits', async () => {
  let signal;
  const { owned, runtime } = fixture({ fetchUrl: (_url, options) => {
    signal = options.signal;
    queueMicrotask(() => { owned.exitCode = 2; owned.emit('exit', 2, null); });
    return new Promise(() => {});
  } });
  const owner = runtime.startNode('Next', ['fixture']);
  owned.emit('spawn');
  await assert.rejects(runtime.waitFor('http://127.0.0.1:1', owner), /Next exited \(code 2/);
  assert.equal(signal.aborted, true);
  await runtime.cleanup();
});

test('preserves all 120 startup attempts and one-second intervals', async () => {
  let fetches = 0;
  const pauses = [];
  const { owned, runtime } = fixture({
    fetchUrl: async () => { fetches += 1; throw new Error('ECONNREFUSED'); },
    pause: async (ms) => { pauses.push(ms); },
  });
  const owner = runtime.startNode('Next', ['fixture']);
  owned.emit('spawn');
  await assert.rejects(runtime.waitFor('http://127.0.0.1:1', owner), /Timed out waiting/);
  assert.equal(fetches, 120);
  assert.deepEqual(pauses, Array(120).fill(1_000));
  await runtime.cleanup();
});

test('a pending startup HTTP request is aborted at the total deadline', async (t) => {
  let requests = 0;
  let closed;
  const responseClosed = new Promise((resolve) => { closed = resolve; });
  const server = http.createServer((_request, response) => {
    requests += 1;
    response.once('close', closed);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const { owned, runtime } = fixture({ startupTimeoutMs: 500, pause: async () => {} });
  const owner = runtime.startNode('Fixture', ['fixture']);
  owned.emit('spawn');
  await assert.rejects(runtime.waitFor(`http://127.0.0.1:${server.address().port}`, owner), /Timed out waiting/);
  await responseClosed;
  assert.equal(requests, 1);
  await runtime.cleanup();
});

test('a cold startup response taking more than one second is accepted within the total budget', async (t) => {
  let requests = 0;
  let sent = false;
  const server = http.createServer((_request, response) => {
    requests += 1;
    setTimeout(() => { sent = true; response.end('ready'); }, 1_100);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const { owned, runtime } = fixture();
  const owner = runtime.startNode('Fixture', ['fixture']);
  owned.emit('spawn');
  const started = performance.now();
  await runtime.waitFor(`http://127.0.0.1:${server.address().port}`, owner);
  assert.ok(performance.now() - started >= 1_000);
  assert.equal(sent, true);
  assert.equal(requests, 1);
  await runtime.cleanup();
});

test('SIGINT and SIGTERM clean browser and owned children and retain a nonzero status', async () => {
  for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    const target = new EventEmitter();
    let closes = 0;
    const stopped = [];
    const { runtime } = fixture({ terminateChild: async (owned) => { stopped.push(owned.pid); } });
    runtime.startNode('Fixture', ['fixture']);
    const unwatch = runtime.watchSignals(() => ({ close: async () => { closes += 1; } }), target);
    target.emit(signal);
    await runtime.cleanup();
    unwatch();
    assert.equal(target.exitCode, exitCode);
    assert.equal(closes, 1);
    assert.deepEqual(stopped, [123]);
    assert.equal(target.listenerCount('SIGINT') + target.listenerCount('SIGTERM'), 0);
  }
});

test('cleanup closes the browser once and attempts every owned child even after a cleanup error', async () => {
  const children = [child(123), child(456)];
  const stopped = [];
  let closes = 0;
  const runtime = createRunnerLifecycle({
    spawnProcess: () => children.shift(),
    terminateChild: (target) => { stopped.push(target.pid); if (target.pid === 123) throw new Error('stop failed'); },
  });
  runtime.startNode('Fake', ['fixture']);
  runtime.startNode('Next', ['fixture']);
  const browser = { close: () => { closes += 1; throw new Error('browser close failed'); } };
  const first = runtime.cleanup(browser);
  assert.equal(runtime.cleanup(browser), first);
  await assert.rejects(first, /Runner cleanup failed/);
  assert.equal(closes, 1);
  assert.deepEqual(stopped, [123, 456]);
});

test('Windows cleanup targets only a live owned PID and its tree, never a name or port', async () => {
  const target = child(987);
  let command;
  await terminateOwnedChild(target, { platform: 'win32', spawnProcess: (...args) => {
    command = args;
    const killer = child(654);
    queueMicrotask(() => { target.exitCode = 1; target.emit('exit', 1, null); killer.emit('exit', 0, null); });
    return killer;
  } });
  assert.equal(command[0], 'taskkill.exe');
  assert.deepEqual(command[1], ['/PID', '987', '/T', '/F']);
  assert.equal(command[2].shell, false);
  assert.equal(command[2].windowsHide, true);
  await terminateOwnedChild(target, { platform: 'win32', spawnProcess: () => { throw new Error('must not kill an exited PID'); } });
});

test('a real native script path with spaces starts and cleanup preserves an unrelated child', async (t) => {
  const scratch = path.resolve('.tmp');
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(path.join(scratch, 'auth runner '));
  const script = path.join(directory, 'child with spaces.mjs');
  writeFileSync(script, "console.log('fixture ready'); setInterval(() => {}, 1000);\n");
  const unrelated = spawn(process.execPath, [script], { stdio: 'ignore', windowsHide: true, shell: false });
  const runtime = createRunnerLifecycle({ cwd: directory, fetchUrl: async () => new Response() });
  t.after(async () => {
    await runtime.cleanup();
    unrelated.kill();
    await new Promise((resolve) => { unrelated.once('exit', resolve); if (unrelated.exitCode !== null || unrelated.signalCode !== null) resolve(); });
    assert.ok(directory.startsWith(scratch + path.sep));
    rmSync(directory, { recursive: true, force: true });
  });
  const owner = runtime.startNode('Fixture', [fileURLToPath(pathToFileURL(script))], {}, 'fixture ready');
  await runtime.waitFor('http://127.0.0.1:1', owner);
  await runtime.cleanup();
  assert.ok(owner.child.exitCode !== null || owner.child.signalCode !== null);
  assert.equal(unrelated.exitCode, null);
  assert.equal(unrelated.signalCode, null);
});
