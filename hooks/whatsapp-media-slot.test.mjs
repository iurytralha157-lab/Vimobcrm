import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function loadSlot() {
  const source = readFileSync(process.env.VIMOB_MEDIA_SLOT_SOURCE || new URL('./use-whatsapp-message-media-url.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = { exports: {}, require: () => ({}), AbortController, DOMException, Promise, URL };
  vm.runInNewContext(`${compiled};globalThis.acquire = mediaRequestSlot;`, sandbox);
  return sandbox.acquire;
}

test('cancellation after four wakeups passes the free media slot to the fifth waiter', async () => {
  const acquire = loadSlot();
  const initial = await Promise.all(Array.from({ length: 4 }, () => acquire(new AbortController().signal)));
  const controllers = Array.from({ length: 5 }, () => new AbortController());
  let finalRelease;
  const pending = controllers.map((controller, index) => acquire(controller.signal).then(release => {
    if (index === 4) finalRelease = release;
    return release;
  }, error => { assert.equal(error.name, 'AbortError'); return null; }));
  initial.forEach(release => release());
  controllers.slice(0, 4).forEach(controller => controller.abort());
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(typeof finalRelease, 'function', 'an authorized waiter must not remain queued while every slot is free');
  } finally {
    finalRelease?.();
    controllers.forEach(controller => controller.abort());
    (await Promise.all(pending)).forEach(release => { if (release && release !== finalRelease) release(); });
  }
});

test('queued cancellation and a competing acquisition preserve the four request limit', async () => {
  const acquire = loadSlot();
  const initial = await Promise.all(Array.from({ length: 4 }, () => acquire(new AbortController().signal)));
  const cancelled = new AbortController();
  const abandoned = acquire(cancelled.signal).catch(error => error);
  const waiting = new AbortController();
  let releaseWaiting;
  const pending = acquire(waiting.signal).then(release => { releaseWaiting = release; });
  cancelled.abort();
  assert.equal((await abandoned).name, 'AbortError');
  initial[0]();
  const competingRelease = await acquire(new AbortController().signal);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(releaseWaiting, undefined, 'a woken waiter cannot exceed the limit when another request acquires the free slot');
  competingRelease();
  await pending;
  assert.equal(typeof releaseWaiting, 'function');
  releaseWaiting();
  initial.slice(1).forEach(release => release());
});
