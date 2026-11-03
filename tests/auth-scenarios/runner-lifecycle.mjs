import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const isRunning = (child) => Boolean(child.pid) && child.exitCode === null && child.signalCode === null;

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); child.off('exit', finish); resolve(); };
    const timer = setTimeout(() => {
      child.off('exit', finish);
      reject(new Error('Owned runner child did not terminate.'));
    }, 5_000);
    child.once('exit', finish);
    if (!isRunning(child)) finish();
  });
}

export async function terminateOwnedChild(child, { platform = process.platform, spawnProcess = spawn } = {}) {
  if (!child.pid) return;
  if (platform === 'win32') {
    if (!isRunning(child)) return;
    await new Promise((resolve, reject) => {
      const killer = spawnProcess('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore', shell: false, windowsHide: true,
      });
      killer.once('error', reject);
      killer.once('exit', (code) => {
        if (code === 0 || !isRunning(child)) resolve();
        else reject(new Error(`Could not terminate owned runner child (taskkill exit ${code}).`));
      });
    });
    await waitForExit(child);
    return;
  }
  // Each POSIX child starts a new process group, so its Next worker is owned too.
  const signalGroup = (signal) => {
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  signalGroup('SIGTERM');
  try { await waitForExit(child); }
  catch { signalGroup('SIGKILL'); await waitForExit(child); }
  // A worker can outlive the group leader; the detached group remains ours.
  signalGroup('SIGKILL');
}

export function createRunnerLifecycle({
  cwd,
  spawnProcess = spawn,
  fetchUrl = fetch,
  platform = process.platform,
  startupTimeoutMs = 120_000,
  pause = (ms, signal) => sleep(ms, undefined, { signal }),
  terminateChild = (child) => terminateOwnedChild(child, { platform, spawnProcess }),
} = {}) {
  const children = [];
  const abort = new AbortController();
  let startupError;
  let closing = false;
  let cleanupPromise;
  let rejectFailure;
  const failure = new Promise((_, reject) => { rejectFailure = reject; });
  // A child can fail before the caller enters waitFor; retain that failure.
  void failure.catch(() => {});
  const fail = (error) => {
    if (closing || startupError) return;
    startupError = error;
    rejectFailure(error);
    abort.abort(error);
  };
  const assertRunning = () => { if (startupError) throw startupError; };

  function startNode(name, args, env = {}, readyMessage) {
    if (closing) throw new Error('Runner is already closing.');
    const child = spawnProcess(process.execPath, args, {
      cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'ignore'],
      shell: false, windowsHide: true, detached: platform !== 'win32',
    });
    const owned = { child, name, ready: false };
    children.push(owned);
    child.once('error', (error) => fail(new Error(`${name} failed to start (${error.code || error.message}).`)));
    child.once('exit', (code, signal) => fail(new Error(`${name} exited (code ${code}, signal ${signal || 'none'}).`)));
    child.once('spawn', () => { if (!readyMessage) owned.ready = true; });
    let output = '';
    child.stdout?.on('data', (chunk) => {
      if (!readyMessage || owned.ready) return;
      output = (output + chunk.toString()).slice(-4_096);
      if (output.includes(readyMessage)) owned.ready = true;
    });
    return owned;
  }

  async function waitFor(url, owner) {
    const deadline = Date.now() + startupTimeoutMs;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      assertRunning();
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      if (!owner || owner.ready) {
        try {
          const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(remaining)]);
          const response = await Promise.race([fetchUrl(url, { signal }), failure]);
          assertRunning();
          await response.body?.cancel();
          return;
        } catch { assertRunning(); }
      }
      const delay = Math.min(1_000, deadline - Date.now());
      if (delay > 0) await Promise.race([pause(delay, abort.signal), failure]);
    }
    throw new Error(`Timed out waiting for ${url}`);
  }

  function cleanup(browser) {
    if (cleanupPromise) return cleanupPromise;
    closing = true;
    abort.abort();
    cleanupPromise = (async () => {
      const tasks = [() => browser?.close(), ...children.map(({ child }) => () => terminateChild(child))];
      const stopped = await Promise.allSettled(tasks.map((task) => Promise.resolve().then(task)));
      const errors = stopped.filter((result) => result.status === 'rejected').map((result) => result.reason);
      if (errors.length) throw new AggregateError(errors, 'Runner cleanup failed.');
    })();
    return cleanupPromise;
  }

  function watchSignals(getBrowser, target = process) {
    const handlers = ['SIGINT', 'SIGTERM'].map((signal) => {
      const handler = () => {
        target.exitCode = signal === 'SIGINT' ? 130 : 143;
        fail(new Error(`Runner interrupted by ${signal}.`));
        void cleanup(getBrowser()).catch(() => { target.exitCode ||= 1; });
      };
      target.once(signal, handler);
      return [signal, handler];
    });
    return () => { for (const [signal, handler] of handlers) target.off(signal, handler); };
  }

  return { startNode, waitFor, cleanup, watchSignals };
}
