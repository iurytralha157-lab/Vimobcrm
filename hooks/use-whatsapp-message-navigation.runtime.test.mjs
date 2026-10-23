import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url), ts = require('typescript');
const repository = process.cwd();
const sourceRoot = process.env.WHATSAPP_NAVIGATION_BASELINE_ROOT || repository;
const compile = path => ts.transpileModule(readFileSync(path, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const helper = {};
const search = {};
Function('exports', compile(join(repository, 'lib/search-text.ts')))(search);
Function('exports', 'require', compile(join(sourceRoot, 'lib/whatsapp-message-navigation.ts')))(helper,
  name => { assert.equal(name, '@/lib/search-text'); return search; });
const hookSource = compile(join(sourceRoot, 'hooks/use-whatsapp-message-navigation.ts'));

// Executes the actual hook with deterministic commit/effect/DOM scheduling.
// This is logic evidence, separate from the real React/browser suite.
function fixture(initial = {}) {
  const slots = [], effects = [], frames = [], requests = [], gestures = [], timers = new Map();
  let index = 0, dirty = true, mounted = true, options, value;
  const sameDeps = (before, after) => before && after && before.length === after.length && before.every((item, i) => Object.is(item, after[i]));
  const react = {
    useRef(initial) { const slot = index++; return slots[slot] ??= { current: initial }; },
    useState(initial) {
      const slot = index++;
      slots[slot] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[slot].value, next => { slots[slot].value = typeof next === 'function' ? next(slots[slot].value) : next; dirty = true; }];
    },
    useCallback(fn, deps) {
      const slot = index++;
      if (!sameDeps(slots[slot]?.deps, deps)) slots[slot] = { deps, fn };
      return slots[slot].fn;
    },
    useMemo(fn, deps) {
      const slot = index++;
      if (!sameDeps(slots[slot]?.deps, deps)) slots[slot] = { deps, value: fn() };
      return slots[slot].value;
    },
    useLayoutEffect(fn, deps) {
      const slot = index++;
      if (!sameDeps(slots[slot]?.deps, deps)) {
        const previous = slots[slot]; slots[slot] = { deps, cleanup: previous?.cleanup };
        effects.push(() => { slots[slot].cleanup?.(); slots[slot].cleanup = fn(); });
      }
    },
  };
  const exports = {};
  Function('exports', 'require', 'window', 'CSS', hookSource)(exports,
    name => name === 'react' ? react : helper,
    { requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
      cancelAnimationFrame: () => {}, setTimeout: callback => { const id = timers.size + 1; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id) },
    { escape: value => value });
  const log = { closest() { return this; }, querySelector(selector) {
    const id = selector.match(/data-message-id="(.*?)"/)?.[1];
    return options.messages.some(message => message.id === id) ? {
      scrollIntoView: config => gestures.push({ kind: 'scroll', id, config }),
      focus: config => gestures.push({ kind: 'focus', id, config }),
      animate: () => gestures.push({ kind: 'highlight', id }),
    } : null;
  } };
  options = { scopeKey: 'A', messages: [], logRef: { current: log }, ...initial };
  const commit = patch => {
    if (patch) options = { ...options, ...patch };
    dirty = true;
    for (let loops = 0; dirty && mounted; loops += 1) {
      assert.ok(loops < 20, 'effects must settle');
      dirty = false; index = 0; effects.length = 0;
      value = exports.useWhatsAppMessageNavigation(options);
      for (const effect of effects) effect();
    }
    return value;
  };
  const readPage = (cursor, signal) => new Promise((resolve, reject) => requests.push({ cursor, signal, resolve, reject }));
  const tick = async () => { await Promise.resolve(); await Promise.resolve(); commit(); };
  commit();
  return { commit, tick, requests, gestures, readPage,
    get value() { return value; }, get options() { return options; },
    flushFrames() { while (frames.length) frames.shift()(); },
    async settle(promise) {
      let completed = false;
      const done = Promise.resolve(promise).finally(() => { completed = true; });
      for (let iteration = 0; !completed && iteration < 100; iteration += 1) {
        await tick(); const readyFrames = frames.splice(0); for (const callback of readyFrames) callback();
        if (timers.size) { const readyTimers = [...timers.values()]; timers.clear(); for (const callback of readyTimers) callback(); }
      }
      assert.equal(completed, true, 'navigation must settle with a bounded number of frames');
      await done; commit();
    },
    unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.(); },
  };
}
const message = (id, patch = {}) => ({ id, message_id: `provider-${id}`, conversation_id: 'chat-a', session_id: 'session-a',
  content: 'Visita amanhã', message_type: 'text', ...patch });

