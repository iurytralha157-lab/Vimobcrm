import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const sourcePath = process.env.VIMOB_MEDIA_CLEANUP_BASELINE === '1'
  ? 'D:/Vimob/tmp/whatsapp-final-adjustments-20261012/media/audio-cleanup-scope-before/AudioRecorderButton.tsx'
  : process.env.VIMOB_FINAL_AUDIO_BASELINE === '1'
  ? 'D:/Vimob/tmp/whatsapp-final-adjustments-20261012/media/baseline/components/features/whatsapp/AudioRecorderButton.tsx'
  : new URL('./AudioRecorderButton.tsx', import.meta.url);
const source = ts.createSourceFile('AudioRecorderButton.tsx', readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'previewAudio') handler = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(handler, 'Execute the actual preview handler, not a copy of its implementation');

test('actual captured layout cleanup changes when scope changes with the same preview URL', () => {
  let cleanupEffect;
  function find(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useLayoutEffect'
      && node.arguments[0]?.getText(source).includes('const audio = previewRef.current;')) cleanupEffect = node;
    ts.forEachChild(node, find);
  }
  find(source);
  assert.ok(cleanupEffect, 'Use the actual captured-node layout effect');
  const dependencySource = cleanupEffect.arguments[1].getText(source);
  const previous = vm.runInNewContext(dependencySource, { contextKey: 'A', previewUrl: { url: 'blob:stable-preview' } });
  const next = vm.runInNewContext(dependencySource, { contextKey: 'B', previewUrl: { url: 'blob:stable-preview' } });
  const unchanged = previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]));
  assert.equal(unchanged, false, 'React must run cleanup on scope change even if the object URL is unchanged');
  let pauses = 0;
  const previewRef = { current: { pause: () => { pauses++; } } };
  const setup = vm.runInNewContext(`(${cleanupEffect.arguments[0].getText(source)})`, { previewRef });
  const cleanup = setup();
  previewRef.current = null;
  cleanup();
  assert.equal(pauses, 1, 'Cleanup pauses the captured element after its ref has been detached');
});

function preview() {
  let resolve, reject, pauses = 0;
  const pending = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  const audio = { paused: true, play: () => pending, pause: () => { pauses++; } };
  const state = { previewRef: { current: audio }, generationRef: { current: 1 }, currentContextRef: { current: 'A' }, toasts: [] };
  const run = vm.runInNewContext(`(${handler})`, { ...state, toast: item => state.toasts.push(item) });
  return { state, run, resolve, reject, pauses: () => pauses,
    change: () => { state.generationRef.current++; state.currentContextRef.current = 'B'; state.previewRef.current = null; } };
}

test('actual deferred preview failure cannot toast after a different conversation', async () => {
  const h = preview(); const operation = h.run(); h.change(); h.reject(new Error('old decoder')); await operation;
  assert.equal(h.state.toasts.length, 0); assert.ok(h.pauses() > 0);
});
test('actual deferred preview success pauses the audio from the previous conversation', async () => {
  const h = preview(); const operation = h.run(); h.change(); h.resolve(); await operation;
  assert.ok(h.pauses() > 0); assert.equal(h.state.toasts.length, 0);
});
test('actual deferred preview failure cannot toast after its element unmounts', async () => {
  const h = preview(); const operation = h.run(); h.state.previewRef.current = null; h.state.generationRef.current++; h.reject(new Error('removed player')); await operation;
  assert.equal(h.state.toasts.length, 0); assert.ok(h.pauses() > 0);
});
test('actual current preview failure keeps its normal user feedback', async () => {
  const h = preview(); const operation = h.run(); h.reject(new Error('current decoder')); await operation;
  assert.equal(h.state.toasts.length, 1); assert.equal(h.state.toasts[0].title, 'Prévia indisponível');
});
