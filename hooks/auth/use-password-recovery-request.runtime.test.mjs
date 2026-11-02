import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { resetPasswordSchema } from '@/lib/validation/schemas';
import { PASSWORD_RECOVERY_REQUEST_WAIT_MS } from '@/lib/auth/frontend-auth-reliability';
import {
  createPasswordRecoveryRequestCoordinator,
  PASSWORD_RECOVERY_REQUEST_NOTICE,
  PASSWORD_RECOVERY_REQUEST_PENDING_NOTICE,
  PASSWORD_RECOVERY_REQUEST_UNCONFIRMED_NOTICE,
} from '@/lib/auth/password-recovery-request';

function extractedFunction(file, name) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(declaration);
  return ts.transpileModule(`(${declaration.getText(ast).replace(/^export /, '')})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const hookCode = extractedFunction('./use-password-recovery-request.ts', 'usePasswordRecoveryRequest');
const submitCode = extractedFunction('../../components/features/auth/login-form.tsx', 'handleRecoverySubmit');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness(options, sharedCoordinator) {
  let clock = 0, cursor = 0, mounted = true, writes = 0, lateWrites = 0;
  const coordinator = sharedCoordinator ?? createPasswordRecoveryRequestCoordinator({ now: () => clock });
  const cells = [], scheduled = [], waits = [];
  const changed = (left, right) => !left || left.length !== right.length || right.some((value, index) => value !== left[index]);
  const slot = create => { const index = cursor++; return cells[index] ??= create(); };
  const effect = (activate, dependencies) => {
    const cell = slot(() => ({}));
    if (changed(cell.dependencies, dependencies)) {
      scheduled.push(() => { cell.cleanup?.(); cell.cleanup = activate(); cell.dependencies = dependencies; });
    }
  };
  const dependencies = {
    useMemo: (create, values) => {
      const cell = slot(() => ({}));
      if (changed(cell.dependencies, values)) { cell.value = create(); cell.dependencies = values; }
      return cell.value;
    },
    useRef: value => slot(() => ({ current: value })),
    useState: initial => {
      const cell = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      return [cell.value, value => { writes += 1; if (!mounted) lateWrites += 1; cell.value = typeof value === 'function' ? value(cell.value) : value; }];
    },
    useLayoutEffect: effect,
    useEffect: effect,
    useSyncExternalStore: (subscribe, getSnapshot) => {
      const cell = slot(() => ({}));
      if (!cell.cleanup) cell.cleanup = subscribe(() => {});
      return getSnapshot();
    },
    resetPasswordSchema, PASSWORD_RECOVERY_REQUEST_WAIT_MS,
    PASSWORD_RECOVERY_REQUEST_NOTICE, PASSWORD_RECOVERY_REQUEST_PENDING_NOTICE, PASSWORD_RECOVERY_REQUEST_UNCONFIRMED_NOTICE,
    passwordRecoveryRequests: coordinator,
    window: { setInterval: () => 1, clearInterval: () => {} },
    runAuthOperationWithTimeout: (operation, duration) => {
      assert.equal(duration, PASSWORD_RECOVERY_REQUEST_WAIT_MS);
      const timeout = deferred();
      waits.push(() => timeout.resolve({ status: 'timed_out' }));
      return Promise.race([
        Promise.resolve().then(operation).then(value => ({ status: 'completed', value })), timeout.promise,
      ]);
    },
  };
  const hook = new Function(...Object.keys(dependencies), `return ${hookCode}`)(...Object.values(dependencies));
  return {
    coordinator,
    waits,
    render(patch = {}) {
      options = { ...options, ...patch }; cursor = 0;
      const output = hook({ ...options, coordinator });
      while (scheduled.length) scheduled.shift()();
      return output;
    },
    advance(milliseconds) { clock += milliseconds; coordinator.tick(); },
    unmount() { mounted = false; cells.forEach(cell => cell.cleanup?.()); },
    get writes() { return writes; },
    get lateWrites() { return lateWrites; },
  };
}

test('the actual form submit handler blocks simultaneous click and Enter', async () => {
  const response = deferred(); let calls = 0, prevented = 0;
  const h = harness({ active: true, email: 'Synthetic@Example.Invalid', request: email => {
    assert.equal(email, 'synthetic@example.invalid'); calls += 1; return response.promise;
  } });
  const output = h.render();
  const submit = new Function('recoveryRequest', `return ${submitCode}`)(output);
  const first = submit({ preventDefault() { prevented += 1; } });
  const second = submit({ preventDefault() { prevented += 1; } });
  await flush(); assert.equal(calls, 1); assert.equal(prevented, 2);
  response.resolve({ error: null }); await Promise.all([first, second]);
  assert.equal(h.render().message, PASSWORD_RECOVERY_REQUEST_NOTICE);
  assert.equal(h.render().remainingSeconds, 60);
  h.unmount();
});

test('returned errors and thrown failures never expose account or provider details', async () => {
  const operations = [
    async () => ({ error: null }),
    async () => ({ error: { status: 400, code: 'user_not_found' } }),
    async () => ({ error: { status: 429, code: 'over_email_send_rate_limit' } }),
    async () => ({ error: { status: 503, message: 'synthetic SMTP failure' } }),
    async () => { throw new Error('synthetic transport failure'); },
  ];
  for (const request of operations) {
    const h = harness({ active: true, email: 'synthetic@example.invalid', request });
    await h.render().submit();
    const output = h.render();
    assert.equal(output.message, PASSWORD_RECOVERY_REQUEST_NOTICE);
    assert.equal(output.error, null); assert.equal(output.blocked, true); assert.equal(output.remainingSeconds, 60);
    assert.doesNotMatch(output.message, /SMTP|503|user_not_found|enviamos|você receberá/);
    h.unmount();
  }
});

for (const transition of ['email', 'mode', 'email-aba', 'mode-aba']) {
  test(`a late response is discarded after ${transition}, including A-B-A`, async () => {
    const response = deferred();
    const h = harness({ active: true, email: 'a@example.invalid', request: () => response.promise });
    const pending = h.render().submit(); await flush();
    h.render().invalidate();
    if (transition.startsWith('email')) {
      h.render({ email: 'b@example.invalid' });
      if (transition.endsWith('aba')) h.render({ email: 'a@example.invalid' });
    } else {
      h.render({ active: false });
      if (transition.endsWith('aba')) h.render({ active: true });
    }
    const before = h.writes;
    response.resolve({ error: { status: 503 } }); await pending;
    assert.equal(h.writes, before); assert.equal(h.render().message, null);
    assert.equal(h.render().blocked, true); h.unmount();
  });
}

test('event invalidation rejects an old completion even before the next React commit', async () => {
  const response = deferred();
  const h = harness({ active: true, email: 'a@example.invalid', request: () => response.promise });
  const output = h.render(); const pending = output.submit(); await flush();
  output.invalidate(); const before = h.writes;
  response.resolve({ error: null }); await pending;
  assert.equal(h.writes, before); assert.equal(h.render().message, null); h.unmount();
});

test('visual timeout reports uncertainty while the real promise continues to own the lock', async () => {
  const response = deferred(); let calls = 0;
  const h = harness({ active: true, email: 'a@example.invalid', request: () => { calls += 1; return response.promise; } });
  const pending = h.render().submit(); await flush();
  h.waits[0](); await pending;
  assert.equal(h.render().message, PASSWORD_RECOVERY_REQUEST_UNCONFIRMED_NOTICE);
  assert.equal(h.render().isSubmitting, false); assert.equal(h.render().pending, true);
  h.advance(61_000);
  await h.render().submit(); assert.equal(calls, 1); assert.equal(h.render().blocked, true);
  const before = h.writes;
  response.resolve({ error: null }); await flush();
  assert.equal(h.writes, before); assert.equal(h.render().blocked, false);
  assert.equal(h.render().message, PASSWORD_RECOVERY_REQUEST_UNCONFIRMED_NOTICE); h.unmount();
});

test('unmount prevents callbacks and remount cannot duplicate a still-pending tab request', async () => {
  let clock = 0, calls = 0;
  const coordinator = createPasswordRecoveryRequestCoordinator({ now: () => clock });
  const response = deferred();
  const request = () => { calls += 1; return response.promise; };
  const first = harness({ active: true, email: 'a@example.invalid', request }, coordinator);
  const pending = first.render().submit(); await flush(); first.unmount();
  const second = harness({ active: true, email: 'b@example.invalid', request }, coordinator);
  await second.render().submit(); assert.equal(calls, 1);
  response.resolve({ error: null }); await pending;
  assert.equal(first.lateWrites, 0); assert.equal(second.render().message, null);
  assert.equal(second.render().blocked, true);
  clock = 60_000; coordinator.tick();
  assert.equal(second.render().blocked, false); second.unmount();
});

test('an old completion cannot replace the feedback of a new attempt in the same context', async () => {
  const responses = [deferred(), deferred()]; let calls = 0, next;
  const h = harness({ active: true, email: 'a@example.invalid', request: () => responses[calls++].promise });
  const first = h.render().submit(); await flush(); h.advance(61_000);
  const unsubscribe = h.coordinator.subscribe(() => {
    if (!next && !h.coordinator.getSnapshot().pending) next = h.render().submit();
  });
  responses[0].resolve({ error: null }); await first; await flush();
  assert.equal(calls, 2); assert.equal(h.render().isSubmitting, true); assert.equal(h.render().message, null);
  unsubscribe(); responses[1].resolve({ error: null }); await next;
  assert.equal(h.render().message, PASSWORD_RECOVERY_REQUEST_NOTICE); h.unmount();
});

test('invalid email is local validation and never consumes a request or cooldown', async () => {
  let calls = 0;
  const h = harness({ active: true, email: 'invalid', request: async () => { calls += 1; } });
  await h.render().submit();
  assert.equal(calls, 0); assert.ok(h.render().error); assert.equal(h.render().remainingSeconds, 0); h.unmount();
});
