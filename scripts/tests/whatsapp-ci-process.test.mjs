import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { command, postgresServerOptions, startPostgres } from './whatsapp-ci-fixture.mjs';

async function startupRoot(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'vimob-ci-startup-'));
  assert.equal(path.dirname(path.resolve(parent)), path.resolve(os.tmpdir()));
  assert.match(path.basename(parent), /^vimob-ci-startup-/);
  const root = path.join(parent, 'vimob-whatsapp-ci');
  await mkdir(path.join(root, 'results'), { recursive: true });
  t.after(() => rm(parent, { recursive: true, force: true }));
  return root;
}

test('noninteractive child receives EOF and retains output/exit proof', async () => {
  const result = await command(process.execPath, ['-e',
    'process.stdin.resume(); process.stdin.on("end",()=>process.stdout.write("eof-proof"));'], { timeout: 5000 });
  assert.equal(result.stdout, 'eof-proof'); assert.equal(result.stderr, '');
});
test('a stuck owned command is bounded and cannot masquerade as success', async () => {
  await assert.rejects(command(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeout: 100 }),
    error => error.killed === true);
});

test('owned PostgreSQL uses only loopback TCP independently of distribution socket defaults', () => {
  assert.match(postgresServerOptions, /(?:^| )-h 127\.0\.0\.1(?: |$)/);
  assert.match(postgresServerOptions, /(?:^| )-p 57924(?: |$)/);
  assert.match(postgresServerOptions, /(?:^| )-c unix_socket_directories=(?: |$)/);
  assert.match(postgresServerOptions, /(?:^| )-c fsync=on(?: |$)/);
  assert.match(postgresServerOptions, /(?:^| )-c synchronous_commit=on(?: |$)/);
});

test('owned startup accepts a successful child without an open stdin or output pipe', async t => {
  const root = await startupRoot(t);
  await startPostgres(process.execPath, ['-e',
    'process.stdin.resume();process.stdin.on("end",()=>process.stdout.write("ready"));'], root);
  assert.equal(await readFile(path.join(root, 'pgctl-startup.log'), 'utf8'), 'ready');
});

test('failed startup exposes bounded server diagnostics while redacting synthetic credentials', async t => {
  const root = await startupRoot(t), password = 'a'.repeat(64), nonce = 'b'.repeat(64);
  const child = 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],"x".repeat(50000)+"\\nFATAL: socket permission denied "'
    + '+process.argv[2]+" "+process.argv[3]+" postgresql://postgres:synthetic@127.0.0.1/db");'
    + 'process.stderr.write("pg_ctl: could not start server");process.exit(1)';
  await assert.rejects(startPostgres(process.execPath, ['-e', child, path.join(root, 'postgres.log'), password, nonce],
    root, [password, nonce]), error => {
    assert.match(error.message, /owned pg_ctl start failed: 1/);
    assert.match(error.message, /FATAL: socket permission denied/);
    assert.doesNotMatch(error.message, /a{64}|b{64}|postgresql:\/\//);
    assert.ok(error.message.length < 34_000);
    return true;
  });
  const diagnostic = await readFile(path.join(root, 'results', 'postgres-startup.log'), 'utf8');
  assert.match(diagnostic, /could not start server/);
  assert.doesNotMatch(diagnostic, /a{64}|b{64}|postgresql:\/\//);
});

test('owned startup timeout fails and preserves its diagnostic instead of waiting indefinitely', async t => {
  const root = await startupRoot(t);
  await assert.rejects(startPostgres(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], root, [], 100),
    /owned pg_ctl start failed:/);
  assert.match(await readFile(path.join(root, 'results', 'postgres-startup.log'), 'utf8'), /postgres:/);
});

test('startup tail omits a credential fragment cut at its initial boundary', async t => {
  const root = await startupRoot(t), password = '0123456789abcdef'.repeat(4);
  const child = 'const fs=require("node:fs"),password=process.argv[2],suffix="\\nFATAL: synthetic startup failure\\n";'
    + 'fs.writeFileSync(process.argv[1],"head"+password+suffix+"z".repeat(16384-32-suffix.length));process.exit(1)';
  await assert.rejects(startPostgres(process.execPath, ['-e', child, path.join(root, 'postgres.log'), password],
    root, [password]), error => {
    assert.match(error.message, /FATAL: synthetic startup failure/);
    assert.doesNotMatch(error.message, new RegExp(password.slice(32)));
    return true;
  });
  const diagnostic = await readFile(path.join(root, 'results', 'postgres-startup.log'), 'utf8');
  assert.doesNotMatch(diagnostic, new RegExp(password.slice(32)));
});
