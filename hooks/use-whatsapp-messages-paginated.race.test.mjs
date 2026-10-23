import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

// Runs the actual hook with React DOM and QueryClient. The API and auth scope
// are local deferred promises; no CRM server, Supabase, or provider is opened.
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack.js')
const repository = dirname(dirname(fileURLToPath(import.meta.url)))
const hookRoot = process.env.WHATSAPP_PAGINATED_HOOK_BASELINE_ROOT || repository
const scope = { organizationId: 'org-a', userId: 'user-a', accessScope: 'own-leads' }
let directory
let browser
let bundle

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-whatsapp-hook-race-'))
  const api = join(directory, 'api.js')
  const auth = join(directory, 'scope.js')
  const loader = join(directory, 'typescript-loader.cjs')
  const entry = join(directory, 'entry.js')
  await writeFile(api, `export const whatsappAPI = {
    getMessages: (params, transport) => window.harness.request(params, transport),
    getHistoryAccess: (params, transport) => window.harness.request(params, transport),
  }`)
  await writeFile(auth, 'export const useWhatsAppQueryScope = () => window.harness.scope')
  await writeFile(loader, `const ts = require(${JSON.stringify(require.resolve('typescript'))});
    module.exports = source => ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;`)
  await writeFile(entry, `
    import React, { useEffect } from 'react';
    import { createRoot } from 'react-dom/client';
    import { flushSync } from 'react-dom';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { useWhatsAppMessagesPaginated } from ${JSON.stringify(join(hookRoot, 'hooks/use-whatsapp-messages-paginated.ts'))};
    import { useLeadMessages } from ${JSON.stringify(join(repository, 'hooks/use-lead-messages.ts'))};
    import { whatsappQueryKeys, WHATSAPP_MESSAGES_RECONCILE_EVENT } from ${JSON.stringify(join(repository, 'lib/whatsapp-query-cache.ts'))};
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
    const root = createRoot(document.getElementById('root'));
    const baseTime = Date.now();
    const harness = window.harness = {
      client, keys: whatsappQueryKeys, scope: ${JSON.stringify(scope)}, requests: [], denials: [], clock: 0, mode: 'conversation',
      request(params, transport) { return new Promise((resolve, reject) => this.requests.push({ params, transport, resolve, reject })); },
      hint(detail) { window.dispatchEvent(new CustomEvent(WHATSAPP_MESSAGES_RECONCILE_EVENT, { detail })); },
      render(leadId, nextScope = this.scope) {
        this.scope = nextScope;
        flushSync(() => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Chat, { leadId }))));
      },
      unmount() { flushSync(() => root.render(null)); },
    };
    Date.now = () => baseTime + harness.clock;
    function Chat({ leadId }) {
      return harness.mode === 'lead-history'
        ? React.createElement(HistoryChat, { leadId })
        : React.createElement(ConversationChat, { leadId });
    }
    function HistoryChat({ leadId }) {
      const query = useLeadMessages(leadId, { pageSize: 2 });
      useEffect(() => { harness.query = query; harness.messages = query.messages; });
      return React.createElement('div', null, JSON.stringify(query.messages));
    }
    function ConversationChat({ leadId }) {
      const query = useWhatsAppMessagesPaginated('chat-a', {
        expectedLeadId: leadId, refetchIntervalMs: false, pageSize: 2,
        includeMediaUrls: harness.includeMediaUrls,
        historyLeadId: harness.mode === 'conversation-history' ? leadId : null,
        onConversationUnavailable: (conversationId, expectedLeadId) => harness.denials.push({ conversationId, expectedLeadId }),
      });
      useEffect(() => { harness.query = query; harness.messages = query.messages; });
      return React.createElement('div', null, JSON.stringify(query.messages));
    }
  `)
  await new Promise((resolveBuild, rejectBuild) => {
    const compiler = webpack({
      mode: 'development', target: 'web', entry,
      output: { path: directory, filename: 'hook.bundle.js', publicPath: '' },
      resolve: {
        extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'],
        alias: { '@/lib/api/whatsapp': api, '@/hooks/use-whatsapp-query-scope': auth,
          './use-whatsapp-query-scope': auth, '@': repository },
      },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
    })
    compiler.run((error, stats) => compiler.close(() => {
      if (error) return rejectBuild(error)
      if (stats.hasErrors()) return rejectBuild(new Error(stats.toString({ all: false, errors: true })))
      resolveBuild()
    }))
  })
  bundle = await readFile(join(directory, 'hook.bundle.js'), 'utf8')
  browser = await chromium.launch({ headless: true })
}, { timeout: 90_000 })

after(async () => {
  await browser?.close()
  if (directory) {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'))
    assert.ok(basename(directory).startsWith('vimob-whatsapp-hook-race-'))
    await rm(directory, { recursive: true, force: true })
  }
})

async function openHarness(t) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => route.abort())
  t.after(() => page.close())
  await page.setContent('<div id="root"></div>')
  await page.evaluate(() => { window.process = { env: { NODE_ENV: 'development' } } })
  await page.addScriptTag({ content: bundle })
  assert.equal(await page.evaluate(() => typeof window.harness), 'object', errors.join('\n'))
  return page
}

async function waitRequests(page, count, timeout = 30_000) {
  await page.waitForFunction(count => window.harness.requests.length >= count, count, { timeout })
}

