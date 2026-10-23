import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function evaluate(file, dependencies) {
  const source = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const testModule = { exports: {} };
  vm.runInNewContext(source, {
    module: testModule, exports: testModule.exports,
    require: name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; },
  });
  return testModule.exports;
}
function fixture(editing = true) {
  let cursor = 0;
  const slots = [], commands = [];
  const state = { reject: true };
  const controls = names => Object.fromEntries(names.map(name => [name, name]));
  const dialog = evaluate('components/features/properties/detail/PropertyAssetDialog.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'),
    react: { useState: value => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    } },
    'lucide-react': controls(['FileUp', 'Loader2']),
    '@/components/ui/button': controls(['Button']),
    '@/components/ui/dialog': controls(['Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle']),
    '@/components/ui/input': controls(['Input']), '@/components/ui/label': controls(['Label']),
    '@/components/ui/select': controls(['Select', 'SelectContent', 'SelectItem', 'SelectTrigger', 'SelectValue']),
    '@/components/ui/textarea': controls(['Textarea']),
    '@/lib/api/vimob-error': { stringifyErrorMessage: error => error.message },
    '@/lib/property-media-asset-input': evaluate('lib/property-media-asset-input.ts', {}),
    '@/lib/property-media-draft': evaluate('lib/property-media-draft.ts', {}),
    '@/lib/property-photo-preparation': { preparePropertyPhoto: async file => file, PROPERTY_PHOTO_PICKER_ACCEPT: 'image/jpeg' },
    '../property-form/property-form-fields.module.css': { __esModule: true, default: { surface: 'surface' } },
  });
  const props = {
    open: true, pending: false, onOpenChange: () => {},
    asset: editing ? { id: 'asset-a', asset_type: 'photo', visibility: 'public', storage_path: 'org-a/property-a/photo.jpg', title: 'Original title', updated_at: '2026-10-12T12:00:00Z' } : null,
    onSubmit: async command => { commands.push(command); if (state.reject) throw Error('HTTP500 synthetic'); },
  };
  function elements(tree) {
    if (!tree || typeof tree !== 'object') return [];
    const children = tree.props?.children;
    return [tree, ...(Array.isArray(children) ? children : [children]).flatMap(elements)];
  }
  const render = () => { cursor = 0; return elements(dialog.PropertyAssetDialog(props)); };
  const control = id => render().find(node => node.props?.id === id);
  const submit = () => render().find(node => node.type === 'form').props.onSubmit({ preventDefault() {}, stopPropagation() {} });
  return { commands, state, props, render, control, submit };
}

test('transient editing failure preserves corrections and permits a second save', async () => {
  const f = fixture();
  f.control('asset-title').props.onChange({ target: { value: 'First correction' } });
  await f.submit();
  assert.equal(f.commands.length, 1);
  const submitButton = () => f.render().find(node => node.type === 'Button' && node.props.type === 'submit');
  assert.equal(submitButton().props.disabled, false);
  assert.equal(f.control('asset-title').props.value, 'First correction');
  f.control('asset-title').props.onChange({ target: { value: 'Final correction' } });
  f.state.reject = false;
  await f.submit();
  assert.equal(f.commands.length, 2);
  assert.equal(f.commands[1].input.title, 'Final correction');
  assert.equal(f.commands[1].input.expected_updated_at, '2026-10-12T12:00:00Z');
  assert.equal(f.render().some(node => node.props?.role === 'alert'), false);
});

test('allowing retry does not submit a missing or invalid file', async () => {
  const f = fixture(false);
  f.state.reject = false;
  await f.submit();
  assert.equal(f.commands.length, 0);
  await f.control('asset-file').props.onChange({ target: { files: [{ name: 'wrong.pdf', type: 'application/pdf', size: 100 }] } });
  await f.submit();
  assert.equal(f.commands.length, 0);
  await f.control('asset-file').props.onChange({ target: { files: [{ name: 'valid.jpg', type: 'image/jpeg', size: 100 }] } });
  await f.submit();
  assert.equal(f.commands.length, 1);
  assert.equal(f.commands[0].file.name, 'valid.jpg');
});

test('preparing or pending mutations still block submit and bubbling', async () => {
  const f = fixture(); f.props.pending = true;
  const calls = [];
  await f.render().find(node => node.type === 'form').props.onSubmit({ preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop') });
  assert.deepEqual(calls, ['prevent', 'stop']);
  assert.equal(f.commands.length, 0);
  assert.equal(f.render().find(node => node.type === 'Button' && node.props.type === 'submit').props.disabled, true);
});
