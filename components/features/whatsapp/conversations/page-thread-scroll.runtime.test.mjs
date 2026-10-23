import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url), ts = require('typescript');
const source = readFileSync(new URL('../ConversationsScreen.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('ConversationsScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Conversations');
const names = new Set(['rememberMessageScrollPosition', 'restoreMessageScrollPosition', 'handleMessagesScroll', 'scrollMessagesToLatest']);
const statements = component.body.statements.filter(node =>
  ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => names.has(declaration.name.getText(ast)))
  || ts.isExpressionStatement(node) && node.getText(ast).startsWith('useLayoutEffect(') && node.getText(ast).includes('new ResizeObserver'));
assert.equal(statements.length, 5, 'execute the actual four callbacks and content observer');
const compiled = ts.transpileModule(statements.map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;

// Deterministic DOM coordinates exercise the real page callbacks. These are
// scroll/ownership regressions, separate from the Chromium layout evidence.
function fixture() {
  const rows = Array.from({ length: 10 }, (_, index) => ({ id: 'message-' + index, height: 100 }));
  const observed = [], follows = [], readStates = [], observers = [];
  const content = {};
  const viewport = {
    rows, clientWidth: 400, clientHeight: 200, scrollTop: 800, isConnected: true,
    get scrollHeight() { return this.rows.reduce((sum, row) => sum + row.height, 0); },
    getBoundingClientRect: () => ({ top: 100, bottom: 300 }),
    querySelector: () => content,
    querySelectorAll() {
      let offset = 0;
      return this.rows.map(row => {
        const top = offset; offset += row.height;
        return { dataset: { messageId: row.id }, getBoundingClientRect: () => ({
          top: 100 + top - viewport.scrollTop, bottom: 100 + top + row.height - viewport.scrollTop,
        }) };
      });
    },
  };
  const end = { closest: () => viewport, scrollIntoView(options) {
    follows.push(options); viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
  } };
  const ref = current => ({ current });
  const refs = {
    messagesEndRef: ref(end), isUserScrollingRef: ref(false),
    messageScrollSizeRef: ref(null), messageScrollPositionRef: ref(null),
    messageScrollContextRef: ref('scope-a'), messageScrollViewportRef: ref(viewport),
  };
  class Observer {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(node) { observed.push(node); }
    disconnect() { this.disconnected = true; }
  }
  const effects = [];
  const params = { ...refs, useCallback: callback => callback,
    useLayoutEffect: callback => effects.push(callback), ResizeObserver: Observer,
    isMobile: false, loadingMessages: false, messageScrollContext: 'scope-a',
    setReadScrollState: value => readStates.push(typeof value === 'function' ? value(readStates.at(-1) || { scope: 'scope-a', atBottom: true }) : value),
  };
  const callbacks = Function(...Object.keys(params), `${compiled}\nreturn {rememberMessageScrollPosition,handleMessagesScroll,scrollMessagesToLatest};`)(...Object.values(params));
  callbacks.rememberMessageScrollPosition(viewport);
  const cleanup = effects[0]();
  const scroll = () => callbacks.handleMessagesScroll({ currentTarget: { querySelector: () => viewport } });
  return { viewport, rows, refs, observed, follows, readStates, content, callbacks, scroll, observer: observers[0], cleanup };
}

test('page observes content growth and follows a late image without treating its scroll as a reading gesture', () => {
  const h = fixture();
  assert.deepEqual(h.observed, [h.viewport, h.content]);
  h.rows[0].height += 300;
  h.scroll();
  assert.equal(h.refs.isUserScrollingRef.current, false);
  assert.equal(h.readStates.length, 0);
  h.observer.callback();
  assert.equal(h.viewport.scrollTop, 1100);
  assert.deepEqual(h.follows, [{ behavior: 'instant', block: 'end' }]);
});

test('page keeps the same visible message and partial offset when media above a reader grows', () => {
  const h = fixture(); h.viewport.scrollTop = 330; h.scroll();
  assert.equal(h.refs.isUserScrollingRef.current, true);
  const before = { ...h.refs.messageScrollPositionRef.current };
  h.rows[0].height += 300; h.observer.callback();
  assert.equal(h.viewport.scrollTop, 630);
  assert.equal(h.refs.messageScrollPositionRef.current.messageId, before.messageId);
  assert.equal(h.refs.messageScrollPositionRef.current.offset, before.offset);
  assert.equal(h.follows.length, 0);
});

test('page jump to latest restores automatic following and the next arrival stays at the bottom', () => {
  const h = fixture(); h.viewport.scrollTop = 200; h.scroll();
  h.callbacks.scrollMessagesToLatest();
  assert.equal(h.refs.isUserScrollingRef.current, false);
  assert.deepEqual(h.readStates.at(-1), { scope: 'scope-a', atBottom: true });
  h.rows.push({ id: 'new-message', height: 100 }); h.scroll(); h.observer.callback();
  assert.equal(h.viewport.scrollTop, 900);
  assert.ok(h.follows.every(options => options.behavior === 'instant'));
});

test('retired context, disconnected viewport and unchanged geometry cannot move another thread', () => {
  for (const condition of ['context', 'viewport', 'disconnected', 'unchanged']) {
    const h = fixture();
    if (condition !== 'unchanged') h.rows[0].height += 300;
    if (condition === 'context') h.refs.messageScrollContextRef.current = 'scope-b';
    if (condition === 'viewport') h.refs.messageScrollViewportRef.current = {};
    if (condition === 'disconnected') h.viewport.isConnected = false;
    h.observer.callback();
    assert.equal(h.follows.length, 0);
    h.cleanup(); assert.equal(h.observer.disconnected, true);
  }
});