async function resolvePage(page, index, body) {
  await page.evaluate(({ index, body }) => window.harness.requests[index].resolve({
    messages: [{ id: 'message-a', body, status: 'delivered', sent_at: '2026-10-11T00:00:00Z' }], nextCursor: null,
  }), { index, body })
}

for (const mode of ['conversation', 'conversation-history']) {
  for (const includeMediaUrls of [undefined, false, true]) {
    test(`${mode}: media preference ${includeMediaUrls} reaches every page without changing lead or viewer scope`, async t => {
      const page = await openHarness(t);
      await page.evaluate(({ mode, includeMediaUrls }) => {
        Object.assign(window.harness, { mode, includeMediaUrls });
        window.harness.render('lead-a');
      }, { mode, includeMediaUrls });
      await waitRequests(page, 1);
      const first = await page.evaluate(() => {
        const { params, transport } = window.harness.requests[0];
        return { params, expectedUserId: transport.expectedUserId, hasSignal: Boolean(transport.signal) };
      });
      assert.equal(first.params.includeMediaUrls, includeMediaUrls ?? true);
      assert.equal(first.params.organizationId, scope.organizationId);
      assert.equal(first.params[mode === 'conversation-history' ? 'leadId' : 'expectedLeadId'], 'lead-a');
      assert.equal(first.expectedUserId, scope.userId);
      assert.equal(first.hasSignal, true);
      await page.evaluate(() => window.harness.requests[0].resolve({ messages: [], nextCursor: 'older-page' }));
      await page.waitForFunction(() => window.harness.query.hasNextPage);
      await page.evaluate(() => { void window.harness.query.fetchNextPage(); });
      await waitRequests(page, 2);
      assert.equal(await page.evaluate(() => window.harness.requests[1].params.includeMediaUrls), includeMediaUrls ?? true);
      assert.equal(await page.evaluate(() => window.harness.requests[1].params.cursor), 'older-page');
    });
  }
}

test('A to B to A creates a fresh head request and ignores an older success or denial', async t => {
  const page = await openHarness(t)
  await page.evaluate(() => window.harness.render('lead-a'))
  await waitRequests(page, 1)
  await resolvePage(page, 0, 'A initial')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'A initial')
  await page.evaluate(() => window.harness.hint({ scope: window.harness.scope, conversationIds: ['chat-a'] }))
  await waitRequests(page, 2) // deferred custom head poll for old A
  await page.evaluate(() => window.harness.render('lead-b'))
  await waitRequests(page, 3)
  await resolvePage(page, 2, 'B initial')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'B initial')
  await page.evaluate(() => window.harness.render('lead-a'))
  await waitRequests(page, 4) // must not reuse the old A promise
  await resolvePage(page, 1, 'A stale private response')
  await resolvePage(page, 3, 'A current')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'A current')
  assert.deepEqual(await page.evaluate(() => window.harness.denials), [])
  assert.equal(await page.evaluate(() => window.harness.requests.filter(request => request.params.expectedLeadId === 'lead-a').length), 3)

  await page.evaluate(() => { window.harness.clock += 2_000; window.harness.hint({ scope: window.harness.scope, conversationIds: ['chat-a'] }) })
  await waitRequests(page, 5)
  await page.evaluate(() => window.harness.render('lead-b'))
  await waitRequests(page, 6)
  await resolvePage(page, 5, 'B current')
  await page.evaluate(() => window.harness.render('lead-a'))
  await waitRequests(page, 7)
  await page.evaluate(() => window.harness.requests[4].reject({ status: 403 }))
  await resolvePage(page, 6, 'A allowed now')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'A allowed now')
  assert.deepEqual(await page.evaluate(() => window.harness.denials), [])
})

test('transfer hint checks authorization immediately, evicts denial, and fences a late poll', async t => {
  const page = await openHarness(t)
  await page.evaluate(() => window.harness.render('lead-a'))
  await waitRequests(page, 1)
  await resolvePage(page, 0, 'private current message')
  await page.waitForFunction(() => window.harness.messages?.length === 1)
  await page.evaluate(() => {
    const h = window.harness
    h.client.setQueryData(h.keys.conversationSnapshot(h.scope, 'chat-a'), { private: true })
    h.client.setQueryData(h.keys.attendance(h.scope, 'chat-a', 'lead-a', 'session-a'), { private: true })
    h.client.setQueryData(h.keys.leadMessagesScope(h.scope, 'lead-a'), ['private'])
    h.client.setQueryData(h.keys.conversationSnapshot({ ...h.scope, organizationId: 'org-b' }, 'chat-a'), { keep: true })
    h.hint({ scope: h.scope, conversationIds: ['chat-a'] })
  })
  await waitRequests(page, 2) // old best-effort poll is pending
  await page.evaluate(() => {
    const h = window.harness
    h.clock += 250
    h.hint({ scope: h.scope }) // Queue a trailing inbox read behind the old poll.
    h.clock += 2_000
    h.hint({ scope: h.scope, leadIds: ['lead-a'], authorizationChanged: true })
  })
  await waitRequests(page, 3) // canonical fetch must not wait for poll/timer
  await page.evaluate(() => window.harness.requests[2].reject({ status: 403 }))
  await page.waitForFunction(() => window.harness.denials.length === 1 && window.harness.messages.length === 0)
  await resolvePage(page, 1, 'late private response')
  assert.equal(await page.evaluate(() => window.harness.client.getQueryData(window.harness.keys.conversationSnapshot(window.harness.scope, 'chat-a'))), undefined)
  assert.equal(await page.evaluate(() => window.harness.client.getQueryData(window.harness.keys.attendance(window.harness.scope, 'chat-a', 'lead-a', 'session-a'))), undefined)
  assert.equal(await page.evaluate(() => window.harness.client.getQueryData(window.harness.keys.leadMessagesScope(window.harness.scope, 'lead-a'))), undefined)
  assert.deepEqual(await page.evaluate(() => window.harness.client.getQueryData(window.harness.keys.conversationSnapshot({ ...window.harness.scope, organizationId: 'org-b' }, 'chat-a'))), { keep: true })
  assert.deepEqual(await page.evaluate(() => window.harness.messages), [])

  await page.evaluate(() => window.harness.hint({ scope: { ...window.harness.scope, organizationId: 'org-b' }, authorizationChanged: true }))
  await page.waitForTimeout(1_200)
  assert.equal(await page.evaluate(() => window.harness.requests.length), 3)
  await page.evaluate(() => { void window.harness.query.refetch() })
  await waitRequests(page, 4)
  await resolvePage(page, 3, 'explicitly authorized again')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'explicitly authorized again')
})

