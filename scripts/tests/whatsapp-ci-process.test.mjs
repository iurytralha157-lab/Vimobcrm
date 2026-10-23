import assert from 'node:assert/strict';
import test from 'node:test';
import { command } from './whatsapp-ci-fixture.mjs';

test('noninteractive child receives EOF and retains output/exit proof', async () => {
  const result = await command(process.execPath, ['-e',
    'process.stdin.resume(); process.stdin.on("end",()=>process.stdout.write("eof-proof"));'], { timeout: 5000 });
  assert.equal(result.stdout, 'eof-proof'); assert.equal(result.stderr, '');
});
test('a stuck owned command is bounded and cannot masquerade as success', async () => {
  await assert.rejects(command(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeout: 100 }),
    error => error.killed === true);
});
