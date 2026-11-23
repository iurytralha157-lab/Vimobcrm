import http from 'node:http';
import net from 'node:net';

const name = process.env.RELEASE_FIXTURE_NAME;
const web = process.env.RELEASE_FIXTURE_ORIGIN;

function reply(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function proxy(request, response, host, port, url) {
  const upstream = http.request({ hostname: host, port, path: url, method: request.method,
    headers: { ...request.headers, host: `${host}:${port}` } }, incoming => {
    response.writeHead(incoming.statusCode, incoming.headers);
    incoming.pipe(response);
  });
  upstream.on('error', () => {
    if (response.headersSent) response.destroy();
    else reply(response, 502, { error: 'fixture_upstream_unavailable' });
  });
  request.on('aborted', () => upstream.destroy());
  request.pipe(upstream);
}

http.createServer((request, response) => {
  const origin = request.headers.origin;
  if (origin && origin !== web) return reply(response, 403, { error: 'fixture_origin_required' });
  if (origin) {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('access-control-allow-headers', 'authorization,apikey,content-type,x-client-info,x-supabase-api-version');
    response.setHeader('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  }
  if (request.method === 'OPTIONS') return response.writeHead(204).end();
  if (request.url.startsWith('/auth/v1/')) return proxy(request, response, `${name}-auth`, 9999, request.url.slice(8));
  if (request.url.startsWith('/rest/v1/')) return proxy(request, response, `${name}-rest`, 3000, request.url.slice(8));
  reply(response, 501, { error: 'fixture_interface_out_of_scope' });
}).listen(58732);

http.createServer((request, response) => {
  if (request.url === '/__release_fixture') return reply(response, 200, { run: name, evolutionRequests });
  proxy(request, response, `${name}-api`, 8081, request.url);
}).listen(58731);

let evolutionRequests = 0;
http.createServer(async (request, response) => {
  const chunks = [];
  let bytes = 0;
  try {
    if (request.method !== 'POST' || request.url !== '/send/text') return reply(response, 404, { error: 'unexpected_evolution_call' });
    if (request.headers.apikey !== process.env.RELEASE_FIXTURE_PROVIDER || request.headers.instanceid !== name) {
      return reply(response, 401, { error: 'fixture_provider_identity_mismatch' });
    }
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 16 * 1024) return reply(response, 413, { error: 'fixture_input_limit' });
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (body.number !== '5511977001234' || typeof body.id !== 'string' || !body.id
      || typeof body.text !== 'string' || !body.text.startsWith('release-outbound-')) {
      return reply(response, 422, { error: 'unexpected_evolution_payload' });
    }
    evolutionRequests++;
    return reply(response, 200, { message: 'success', data: { Info: { ID: body.id, Timestamp: new Date().toISOString() } } });
  } catch {
    return reply(response, 400, { error: 'invalid_evolution_input' });
  }
}).listen(58734);

net.createServer(client => {
  const upstream = net.connect(5432, `${name}-db`);
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
  client.pipe(upstream).pipe(client);
}).listen(58733);