test('tracked initial fetches cannot cross a tenant change or revive A after rebind', async t => {
  const page = await openHarness(t)
  await page.evaluate(() => window.harness.render('lead-a'))
  await waitRequests(page, 1)
  await page.evaluate(() => window.harness.render('lead-b', { ...window.harness.scope, organizationId: 'org-b' }))
  await waitRequests(page, 2)
  await page.evaluate(scope => window.harness.render('lead-a', scope), scope)
  await waitRequests(page, 3)
  await resolvePage(page, 0, 'old A before transfer')
  await page.evaluate(() => window.harness.requests[1].reject({ status: 404 }))
  await resolvePage(page, 2, 'current A after return')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'current A after return')
  assert.deepEqual(await page.evaluate(() => window.harness.denials), [])
  assert.equal(await page.evaluate(() => window.harness.requests.length), 3)
})

test('an inbox hint inside the head refresh gap performs one trailing canonical read', async t => {
  const page = await openHarness(t)
  await page.evaluate(() => window.harness.render('unlinked'))
  await waitRequests(page, 1)
  await resolvePage(page, 0, 'private initial')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'private initial')
  await page.evaluate(() => window.harness.hint({ scope: window.harness.scope }))
  await waitRequests(page, 2)
  await resolvePage(page, 1, 'first commit')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'first commit')
  await page.evaluate(() => {
    const h = window.harness
    h.clock += 250
    h.hint({ scope: h.scope }) // A second inbox commit inside the 1 s window.
    h.hint({ scope: h.scope }) // Duplicate transport wake must coalesce.
    h.clock += 1_000
  })
  await waitRequests(page, 3, 2_500)
  await resolvePage(page, 2, 'second commit')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'second commit')
  assert.equal(await page.evaluate(() => window.harness.requests.length), 3)
})

test('an inbox hint during the tracked initial GET is reread after that GET settles', async t => {
  const page = await openHarness(t)
  await page.evaluate(() => window.harness.render('lead-a'))
  await waitRequests(page, 1)
  await page.evaluate(() => window.harness.hint({ scope: window.harness.scope }))
  await resolvePage(page, 0, 'snapshot before the commit')
  await waitRequests(page, 2, 2_500)
  await resolvePage(page, 1, 'commit after the initial snapshot')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'commit after the initial snapshot')
  assert.equal(await page.evaluate(() => window.harness.requests.length), 2)
})

test('a newer inbox commit during a custom head GET is not satisfied by its older response', async t => {
  const page = await openHarness(t)
  await page.evaluate(() => window.harness.render('lead-a'))
  await waitRequests(page, 1)
  await resolvePage(page, 0, 'initial snapshot')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'initial snapshot')
  await page.evaluate(() => window.harness.hint({ scope: window.harness.scope }))
  await waitRequests(page, 2)
  await page.evaluate(() => {
    const h = window.harness
    h.clock += 2_000
    h.hint({ scope: h.scope }) // A commit newer than the in-flight GET.
  })
  await resolvePage(page, 1, 'older in-flight snapshot')
  await waitRequests(page, 3, 2_500)
  await resolvePage(page, 2, 'newest committed message')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'newest committed message')
  assert.equal(await page.evaluate(() => window.harness.requests.length), 3)
})

test('a pending head hint survives callback and scope identity changes with the same fingerprint', async t => {
  const page = await openHarness(t)
  await page.evaluate(() => window.harness.render('lead-a'))
  await waitRequests(page, 1)
  await resolvePage(page, 0, 'initial snapshot')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'initial snapshot')
  await page.evaluate(() => window.harness.hint({ scope: window.harness.scope }))
  await waitRequests(page, 2)
  await page.evaluate(() => {
    const h = window.harness
    h.clock += 250
    h.hint({ scope: h.scope })
  })
  await resolvePage(page, 1, 'older snapshot triggers a render')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'older snapshot triggers a render')
  await page.evaluate(() => {
    const h = window.harness
    h.render('lead-a', { ...h.scope }) // Equal tenant/auth values, new callback and scope objects.
    h.clock += 1_000
  })
  await waitRequests(page, 3, 2_500)
  await resolvePage(page, 2, 'new commit after same-scope render')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'new commit after same-scope render')
  assert.equal(await page.evaluate(() => window.harness.requests.length), 3)
})

