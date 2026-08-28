import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { runPreflight } from './qa-persona-preflight.mjs';

async function withTestAPI(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function successfulResponse(request, response, organizations = []) {
  assert.equal(request.method, 'GET');
  if (request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (request.url === '/readyz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ready' }));
    return;
  }
  if (request.url === '/v1/me') {
    assert.equal(request.headers.authorization, 'Bearer test-token');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ context: { isSuperAdmin: true, userId: 'superadmin-id' } }));
    return;
  }
  if (request.url?.startsWith('/v1/admin/organizations?search=')) {
    assert.equal(request.headers.authorization, 'Bearer test-token');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: organizations }));
    return;
  }

  response.writeHead(404).end();
}

test('preflight is read-only and passes all authority gates', async () => {
  const methods = [];
  const result = await withTestAPI(
    (request, response) => {
      methods.push(request.method);
      successfulResponse(request, response);
    },
    (apiURL) => runPreflight({
      apiURL,
      accessToken: 'test-token',
      runLabel: 'VIMOB-QA-20260816-A1B2',
    }),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(methods, ['GET', 'GET', 'GET', 'GET']);
});

test('preflight fails closed when the authenticated user is not a superadmin', async () => {
  await assert.rejects(
    withTestAPI(
      (request, response) => {
        if (request.url === '/v1/me') {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ context: { isSuperAdmin: false, userId: 'ordinary-user' } }));
          return;
        }
        successfulResponse(request, response);
      },
      (apiURL) => runPreflight({
        apiURL,
        accessToken: 'test-token',
        runLabel: 'VIMOB-QA-20260816-A1B2',
      }),
    ),
    /isSuperAdmin=true/,
  );
});

test('preflight rejects an existing organization with the same exact run label', async () => {
  const runLabel = 'VIMOB-QA-20260816-A1B2';
  await assert.rejects(
    withTestAPI(
      (request, response) => successfulResponse(request, response, [{ id: 'existing', name: runLabel }]),
      (apiURL) => runPreflight({ apiURL, accessToken: 'test-token', runLabel }),
    ),
    /Run label collision/,
  );
});

