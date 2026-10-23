import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url), ts = require('typescript');
const source = readFileSync(new URL('./use-whatsapp-thread-scroll.ts', import.meta.url), 'utf8');
const body = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
} }).outputText;

// Execute the real hook with deterministic DOM coordinates and commit effects.
// These tests prove state/ownership logic, not browser geometry or rendering.
function fixture({ radix = false } = {}) {
  const hooks = [], effects = [], frames = [], observers = [], follows = [];
  let index = 0, nextFrame = 0;
  const react = {
    useRef(initial) { const slot = index++; return hooks[slot] ??= { current: initial }; },
    useState(initial) {
      const slot = index++; if (!hooks[slot]) hooks[slot] = { value: initial };
      return [hooks[slot].value, value => { hooks[slot].value = typeof value === 'function' ? value(hooks[slot].value) : value; }];
    },
    useCallback: fn => fn,
    useLayoutEffect(fn, deps) {
      const slot = index++, previous = hooks[slot];
      if (!deps || !previous || !previous.deps || deps.some((value, position) => !Object.is(value, previous.deps[position]))) {
        effects.push({ slot, fn, deps });
      }
    },
  };
  function node(ids = Array.from({ length: 20 }, (_, i) => `message-${i}`)) {
    const result = {
      ids, rowHeight: 60, clientHeight: 200, clientWidth: 340, scrollTop: 0,
      get scrollHeight() { return this.ids.length * this.rowHeight; },
      getBoundingClientRect() { return { top: 100, bottom: 100 + this.clientHeight }; },
      querySelectorAll() {
        return this.ids.map((id, i) => ({ dataset: { threadItemId: id },
          getBoundingClientRect: () => ({ top: 100 + i * this.rowHeight - this.scrollTop,
            bottom: 100 + (i + 1) * this.rowHeight - this.scrollTop }) }));
      },
      querySelector() { return this.content; },
      content: {}, firstElementChild: {},
    };
    return result;
  }
  let currentNode = node();
  const scrollRef = { current: radix ? { querySelector: () => currentNode } : currentNode };
  const bottomRef = { current: { scrollIntoView(options) {
    follows.push(options); currentNode.scrollTop = Math.max(0, currentNode.scrollHeight - currentNode.clientHeight);
  } } };
  class Observer {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const exports = {};
  Function('exports', 'require', 'ResizeObserver', 'window', body)(exports,
    name => { assert.equal(name, 'react'); return react; }, Observer,
    { requestAnimationFrame: fn => { const id = ++nextFrame; frames.push({ id, fn }); return id; },
      cancelAnimationFrame: id => { const position = frames.findIndex(frame => frame.id === id); if (position >= 0) frames.splice(position, 1); } });
  let current;
  const render = (scope = 'A', enabled = true, suspended = false) => {
    index = 0; effects.length = 0;
    current = exports.useWhatsAppThreadScroll(scope, currentNode.ids.at(-1), scrollRef, bottomRef,
      { firstItemId: currentNode.ids[0], enabled, suspended, radixViewport: radix });
    for (const { slot, fn, deps } of effects) {
      hooks[slot]?.cleanup?.(); hooks[slot] = { deps, cleanup: fn() };
    }
    return current;
  };
  const read = top => { currentNode.scrollTop = top; current.onScroll({ currentTarget: currentNode }); };
  const anchor = () => {
    const row = currentNode.querySelectorAll().find(item => item.getBoundingClientRect().bottom > 100);
    return { id: row.dataset.threadItemId, offset: row.getBoundingClientRect().top - 100 };
  };
  return { render, read, anchor, follows, observers, frames, get node() { return currentNode; },
    get current() { return current; }, replace() { currentNode = node([...currentNode.ids]);
      if (!radix) scrollRef.current = currentNode; }, flush() { while (frames.length) frames.shift().fn(); },
    unmount() { for (const hook of hooks) hook?.cleanup?.(); } };
}

for (const radix of [false, true]) {
  test(`${radix ? 'Radix' : 'native'} initial and equal-array commits reach the end without a cancellable timer`, () => {
    const f = fixture({ radix }); f.render(); f.node.ids = [...f.node.ids]; f.render();
    assert.equal(f.node.scrollTop, f.node.scrollHeight - f.node.clientHeight);
    assert.equal(f.frames.length, 0); assert.equal(f.follows[0].behavior, 'instant');
  });
  test(`${radix ? 'Radix' : 'native'} prepending rows while a new tail arrives preserves the actual row offset`, () => {
    const f = fixture({ radix }); f.render(); f.read(372); const before = f.anchor();
    f.node.ids = ['older-1', 'older-2', 'older-3', ...f.node.ids, 'new-tail']; f.render();
    assert.deepEqual(f.anchor(), before); assert.equal(f.node.scrollTop, 552);
  });
}
test('reflow preserves earlier reading and ignores the resize scroll before the observer', () => {
  const f = fixture(); f.render(); f.read(372); const before = f.anchor();
  f.node.rowHeight = 96; f.node.clientWidth = 280; f.node.clientHeight = 120;
  f.current.onScroll({ currentTarget: f.node }); f.observers.at(-1).callback(); f.render();
  assert.deepEqual(f.anchor(), before); assert.equal(f.current.showScrollToLatest, true);
});
test('resize and new-message bursts follow the bottom synchronously', () => {
  const f = fixture(); f.render(); f.node.clientHeight = 120;
  f.current.onScroll({ currentTarget: f.node }); f.observers.at(-1).callback();
  f.node.ids.push('burst-1'); f.render(); f.node.ids.push('burst-2'); f.render();
  assert.equal(f.node.scrollHeight - f.node.scrollTop - f.node.clientHeight, 0);
  assert.ok(f.follows.every(options => options.behavior === 'instant'));
});
test('viewport remount preserves the same reading row and partial offset', () => {
  const f = fixture({ radix: true }); f.render(); f.read(372); const before = f.anchor();
  f.replace(); f.node.rowHeight = 96; f.render(); assert.deepEqual(f.anchor(), before);
});
test('scroll-to-latest resumes following after reading older rows', () => {
  const f = fixture(); f.render(); f.read(372); f.render();
  assert.equal(f.current.showScrollToLatest, true); f.current.scrollToLatest(); f.render();
  assert.equal(f.current.showScrollToLatest, false);
  f.node.ids.push('latest'); f.render(); assert.equal(f.node.scrollTop, f.node.scrollHeight - f.node.clientHeight);
});
for (const scopes of [['B'], ['B', 'A']]) {
  test(`late load-older callback cannot move ${scopes.join(' → ')} after A`, async () => {
    const f = fixture(); f.render(); f.read(372); let resolve;
    const pending = f.current.loadOlderPreservingPosition(() => new Promise(done => { resolve = done; }));
    for (const scope of scopes) f.render(scope); const before = f.node.scrollTop;
    resolve(); await pending; f.flush(); assert.equal(f.node.scrollTop, before);
  });
}
test('disabled or closed chat ignores late observers and late history work', async () => {
  const f = fixture(); f.render(); const observer = f.observers.at(-1); let resolve;
  const pending = f.current.loadOlderPreservingPosition(() => new Promise(done => { resolve = done; }));
  f.render('A', false); f.node.scrollTop = 123; observer.callback();
  resolve(); await pending; f.flush(); assert.equal(f.node.scrollTop, 123);
});
test('the earlier-reading button never revives after A to B to A or close and reopen', () => {
  const f = fixture(); f.render(); f.read(372); f.render(); assert.equal(f.current.showScrollToLatest,true);
  f.render('B'); f.render('A'); assert.equal(f.current.showScrollToLatest,false);
  f.read(372); f.render(); assert.equal(f.current.showScrollToLatest,true);
  f.render('A',false); f.render('A',true); assert.equal(f.current.showScrollToLatest,false);
});
test('load-older preserves an existing anchor instead of compensating new bottom rows', async () => {
  const f = fixture(); f.render(); f.read(372); const before = f.anchor();
  await f.current.loadOlderPreservingPosition(async () => {
    f.node.ids = ['old-a', 'old-b', ...f.node.ids, 'tail-b']; f.render();
  }); f.flush(); assert.deepEqual(f.anchor(), before);
});

test('unmount cancels an already queued history restore frame', async () => {
  const f = fixture(); f.render(); f.read(372);
  await f.current.loadOlderPreservingPosition(async () => {});
  assert.equal(f.frames.length, 1); f.unmount();
  assert.equal(f.frames.length, 0, 'no orphaned frame after unmount');
});

test('a history completion after unmount never schedules a frame', async () => {
  const f = fixture(); f.render(); let resolve;
  const pending = f.current.loadOlderPreservingPosition(() => new Promise(done => { resolve = done; }));
  f.unmount(); resolve(); await pending;
  assert.equal(f.frames.length, 0, 'late completion cannot revive a closed component');
});

test('changing the scope or closing the thread cancels a queued restore', async () => {
  for (const [scope, enabled] of [['B', true], ['A', false]]) {
    const f = fixture(); f.render(); f.read(372);
    await f.current.loadOlderPreservingPosition(async () => {});
    assert.equal(f.frames.length, 1); f.render(scope, enabled);
    assert.equal(f.frames.length, 0, 'previous lifecycle frame cancelled');
  }
});

for (const radix of [false, true]) {
  test(`${radix ? 'Radix' : 'native'} presentation suspension preserves an earlier reading anchor across hidden measurements`, () => {
    const f = fixture({ radix }); f.render(); f.read(372); f.render(); const before = f.anchor();
    const observer = f.observers.at(-1), follows = f.follows.length;
    f.node.clientWidth = 0; f.node.clientHeight = 0; f.node.scrollTop = 0;
    f.render('A', true, true); observer.callback(); f.current.onScroll({ currentTarget: f.node });
    f.current.scrollToLatest();
    f.node.ids = ['older-hidden', ...f.node.ids, 'tail-hidden']; f.render('A', true, true);
    assert.equal(f.follows.length, follows); assert.equal(f.node.scrollTop, 0);
    f.node.clientWidth = 340; f.node.clientHeight = 200; f.render();
    assert.deepEqual(f.anchor(), before); assert.equal(f.current.showScrollToLatest, true);
  });
}

test('late history completion while suspended cannot write hidden DOM, then restore uses the saved anchor', async () => {
  const f = fixture(); f.render(); f.read(372); const before = f.anchor(); let resolve;
  const pending = f.current.loadOlderPreservingPosition(() => new Promise(done => { resolve = done; }));
  f.render('A', true, true); f.node.clientWidth = 0; f.node.clientHeight = 0; f.node.scrollTop = 0;
  f.node.ids = ['older-hidden-a', 'older-hidden-b', ...f.node.ids]; f.render('A', true, true);
  resolve(); await pending; f.flush(); assert.equal(f.node.scrollTop, 0); assert.equal(f.frames.length, 0);
  f.node.clientWidth = 340; f.node.clientHeight = 200; f.render(); assert.deepEqual(f.anchor(), before);
});

test('suspension cancels an already queued history frame and retains normal scope reset semantics', async () => {
  const f = fixture(); f.render(); f.read(372);
  await f.current.loadOlderPreservingPosition(async () => {}); assert.equal(f.frames.length, 1);
  f.render('A', true, true); assert.equal(f.frames.length, 0);
  f.render('B', true, true); f.render('A', true, true); f.render();
  assert.equal(f.current.showScrollToLatest, false);
  assert.equal(f.node.scrollTop, f.node.scrollHeight - f.node.clientHeight);
});