test('a queued inbox hint cannot issue a read after denial or a tenant switch', async t => {
  const page = await openHarness(t)
  await page.evaluate(() => window.harness.render('lead-a'))
  await waitRequests(page, 1)
  await resolvePage(page, 0, 'private snapshot')
  await page.waitForFunction(() => window.harness.messages?.length === 1)
  await page.evaluate(() => window.harness.hint({ scope: window.harness.scope }))
  await waitRequests(page, 2)
  await page.evaluate(() => {
    const h = window.harness
    h.clock += 250
    h.hint({ scope: h.scope })
    h.clock += 2_000
    h.requests[1].reject({ status: 403 })
  })
  await page.waitForFunction(() => window.harness.denials.length === 1 && window.harness.messages.length === 0)
  await page.waitForTimeout(1_200)
  assert.equal(await page.evaluate(() => window.harness.requests.length), 2)

  await page.evaluate(() => { void window.harness.query.refetch() })
  await waitRequests(page, 3)
  await resolvePage(page, 2, 'explicit grant restored')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'explicit grant restored')
  await page.evaluate(() => window.harness.hint({ scope: window.harness.scope }))
  await waitRequests(page, 4)
  await resolvePage(page, 3, 'allowed head')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'allowed head')
  await page.evaluate(() => {
    const h = window.harness
    h.hint({ scope: h.scope })
    h.clock += 2_000
    h.render('lead-b', { ...h.scope, organizationId: 'org-b' })
  })
  await waitRequests(page, 5)
  await resolvePage(page, 4, 'other tenant')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'other tenant')
  await page.waitForTimeout(1_200)
  assert.equal(await page.evaluate(() => window.harness.requests.length), 5)
})

test('a pending inbox hint waits without reads while hidden or offline and resumes once online', async t => {
  const page = await openHarness(t)
  await page.evaluate(() => window.harness.render('unlinked'))
  await waitRequests(page, 1)
  await resolvePage(page, 0, 'initial private snapshot')
  await page.waitForFunction(() => window.harness.messages?.length === 1)
  await page.evaluate(() => window.harness.hint({ scope: window.harness.scope }))
  await waitRequests(page, 2)
  await resolvePage(page, 1, 'first private commit')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'first private commit')
  await page.evaluate(() => {
    const h = window.harness
    h.clock += 250
    h.hint({ scope: h.scope })
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    h.clock += 2_000
    h.hint({ scope: h.scope })
  })
  await page.waitForTimeout(1_200)
  assert.equal(await page.evaluate(() => window.harness.requests.length), 2)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    window.dispatchEvent(new Event('online'))
  })
  await waitRequests(page, 3, 2_500)
  await resolvePage(page, 2, 'latest private commit after reconnect')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'latest private commit after reconnect')
  assert.equal(await page.evaluate(() => window.harness.requests.length), 3)
})

test('closing the chat cancels its pending head timer before another read starts', async t => {
  const page = await openHarness(t)
  await page.evaluate(() => window.harness.render('lead-a'))
  await waitRequests(page, 1)
  await resolvePage(page, 0, 'initial snapshot')
  await page.waitForFunction(() => window.harness.messages?.length === 1)
  await page.evaluate(() => window.harness.hint({ scope: window.harness.scope }))
  await waitRequests(page, 2)
  await resolvePage(page, 1, 'latest allowed snapshot')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'latest allowed snapshot')
  await page.evaluate(() => {
    const h = window.harness
    h.clock += 250
    h.hint({ scope: h.scope })
    h.unmount()
    h.clock += 2_000
  })
  await page.waitForTimeout(1_200)
  assert.equal(await page.evaluate(() => window.harness.requests.length), 2)
  assert.equal(await page.locator('#root').innerText(), '')
})

