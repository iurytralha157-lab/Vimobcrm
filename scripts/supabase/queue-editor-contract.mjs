import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const cache = new Map();

// Compile the actual browser schemas with their actual dependencies. No
// network response, field, validation or permission function is substituted.
function loadSchema(filename) {
  filename = path.resolve(filename);
  const relative = path.relative(path.join(root, 'lib/validation'), filename);
  assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative));
  if (cache.has(filename)) return cache.get(filename).exports;
  const schemaModule = { exports: {} };
  cache.set(filename, schemaModule);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependency = specifier => {
    if (specifier === 'zod') return require('zod');
    assert.ok(specifier.startsWith('.') || specifier.startsWith('@/lib/validation/'));
    const resolved = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(filename), specifier);
    return loadSchema(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`);
  };
  new Function('exports', 'require', 'module', source)(schemaModule.exports, dependency, schemaModule);
  return schemaModule.exports;
}

const queue = loadSchema(path.join(root, 'lib/validation/crm-support.ts'));
const schedule = loadSchema(path.join(root, 'lib/validation/queue-runtime.ts'));

export function assertQueueEditorResponse(response) {
  queue.apiRoundRobinResponseSchema.parse(response);
  if (response.data.settings?.operating_schedule !== undefined) {
    schedule.queueOperatingScheduleSchema.parse(response.data.settings.operating_schedule);
  }
  return response.data;
}

export function assertQueueEditorListResponse(response) {
  queue.apiRoundRobinListResponseSchema.parse(response);
  for (const entry of response.data) assertQueueEditorResponse({ data: entry });
  return response.data;
}
