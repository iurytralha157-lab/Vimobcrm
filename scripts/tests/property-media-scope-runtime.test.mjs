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

// Non-media commands use this import; this fixture exercises the unchanged
// asset execution contract. Its actor pin has separate transport runtime tests.
const mutationIntent = { capturePropertyMutationIntent: intent => intent };

function evaluateModule(file, dependencies) {
  const source = readFileSync(path.join(root, file), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const testModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: testModule, exports: testModule.exports,
    require: name => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename: file });
  return testModule.exports;
}

// Run the actual domain API and execution guard. Transport/auth and validators
// are inert here: validation contracts have separate tests, and no request is sent.
for (const operation of ['createAsset', 'createAssetUploadIntent', 'discardAssetUpload', 'deleteAsset', 'updateAsset', 'reorderAssets', 'setPrimaryAsset']) {
  test(`${operation} rechecks form scope after authentication await and before sending`, async () => {
    let current = true;
    let requestsSent = 0;
    let capturedUser;
    const guard = evaluateModule('lib/property-media-execution.ts', {});
    const domain = evaluateModule('lib/api/property-workspace.ts', {
      '@/lib/api/property-mutation-intent': mutationIntent,
      '@/lib/validation': {
        parseDomainInput: (_schema, input) => input,
        validateDomainResponse: (_schema, response) => response,
      },
      '@/lib/supabase/client': { supabase: {} },
      '@/lib/property-media-execution': guard,
      './vimob-client': {
        getVimobAPIAccessTokenUserId: () => 'actor-a',
        vimobAPIRequest: async (_url, options) => {
          capturedUser = options.expectedUserId;
          await Promise.resolve();
          options.onRequestStart?.();
          requestsSent += 1;
          return { data: {} };
        },
      },
    });
    const args = ['deleteAsset', 'updateAsset', 'setPrimaryAsset'].includes(operation) ? ['original-org', 'property-a', 'asset-a', {}] : ['original-org', 'property-a', {}];
    const pending = domain.propertyWorkspaceAPI[operation](...args, {
      expectedUserId: 'actor-a', canContinue: () => current,
    });
    // Same actor, changed organization/form while token resolution was pending.
    current = false;
    await assert.rejects(pending, error => error.name === 'PropertyMediaScopeChangedError');
    assert.equal(capturedUser, 'actor-a');
    assert.equal(requestsSent, 0);
  });
}

for (const operation of ['updateAsset', 'reorderAssets', 'setPrimaryAsset']) {
  test(`${operation} rejects a late response after actor changes`, async () => {
    let actor = 'actor-a';
    const guard = evaluateModule('lib/property-media-execution.ts', {});
    const domain = evaluateModule('lib/api/property-workspace.ts', {
      '@/lib/api/property-mutation-intent': mutationIntent,
      '@/lib/validation': { parseDomainInput: (_schema, input) => input, validateDomainResponse: (_schema, response) => response },
      '@/lib/supabase/client': { supabase: {} },
      '@/lib/property-media-execution': guard,
      './vimob-client': {
        getVimobAPIAccessTokenUserId: () => actor,
        vimobAPIRequest: async (_url, options) => {
          options.onRequestStart?.();
          actor = 'actor-b';
          return { data: {} };
        },
      },
    });
    const args = operation === 'reorderAssets' ? ['original-org', 'property-a', {}] : ['original-org', 'property-a', 'asset-a', {}];
    await assert.rejects(domain.propertyWorkspaceAPI[operation](...args, {
      expectedUserId: 'actor-a', canContinue: () => true,
    }), error => error.name === 'PropertyMediaScopeChangedError');
  });
}
