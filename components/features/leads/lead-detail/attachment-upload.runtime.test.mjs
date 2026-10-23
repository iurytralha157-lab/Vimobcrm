import assert from 'node:assert/strict';
import test from 'node:test';
import { VimobAPIError } from '../../../../lib/api/vimob-error.ts';
import { turn } from '../../../../hooks/leads/lead-request-runtime-fixture.mjs';
import { attachmentUploadRuntime, ClientActionRateLimitError } from './attachment-upload-runtime-fixture.mjs';

for (const error of [new VimobAPIError('Synthetic denied upload', { status: 403 }), new TypeError('Synthetic response loss')]) test('popup upload failure presents exactly one scoped notification: ' + error.name, async () => {
  const f = attachmentUploadRuntime();
  try {
    f.render(); f.fail(error); await f.upload();
    assert.equal(f.requests.length, 1); assert.equal(f.notices.length, 1); assert.equal(f.notices[0].kind, 'error');
    assert.equal(f.state().uploading, false); assert.equal(f.input.value, '');
  } finally { f.close(); }
});

test('popup client rate limit is shown once with its friendly message and no upload request', async () => {
  const f = attachmentUploadRuntime();
  try {
    f.render(); f.rateLimit(new ClientActionRateLimitError('Aguarde antes de enviar outro documento.')); await f.upload();
    assert.equal(f.requests.length, 0); assert.deepEqual(f.notices, [{ kind: 'error', message: 'Aguarde antes de enviar outro documento.' }]);
    assert.equal(f.limits.length, 1); assert.equal(f.input.value, ''); assert.equal(f.state().uploading, false);
  } finally { f.close(); }
});

for (const replacement of [{ org: 'org-b' }, { actor: 'actor-b' }, { sid: 'sid-b' }, { allowed: false }]) test('pending upload failure is silent after replacement access ' + JSON.stringify(replacement), async () => {
  const f = attachmentUploadRuntime();
  try {
    f.render(); const reply = f.deferReply(); f.fail(new VimobAPIError('Late denied upload', { status: 403 }));
    const pending = f.upload(); await turn(); assert.equal(f.requests.length, 1); f.render(replacement);
    reply.resolve(); await pending; assert.deepEqual(f.notices, []);
    // The attachment controller belongs to auth identity; loss of UI permission
    // instead retires the detail operation and still suppresses its notification.
    assert.equal(f.requests[0][3].signal.aborted, !('allowed' in replacement));
  } finally { f.close(); }
});

test('close before upload failure prevents notifications from the previous visit', async () => {
  const f = attachmentUploadRuntime();
  try {
    f.render(); const reply = f.deferReply(); f.fail(new TypeError('Late response loss'));
    const pending = f.upload(); await turn(); f.unmount(); reply.resolve(); await pending; assert.deepEqual(f.notices, []);
  } finally { f.close(); }
});

test('SID A to B to A never revives an old upload error notification', async () => {
  const f = attachmentUploadRuntime();
  try {
    f.render(); const reply = f.deferReply(); f.fail(new TypeError('Late response loss')); const pending = f.upload(); await turn();
    f.render({ sid: 'sid-b' }); f.render({ sid: 'sid-a' }); reply.resolve(); await pending; assert.deepEqual(f.notices, []);
  } finally { f.close(); }
});

for (const error of [new VimobAPIError('Synthetic rejected file', { status: 422 }), new ClientActionRateLimitError('Espere um instante.')]) test('the default hook consumer keeps exactly one existing error notification: ' + error.name, async () => {
  const f = attachmentUploadRuntime({ popup: false });
  try {
    const mutation = f.render();
    if (error instanceof ClientActionRateLimitError) f.rateLimit(error); else f.fail(error);
    await assert.rejects(mutation.mutateAsync({ leadId: 'lead-a', file: f.file }));
    assert.equal(f.notices.length, 1); assert.equal(f.notices[0].kind, 'error');
    if (error instanceof ClientActionRateLimitError) assert.equal(f.notices[0].message, error.userMessage);
  } finally { f.close(); }
});