test('navigation cancels a pending search without leaving the search busy forever', async () => {
  const f = fixture({ messages: [message('one')] }); f.commit({ readPage: f.readPage });
  f.value.setQuery('visita'); f.commit();
  const pendingSearch = f.value.search(); f.commit(); assert.equal(f.value.isSearching, true);
  const navigation = f.value.navigateTo('one'); await f.tick(); f.flushFrames(); await navigation; f.commit();
  f.requests[0].resolve({ messages: [message('stale')], nextCursor: null }); await pendingSearch; f.commit();
  assert.equal(f.value.isSearching, false);
  assert.deepEqual(f.value.results, []);
  assert.equal(f.gestures[0].id, 'one');
});

test('cursor cycles are errors instead of endlessly advertising more results', async () => {
  const f = fixture(); f.commit({ readPage: f.readPage }); f.value.setQuery('visita'); f.commit();
  const pending = f.value.search(); f.commit();
  for (const nextCursor of ['cursor-a', 'cursor-b', 'cursor-a', 'cursor-b']) {
    const request = f.requests.at(-1); if (request.settled) break;
    request.settled = true; request.resolve({ messages: [], nextCursor }); await f.tick();
  }
  await pending; f.commit();
  assert.notEqual(f.value.error, ''); assert.equal(f.value.hasMore, false);
});

test('search performs at most four authorized page reads per action and resumes from its cursor', async () => {
  const f = fixture(); f.commit({ readPage: f.readPage }); f.value.setQuery('visita'); f.commit();
  const pending = f.value.search(); f.commit();
  for (let index = 0; index < 4; index += 1) {
    assert.equal(f.requests[index].cursor, index ? `cursor-${index}` : null);
    f.requests[index].resolve({ messages: [message(`match-${index}`)], nextCursor: `cursor-${index + 1}` }); await f.tick();
  }
  await pending; f.commit(); assert.equal(f.requests.length, 4); assert.equal(f.value.results.length, 4);
  const more = f.value.searchMore(); f.commit(); assert.equal(f.requests[4].cursor, 'cursor-4');
  f.requests[4].resolve({ messages: [message('match-4')], nextCursor: null }); await more; f.commit();
  assert.equal(f.value.results.length, 5); assert.equal(f.value.hasMore, false);
  assert.deepEqual(f.options.messages, [], 'search does not append to the displayed chat window');
});

test('scope A to B to A aborts late search and navigation results', async () => {
  const f = fixture({ messages: [message('one')] }); f.commit({ readPage: f.readPage });
  f.value.setQuery('visita'); f.commit(); const pending = f.value.search(); f.commit();
  f.commit({ scopeKey: 'B' }); f.commit({ scopeKey: 'A' });
  assert.equal(f.requests[0].signal.aborted, true);
  f.requests[0].resolve({ messages: [message('secret-obsolete')], nextCursor: null }); await pending; f.commit();
  assert.deepEqual(f.value.results, []); assert.equal(f.value.query, '');
  const navigation = f.value.navigateTo('one'); f.commit({ scopeKey: 'B' }); f.commit({ scopeKey: 'A' });
  f.flushFrames(); await navigation; f.commit(); assert.deepEqual(f.gestures, []);
});

test('changing the search query aborts the previous request and preserves only the new query results', async () => {
  const f = fixture(); f.commit({ readPage: f.readPage }); f.value.setQuery('old'); f.commit();
  const old = f.value.search(); f.commit(); f.value.setQuery('new'); f.commit();
  const fresh = f.value.search(); f.commit(); assert.equal(f.requests[0].signal.aborted, true);
  f.requests[1].resolve({ messages: [message('new', { content: 'new result' })], nextCursor: null }); await fresh; f.commit();
  f.requests[0].resolve({ messages: [message('old', { content: 'old private result' })], nextCursor: null }); await old; f.commit();
  assert.equal(f.value.query, 'new'); assert.deepEqual(f.value.results.map(row => row.id), ['new']);
});