for (const mode of ['conversation', 'lead-history']) {
  test(`${mode}: expired v2 cursor rebases to a fresh head once and does not retry a repeated expiry`, async t => {
    const page = await openHarness(t)
    await page.evaluate(mode => { window.harness.mode = mode; window.harness.render('lead-a') }, mode)
    await waitRequests(page, 1)
    await page.evaluate(() => window.harness.requests[0].resolve({
      messages: [{ id: 'stale-head', body: 'stale snapshot', sent_at: '2026-10-11T12:00:00Z' }],
      nextCursor: 'v2-old-anchor',
    }))
    await page.waitForFunction(() => window.harness.messages?.[0]?.id === 'stale-head')
    await page.evaluate(() => { void window.harness.query.loadOlderMessages() })
    await waitRequests(page, 2)
    assert.equal(await page.evaluate(() => window.harness.requests[1].params.cursor), 'v2-old-anchor')
    await page.evaluate(() => window.harness.requests[1].reject({
      status: 409, code: 'whatsapp_message_cursor_rebase_required',
    }))
    await waitRequests(page, 3, 2_500)
    assert.equal(await page.evaluate(() => window.harness.requests[2].params.cursor), null)
    await page.evaluate(() => window.harness.requests[2].resolve({
      messages: [{ id: 'fresh-head', body: 'authoritative fresh head', sent_at: '2026-10-11T12:01:00Z' }],
      nextCursor: 'v2-new-anchor',
    }))
    await page.waitForFunction(() => window.harness.messages?.[0]?.id === 'fresh-head')
    assert.deepEqual(await page.evaluate(() => window.harness.messages.map(({ id }) => id)), ['fresh-head'])
    assert.deepEqual(await page.evaluate(() => window.harness.denials), [])
    await page.evaluate(() => { void window.harness.query.loadOlderMessages() })
    await waitRequests(page, 4)
    assert.equal(await page.evaluate(() => window.harness.requests[3].params.cursor), 'v2-new-anchor')
    await page.evaluate(() => window.harness.requests[3].reject({
      status: 409, code: 'whatsapp_message_cursor_rebase_required',
    }))
    await page.waitForFunction(() => window.harness.query.isError)
    await page.waitForTimeout(1_200)
    assert.equal(await page.evaluate(() => window.harness.requests.length), 4)
  })
}

test('403 on an older page closes access without treating it as cursor expiry', async t => {
  const page = await openHarness(t)
  await page.evaluate(() => window.harness.render('lead-a'))
  await waitRequests(page, 1)
  await page.evaluate(() => window.harness.requests[0].resolve({
    messages: [{ id: 'private', sent_at: '2026-10-11T12:00:00Z' }], nextCursor: 'v2-anchor',
  }))
  await page.waitForFunction(() => window.harness.messages?.length === 1)
  await page.evaluate(() => { void window.harness.query.loadOlderMessages() })
  await waitRequests(page, 2)
  await page.evaluate(() => window.harness.requests[1].reject({
    status: 403, code: 'whatsapp_message_cursor_rebase_required',
  }))
  await page.waitForFunction(() => window.harness.denials.length === 1 && window.harness.messages.length === 0)
  await page.waitForTimeout(1_200)
  assert.equal(await page.evaluate(() => window.harness.requests.length), 2)
})

test('cursor rebase fences a custom head request started before the expired anchor', async t => {
  const page = await openHarness(t)
  await page.evaluate(() => window.harness.render('lead-a'))
  await waitRequests(page, 1)
  await page.evaluate(() => window.harness.requests[0].resolve({
    messages: [{ id: 'old-head', body: 'old authorized snapshot', sent_at: '2026-10-11T12:00:00Z' }],
    nextCursor: 'v2-old-anchor',
  }))
  await page.waitForFunction(() => window.harness.messages?.length === 1)
  await page.evaluate(() => window.harness.hint({ scope: window.harness.scope }))
  await waitRequests(page, 2)
  await page.evaluate(() => { void window.harness.query.loadOlderMessages() })
  await waitRequests(page, 3)
  await page.evaluate(() => window.harness.requests[2].reject({
    status: 409, code: 'whatsapp_message_cursor_rebase_required',
  }))
  await waitRequests(page, 4, 2_500)
  await resolvePage(page, 3, 'fresh generation snapshot')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'fresh generation snapshot')
  await page.evaluate(() => window.harness.requests[1].reject({ status: 403 }))
  await page.waitForTimeout(300)
  assert.deepEqual(await page.evaluate(() => window.harness.denials), [])
  assert.equal(await page.evaluate(() => window.harness.messages?.[0]?.body), 'fresh generation snapshot')
})

async function seedLoadedHistory(page) {
  await page.evaluate(() => window.harness.render('lead-a'))
  await waitRequests(page, 1)
  await page.evaluate(() => window.harness.requests[0].resolve({
    messages: [{ id: 'recent', status: 'received', content: 'recent', sent_at: '2026-10-11T12:00:00Z' }],
    nextCursor: 'older-anchor',
  }))
  await page.waitForFunction(() => window.harness.messages?.length === 1)
  await page.evaluate(() => { void window.harness.query.loadOlderMessages() })
  await waitRequests(page, 2)
  await page.evaluate(() => window.harness.requests[1].resolve({
    messages: [
      { id: 'old-delete', status: 'received', content: 'old private text', sent_at: '2026-10-10T12:00:00Z' },
      { id: 'old-receipt', status: 'sent', content: 'sent earlier', sent_at: '2026-10-10T12:01:00Z' },
    ], nextCursor: 'not-loaded',
  }))
  await page.waitForFunction(() => window.harness.messages?.length === 3)
}

async function resolveSameHead(page, index) {
  await page.evaluate(index => window.harness.requests[index].resolve({
    messages: [{ id: 'recent', status: 'received', content: 'recent', sent_at: '2026-10-11T12:00:00Z' }],
    nextCursor: 'older-anchor',
  }), index)
}