test('successful popup upload preserves receipt cache, history invalidation, one success and input reset', async () => {
  const f = attachmentUploadRuntime();
  try {
    f.render(); await f.upload(); assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0][0], 'lead-a'); assert.equal(f.requests[0][1], f.file); assert.equal(f.requests[0][2], 'org-a');
    assert.equal(f.requests[0][3].expectedUserId, 'actor-a'); assert.equal(f.requests[0][3].expectedSessionId, 'sid-a');
    const cached = f.client.getQueryData(['lead-attachments', 'org-a', 'lead-a']);
    assert.equal(cached.length, 1); assert.equal(cached[0].id, 'attachment-a'); assert.equal(cached[0].availability, 'signing_unavailable');
    assert(f.invalidations.some(value => value.queryKey[0] === 'lead-history-v2' && value.queryKey[1] === 'lead-a'));
    assert.deepEqual(f.notices, [{ kind: 'success', message: 'Documento enviado com sucesso!' }]);
    assert.equal(f.input.value, ''); assert.equal(f.state().uploading, false);
    assert.equal(f.draft(), null);
  } finally { f.close(); }
});

test('lost upload response keeps the original File and command through popup close/reopen and retries once', async () => {
  const f = attachmentUploadRuntime();
  try {
    f.render(); f.fail(new TypeError('Lost ACK')); await f.upload();
    assert.equal(f.draft().phase, 'unconfirmed'); assert.equal(f.draft().file, f.file);
    const key = f.receipt().uploadRequestKey;
    assert(f.invalidations.some(value => value.queryKey[0] === 'lead-attachments' && value.refetchType === 'active'));
    f.unmount(); f.reopen(); assert.equal(f.draft().file, f.file); f.fail(null); await f.upload();
    assert.equal(f.requests.length, 2); assert.equal(f.requests[1][1], f.requests[0][1]);
    assert.equal(f.receipt().uploadRequestKey, key); assert.equal(f.draft(), null);
    assert.equal(f.client.getQueryData(['lead-attachments', 'org-a', 'lead-a']).length, 1);
  } finally { f.close(); }
});

test('a pending draft blocks same-event double submission before the next React render', async () => {
  const f = attachmentUploadRuntime();
  try {
    f.render(); const reply = f.deferReply(); const first = f.upload(); const second = f.upload(); await turn();
    assert.equal(f.requests.length, 1); assert.equal(f.draft().phase, 'pending');
    reply.resolve(); await Promise.all([first, second]); assert.equal(f.draft(), null);
  } finally { f.close(); }
});

test('an unknown upload completing after close keeps recovery and only invalidates its captured cache without refetch', async () => {
  const f = attachmentUploadRuntime();
  try {
    f.render(); const reply = f.deferReply(); f.fail(new TypeError('Lost ACK')); const pending = f.upload(); await turn();
    f.unmount(); reply.resolve(); await pending;
    assert.equal(f.draft().phase, 'unconfirmed'); assert.deepEqual(f.notices, []);
    assert(f.invalidations.some(value => value.queryKey[0] === 'lead-attachments' && value.refetchType === 'none'));
  } finally { f.close(); }
});

for (const fails of [false, true]) test('an old upload callback cannot recreate queries after logout clears the cache: ' + fails, async () => {
  const f = attachmentUploadRuntime();
  try {
    f.render(); const reply = f.deferReply(); if (fails) f.fail(new TypeError('Lost ACK'));
    const pending = f.upload(); await turn(); f.unmount(); f.client.clear(); reply.resolve(); await pending;
    assert.equal(f.client.getQueryCache().getAll().length, 0); assert.deepEqual(f.notices, []);
  } finally { f.close(); }
});

test('a replacement identity has no access to the previous upload draft', async () => {
  const f = attachmentUploadRuntime();
  try {
    f.render(); f.fail(new TypeError('Lost ACK')); await f.upload();
    const previous = f.draft(); assert.equal(previous.file, f.file);
    f.render({ sid: 'sid-b' }); assert.equal(f.draft(), null);
    f.render({ sid: 'sid-a' }); assert.equal(f.draft(), previous);
  } finally { f.close(); }
});

for(const replacement of [{sid:'sid-b'},{leadId:'lead-b'}])test('a late upload cannot clear the replacement lead/session file input '+JSON.stringify(replacement),async()=>{
 const f=attachmentUploadRuntime();try{
  f.render();const reply=f.deferReply();const pending=f.upload();await turn();f.render(replacement);f.input.value='replacement-file.pdf';
  assert.equal(f.state().uploading,false);reply.resolve();await pending;
  assert.equal(f.input.value,'replacement-file.pdf');assert.equal(f.state().uploading,false);assert.deepEqual(f.notices,[]);
 }finally{f.close();}
});