test('closing or unmounting aborts pending search and prevents late private results', async () => {
  for (const close of [false, true]) {
    const f = fixture(); f.commit({ readPage: f.readPage }); f.value.setQuery('visita'); f.commit();
    const pending = f.value.search(); f.commit();
    if (close) { f.value.setOpen(false); f.commit(); } else f.unmount();
    assert.equal(f.requests[0].signal.aborted, true);
    f.requests[0].resolve({ messages: [message('secret')], nextCursor: null }); await pending;
    if (close) { f.commit(); assert.deepEqual(f.value.results, []); assert.equal(f.value.isSearching, false); }
  }
});

test('search errors retain the previously completed results and cursor for a safe retry', async () => {
  const f = fixture(); f.commit({ readPage: f.readPage }); f.value.setQuery('visita'); f.commit();
  const pending = f.value.search(); f.commit();
  for (let i = 0; i < 4; i += 1) { f.requests[i].resolve({ messages: [message('one')], nextCursor: `cursor-${i}` }); await f.tick(); }
  await pending; f.commit(); const more = f.value.searchMore(); f.commit();
  f.requests[4].reject({ status: 409 }); await more; f.commit();
  assert.equal(f.value.results.length, 1); assert.equal(f.value.hasMore, true); assert.notEqual(f.value.error, '');
});

test('quoted identity honors conversation and session, and rejects ambiguous provider ids', () => {
  const rows = [message('row-a', { message_id: 'same-provider' }), message('row-b', { message_id: 'same-provider', session_id: 'session-b' })];
  assert.equal(helper.findWhatsAppMessageIdentity(rows, 'same-provider'), undefined);
  assert.equal(helper.findWhatsAppMessageIdentity(rows, 'same-provider', { sessionId: 'session-b' })?.id, 'row-b');
  assert.equal(helper.findWhatsAppMessageIdentity(rows, 'row-a', { conversationId: 'other-chat' }), undefined);
  assert.equal(helper.findWhatsAppMessageIdentity(rows, 'row-a', { sessionId: 'session-b' }), undefined);
});

test('navigation loads at most twelve older pages and fails safely when target is not found', async () => {
  let reads = 0, f;
  f = fixture({ loadOlder: async () => {
    const messages = Array.from({ length: ++reads }, (_, i) => message(`row-${i}`));
    f.commit({ messages }); return { messages, hasMore: true };
  } });
  await f.settle(f.value.navigateTo('not-present')); assert.equal(reads, 12); assert.notEqual(f.value.error, '');
});

test('navigation stops on failed or nonadvancing history instead of a retry loop', async () => {
  for (const failure of [false, true]) {
    let reads = 0;
    const f = fixture({ messages: [message('one')], loadOlder: async () => {
      reads += 1; if (failure) throw Error('cursor unavailable'); return { messages: [message('one')], hasMore: true };
    } });
    await f.value.navigateTo('missing'); f.commit(); assert.equal(reads, 1); assert.notEqual(f.value.error, '');
  }
});

test('navigation uses the current loader after revealing locally hidden rows', async () => {
  let firstReads = 0, nextReads = 0, f;
  const currentLoader = async () => {
    nextReads += 1; f.commit({ messages: [message('local'), message('target')] });
    return { messages: f.options.messages, hasMore: false };
  };
  f = fixture({ loadOlder: async () => {
    firstReads += 1; f.commit({ messages: [message('local')], loadOlder: currentLoader });
    return { messages: [message('local')], hasMore: true };
  } });
  await f.settle(f.value.navigateTo('target'));
  assert.equal(firstReads, 1); assert.equal(nextReads, 1); assert.equal(f.value.error, '');
  assert.equal(f.gestures[0].id, 'target');
});

test('message search matches accents and filenames while excluding deleted content', () => {
  assert.equal(helper.matchesWhatsAppMessageSearch(message('one', { content: 'Visitação', media_filename: 'Contrato.PDF' }), 'visitacao'), true);
  assert.equal(helper.matchesWhatsAppMessageSearch(message('one', { content: null, media_filename: 'Contrato.PDF' }), 'contrato'), true);
  assert.equal(helper.matchesWhatsAppMessageSearch(message('one', { content: 'private old', message_type: 'deleted' }), 'private'), false);
  assert.equal(helper.matchesWhatsAppMessageSearch(message('one'), '  '), false);
});