test('historical updates: a wake updates deletion and receipt outside the unchanged head', async t => {
  const page = await openHarness(t)
  await seedLoadedHistory(page)
  await page.evaluate(() => window.harness.hint({ scope: window.harness.scope }))
  await waitRequests(page, 3)
  await resolveSameHead(page, 2)
  await page.waitForTimeout(250)
  assert.equal(await page.evaluate(() => window.harness.requests.length), 4, 'the loaded historical cursor must also be authorized again')
  assert.equal(await page.evaluate(() => window.harness.requests[3].params.cursor), 'older-anchor')
  await page.evaluate(() => window.harness.requests[3].resolve({
    messages: [
      { id: 'old-delete', status: 'received', content: 'Esta mensagem foi apagada', message_type: 'deleted', sent_at: '2026-10-10T12:00:00Z' },
      { id: 'old-receipt', status: 'read', content: 'sent earlier', sent_at: '2026-10-10T12:01:00Z' },
    ], nextCursor: 'not-loaded',
  }))
  await page.waitForFunction(() => window.harness.messages.find(row => row.id === 'old-receipt')?.status === 'read')
  assert.equal(await page.evaluate(() => window.harness.messages.find(row => row.id === 'old-delete')?.message_type), 'deleted')
  assert.deepEqual(await page.evaluate(() => window.harness.messages.map(({ id }) => id)), ['old-delete', 'old-receipt', 'recent'])
  assert.equal(await page.evaluate(() => window.harness.client.getQueryCache().findAll({
    predicate: query => query.queryKey[0] === 'whatsapp-messages-paginated',
  })[0].state.data.pages.at(-1).nextCursor), 'not-loaded')
})

test('head refresh failure: exposes stale-data failure without deleting messages and supports a retry', async t => {
  const page = await openHarness(t)
  await page.evaluate(() => window.harness.render('lead-a'))
  await waitRequests(page, 1)
  await resolvePage(page, 0, 'keep this authorized text')
  await page.waitForFunction(() => window.harness.messages?.length === 1)
  await page.evaluate(() => window.harness.hint({ scope: window.harness.scope }))
  await waitRequests(page, 2)
  await page.evaluate(() => window.harness.requests[1].reject({ status: 503 }))
  await page.waitForTimeout(200)
  assert.equal(await page.evaluate(() => window.harness.query.isReconciliationError), true)
  assert.equal(await page.evaluate(() => window.harness.messages?.[0]?.body), 'keep this authorized text')
  await page.evaluate(() => { window.harness.clock += 2_000; void window.harness.query.retryReconciliation() })
  await waitRequests(page, 3)
  await resolvePage(page, 2, 'current authorized text')
  await page.waitForFunction(() => window.harness.query.isReconciliationError === false)
  assert.equal(await page.evaluate(() => window.harness.messages?.[0]?.body), 'current authorized text')
})

test('public page reads: search reads stay out of cache and stale ABA responses are cancelled', async t => {
  const page = await openHarness(t)
  await page.evaluate(() => window.harness.render('lead-a'))
  await waitRequests(page, 1)
  await resolvePage(page, 0, 'visible authorized text')
  await page.waitForFunction(() => window.harness.messages?.length === 1)
  assert.equal(await page.evaluate(() => typeof window.harness.query.readMessagePage), 'function')
  await page.evaluate(() => {
    window.harness.readResult = null
    window.harness.query.readMessagePage('search-only').then(
      page => { window.harness.readResult = { rows: page.messages.length } },
      error => { window.harness.readResult = { cancelled: error.silent === true } },
    )
  })
  await waitRequests(page, 2)
  await page.evaluate(() => window.harness.requests[1].resolve({ messages: [{ id: 'search-result' }], nextCursor: null }))
  await page.waitForFunction(() => window.harness.readResult?.rows === 1)
  assert.equal(await page.evaluate(() => window.harness.messages?.[0]?.body), 'visible authorized text')
  await page.evaluate(() => {
    window.harness.query.readMessagePage('stale-search').catch(error => { window.harness.readResult = { cancelled: error.silent === true } })
  })
  await waitRequests(page, 3)
  await page.evaluate(() => window.harness.render('lead-b'))
  await waitRequests(page, 4)
  await resolvePage(page, 3, 'B current')
  await page.evaluate(() => window.harness.render('lead-a'))
  await waitRequests(page, 5)
  await resolvePage(page, 4, 'A current')
  await page.evaluate(() => window.harness.requests[2].resolve({ messages: [{ id: 'private obsolete A' }], nextCursor: null }))
  await page.waitForFunction(() => window.harness.readResult?.cancelled === true)
  assert.equal(await page.evaluate(() => window.harness.messages?.[0]?.body), 'A current')
})

test('historical updates: wake bursts keep the head fast but coalesce historical reads for 30 seconds', async t => {
  const page = await openHarness(t)
  await seedLoadedHistory(page)
  await page.evaluate(() => window.harness.hint({ scope: window.harness.scope }))
  await waitRequests(page, 3)
  await resolveSameHead(page, 2)
  await waitRequests(page, 4)
  await page.evaluate(() => window.harness.requests[3].resolve({
    messages: [{ id: 'old-delete', status: 'received', content: 'unchanged', sent_at: '2026-10-10T12:00:00Z' }], nextCursor: 'not-loaded',
  }))
  await page.waitForFunction(() => window.harness.messages.find(row => row.id === 'old-delete')?.content === 'unchanged')
  for (const index of [4, 5]) {
    await page.evaluate(() => { window.harness.clock += 2_000; window.harness.hint({ scope: window.harness.scope }) })
    await waitRequests(page, index + 1)
    await resolveSameHead(page, index)
  }
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => window.harness.requests.filter(request => request.params.cursor !== null).length), 2, 'initial older load plus exactly one historical revalidation')
  await page.evaluate(() => { window.harness.clock += 30_000; window.harness.hint({ scope: window.harness.scope }) })
  await waitRequests(page, 7)
  await resolveSameHead(page, 6)
  await waitRequests(page, 8)
  assert.equal(await page.evaluate(() => window.harness.requests[7].params.cursor), 'older-anchor')
})

