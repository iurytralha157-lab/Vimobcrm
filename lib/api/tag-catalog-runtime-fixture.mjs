import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';

export const tagCatalogTestOrganization = '50000000-0000-4000-8000-000000000001';
export const legacyTagResponse = {
  id: '40000000-0000-4000-8000-000000000001', name: 'Visita', color: '#22c55e',
  organization_id: tagCatalogTestOrganization, created_at: '2026-10-01T10:00:00Z', description: null, lead_count: 3,
};

// Executes the actual API adapter and Zod contracts; only the two transports
// return synthetic responses. No browser, credentials, services or network.
export function tagCatalogApiFixture(response = { data: [legacyTagResponse] }) {
  const requests = [], management = [], loaded = new Map();
  let failure;
  const files = { common: 'lib/validation/common.ts', './common': 'lib/validation/common.ts',
    './filter-text': 'lib/validation/filter-text.ts', './queue-runtime': 'lib/validation/queue-runtime.ts', '@/lib/validation/common': 'lib/validation/common.ts',
    '@/lib/validation/manual-activities': 'lib/validation/manual-activities.ts',
    '@/lib/round-robin/queue-name': 'lib/round-robin/queue-name.ts',
    '@/lib/round-robin/input-text': 'lib/round-robin/input-text.ts',
    '@/lib/validation/tag-catalog': 'lib/validation/tag-catalog.ts' };
  function evaluate(path) {
    if (loaded.has(path)) return loaded.get(path);
    const fixtureModule = { exports: {} };
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const dependency = name => {
      if (name === 'zod') return { z };
      if (files[name]) return evaluate(files[name]);
      if (name === '@/lib/validation') return { ...evaluate(files.common), ...evaluate('lib/validation/crm-support.ts') };
      if (name === './vimob-client') return { vimobAPIRequest: async (path, options) => {
        requests.push({ path, options }); if (failure) throw failure; return response;
      } };
      if (name === '@/lib/api/management-request') return { managementAPIRequest: async (path, options) => {
        management.push({ path, options }); if (failure) throw failure; return response;
      } };
      throw Error(`Unexpected dependency: ${name}`);
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Error })(dependency, fixtureModule, fixtureModule.exports);
    loaded.set(path, fixtureModule.exports); return fixtureModule.exports;
  }
  return { api: evaluate('lib/api/tags.ts').tagsAPI, requests, management,
    setResponse(value) { response = value; }, setFailure(error) { failure = error; } };
}
