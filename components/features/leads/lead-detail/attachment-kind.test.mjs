import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { evaluateProduction, productionDeclaration } from '../../../../hooks/leads/lead-request-runtime-fixture.mjs';

const getKind = evaluateProduction(productionDeclaration('components/features/leads/LeadAttachmentViewer.tsx',
  node => ts.isFunctionDeclaration(node) && node.name?.text === 'getAttachmentKind'), {}, 'getAttachmentKind');

test('canonical audio WebM uses the audio player, including MIME parameters', () => {
  for (const file_type of ['audio/webm', 'audio/webm; codecs=opus', 'AUDIO/WEBM', 'audio']) {
    assert.equal(getKind({ file_type, file_name: 'recording.webm' }), 'audio');
  }
});

test('canonical media type takes precedence over a misleading extension', () => {
  assert.equal(getKind({ file_type: 'video/webm', file_name: 'clip.ogg' }), 'video');
  assert.equal(getKind({ file_type: 'image/png', file_name: 'photo.mp4' }), 'image');
  assert.equal(getKind({ file_type: 'audio/ogg', file_name: 'voice.pdf' }), 'audio');
});

test('legacy attachments without a MIME retain extension fallbacks', () => {
  for (const [file_name, kind] of [['clip.webm', 'video'], ['voice.ogg', 'audio'], ['image.PNG', 'image'], ['file.PDF', 'pdf'], ['archive.zip', 'file']]) {
    assert.equal(getKind({ file_name, file_type: null }), kind);
  }
  assert.equal(getKind(null), 'file');
});

test('a revoked or replaced grant hides an existing blob preview in the same render', () => {
  const declaration='const '+productionDeclaration('components/features/leads/LeadAttachmentViewer.tsx',
    node=>ts.isVariableDeclaration(node)&&node.name.getText()==='previewObjectUrl');
  const previewObject={attachmentId:'attachment-a',fileURL:'https://example.invalid/grant-a',url:'blob:synthetic-private-preview'};
  const visible=fileURL=>evaluateProduction(declaration,{fileURL,previewObject,attachment:{id:'attachment-a'}},'previewObjectUrl');
  assert.equal(visible(previewObject.fileURL),previewObject.url);
  assert.equal(visible(''),null);
  assert.equal(visible('https://example.invalid/grant-b'),null);
});