test('historical updates: denial evicts current history and aborts outstanding search without affecting another tenant', async t => {
  const page = await openHarness(t)
  await seedLoadedHistory(page)
  await page.evaluate(() => {
    const h = window.harness
    h.client.setQueryData(h.keys.conversationSnapshot({ ...h.scope, organizationId: 'org-b' }, 'chat-a'), { keep: true })
    h.hint({ scope: h.scope })
  })
  await waitRequests(page, 3)
  await resolveSameHead(page, 2)
  await waitRequests(page, 4)
  await page.evaluate(() => {
    window.harness.query.readMessagePage('search').catch(error => { window.harness.readCancelled = error.silent === true })
  })
  await waitRequests(page, 5)
  await page.evaluate(() => window.harness.requests[3].reject({ status: 403 }))
  await page.waitForFunction(() => window.harness.denials.length === 1 && window.harness.messages.length === 0)
  assert.equal(await page.evaluate(() => window.harness.requests[4].transport.signal.aborted), true)
  await page.evaluate(() => window.harness.requests[4].resolve({ messages: [{ id: 'stale private' }], nextCursor: null }))
  await page.waitForFunction(() => window.harness.readCancelled === true)
  assert.deepEqual(await page.evaluate(() => {
    const h = window.harness
    return h.client.getQueryData(h.keys.conversationSnapshot({ ...h.scope, organizationId: 'org-b' }, 'chat-a'))
  }), { keep: true })
})

test('historical updates: stale receipt response cannot overwrite a newer cached deletion', async t => {
  const page = await openHarness(t)
  await seedLoadedHistory(page)
  await page.evaluate(() => window.harness.hint({ scope: window.harness.scope }))
  await waitRequests(page, 3)
  await resolveSameHead(page, 2)
  await waitRequests(page, 4)
  await page.evaluate(() => {
    window.harness.client.setQueriesData({ predicate: query => query.queryKey[0] === 'whatsapp-messages-paginated' }, cached => ({
      ...cached, pages: cached.pages.map(page => ({ ...page, messages: page.messages.map(row => row.id === 'old-delete'
        ? { ...row, content: 'Esta mensagem foi apagada', message_type: 'deleted' } : row) })),
    }))
    window.harness.requests[3].resolve({
      messages: [{ id: 'old-delete', content: 'obsolete secret', status: 'received', sent_at: '2026-10-10T12:00:00Z' }], nextCursor: null,
    })
  })
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => window.harness.messages.find(row => row.id === 'old-delete')?.message_type), 'deleted')
  assert.equal(await page.evaluate(() => window.harness.messages.find(row => row.id === 'old-delete')?.content), 'Esta mensagem foi apagada')
})

test('historical updates: a head success does not hide a historical failure and explicit retry restores it', async t => {
  const page = await openHarness(t)
  await seedLoadedHistory(page)
  await page.evaluate(() => window.harness.hint({ scope: window.harness.scope }))
  await waitRequests(page, 3)
  await resolveSameHead(page, 2)
  await waitRequests(page, 4)
  await page.evaluate(() => window.harness.requests[3].reject({ status: 503 }))
  await page.waitForFunction(() => window.harness.query.isReconciliationError === true)
  assert.equal(await page.evaluate(() => window.harness.messages.find(row => row.id === 'old-delete')?.content), 'old private text')
  await page.evaluate(() => { window.harness.clock += 2_000; window.harness.hint({ scope: window.harness.scope }) })
  await waitRequests(page, 5)
  await resolveSameHead(page, 4)
  await page.waitForTimeout(100)
  assert.equal(await page.evaluate(() => window.harness.query.isReconciliationError), true)
  await page.evaluate(() => { void window.harness.query.retryReconciliation() })
  await waitRequests(page, 6)
  await resolveSameHead(page, 5)
  await waitRequests(page, 7)
  await page.evaluate(() => window.harness.requests[6].resolve({
    messages: [{ id: 'old-delete', content: 'Esta mensagem foi apagada', message_type: 'deleted', status: 'received', sent_at: '2026-10-10T12:00:00Z' }], nextCursor: null,
  }))
  await page.waitForFunction(() => window.harness.query.isReconciliationError === false)
})

test('historical updates: expiry rebases once and obsolete historical success cannot revive prior cache', async t => {
  const page = await openHarness(t)
  await seedLoadedHistory(page)
  await page.evaluate(() => window.harness.hint({ scope: window.harness.scope }))
  await waitRequests(page, 3)
  await resolveSameHead(page, 2)
  await waitRequests(page, 4)
  await page.evaluate(() => window.harness.requests[3].reject({ status: 409, code: 'whatsapp_message_cursor_rebase_required' }))
  await waitRequests(page, 5)
  assert.equal(await page.evaluate(() => window.harness.requests[4].params.cursor), null)
  await resolvePage(page, 4, 'fresh canonical window')
  await page.waitForFunction(() => window.harness.messages?.[0]?.body === 'fresh canonical window')
  assert.deepEqual(await page.evaluate(() => window.harness.messages.map(row => row.id)), ['message-a'])
  assert.deepEqual(await page.evaluate(() => window.harness.denials), [])
})

test('historical updates: four-page batches pause while hidden, resume and cancel on closing', async t => {
  const page = await openHarness(t)
  await page.evaluate(() => window.harness.render('lead-a'))
  await waitRequests(page, 1)
  await resolvePage(page, 0, 'initial')
  await page.waitForFunction(() => window.harness.messages?.length === 1)
  await page.evaluate(() => {
    const h = window.harness
    h.client.setQueriesData({ predicate: query => query.queryKey[0] === 'whatsapp-messages-paginated' }, cached => ({
      ...cached,
      pages: Array.from({ length: 8 }, (_, index) => ({
        messages: [{ id: `row-${index}`, content: 'loaded', sent_at: `2026-10-${String(12 - index).padStart(2, '0')}T12:00:00Z` }],
        nextCursor: `cursor-${index + 1}`,
      })),
    }))
    h.hint({ scope: h.scope })
  })
  await waitRequests(page, 2)
  await page.evaluate(() => window.harness.requests[1].resolve({
    messages: [{ id: 'row-0', content: 'loaded', sent_at: '2026-10-12T12:00:00Z' }], nextCursor: 'cursor-1',
  }))
  for (const index of [2, 3, 4, 5]) {
    await waitRequests(page, index + 1)
    await page.evaluate(index => window.harness.requests[index].resolve({
      messages: [{ id: `row-${index - 1}`, content: 'refreshed', sent_at: `2026-10-${String(13 - index).padStart(2, '0')}T12:00:00Z` }],
      nextCursor: `cursor-${index}`,
    }), index)
  }
  await page.waitForTimeout(200)
  assert.equal(await page.evaluate(() => window.harness.requests.length), 6)
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }))
  await page.waitForTimeout(1_100)
  assert.equal(await page.evaluate(() => window.harness.requests.length), 6)
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }))
  await waitRequests(page, 7, 2_000)
  assert.equal(await page.evaluate(() => window.harness.requests[6].params.cursor), 'cursor-5')
  await page.evaluate(() => window.harness.unmount())
  assert.equal(await page.evaluate(() => window.harness.requests[6].transport.signal.aborted), true)
  await page.evaluate(() => window.harness.requests[6].resolve({ messages: [{ id: 'row-5', content: 'late response' }], nextCursor: 'cursor-6' }))
  await page.waitForTimeout(1_100)
  assert.equal(await page.evaluate(() => window.harness.requests.length), 7)
})

for (const mode of ['conversation-history', 'lead-history']) {
  test(`${mode}: real 400 reference denial evicts scoped history and keeps other actors and leads`, async t => {
    const page = await openHarness(t)
    await page.evaluate(mode => { window.harness.mode = mode; window.harness.render('lead-a') }, mode)
    await waitRequests(page, 1)
    await resolvePage(page, 0, 'private lead history')
    await page.waitForFunction(() => window.harness.messages?.length === 1)
    await page.evaluate(() => {
      const h = window.harness
      h.client.setQueryData(h.keys.conversationSnapshot(h.scope, 'chat-a'), { lead_id: 'lead-a', private: true })
      h.client.setQueryData(h.keys.attendance(h.scope, 'chat-a', 'lead-a', 'session-a'), { private: true })
      h.client.setQueryData(h.keys.leadMessages(h.scope, 'lead-b', 40), { keep: true })
      h.client.setQueryData(h.keys.leadMessages({ ...h.scope, organizationId: 'org-b' }, 'lead-a', 40), { keep: true })
      h.client.setQueryData(h.keys.leadMessages({ ...h.scope, userId: 'user-b' }, 'lead-a', 40), { keep: true })
      void h.query.refetch()
    })
    await waitRequests(page, 2)
    await page.evaluate(() => window.harness.requests[1].reject({ status: 400, code: 'invalid_whatsapp_reference' }))
    await page.waitForFunction(() => window.harness.messages.length === 0)
    assert.equal(await page.evaluate(() => window.harness.client.getQueryData(window.harness.keys.conversationSnapshot(window.harness.scope, 'chat-a'))), undefined)
    assert.equal(await page.evaluate(() => window.harness.client.getQueryData(window.harness.keys.attendance(window.harness.scope, 'chat-a', 'lead-a', 'session-a'))), undefined)
    for (const target of ['other-lead', 'other-org', 'other-user']) {
      assert.deepEqual(await page.evaluate(target => {
        const h = window.harness
        const scope = target === 'other-org' ? { ...h.scope, organizationId: 'org-b' }
          : target === 'other-user' ? { ...h.scope, userId: 'user-b' } : h.scope
        return h.client.getQueryData(h.keys.leadMessages(scope, target === 'other-lead' ? 'lead-b' : 'lead-a', 40))
      }, target), { keep: true })
    }
    await page.waitForTimeout(1_200)
    assert.equal(await page.evaluate(() => window.harness.requests.length), 2)
  })
}
