import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url), ts = require('typescript');

/** Installed React/React DOM in a local, closed CommonJS browser runtime. */
export function buildReactBrowserHarness({ repository = process.cwd(), modules = {}, entry }) {
  const sources = {
    react: readFileSync(join(repository, 'node_modules/react/cjs/react.development.js'), 'utf8'),
    scheduler: readFileSync(join(repository, 'node_modules/scheduler/cjs/scheduler.development.js'), 'utf8'),
    'react-dom': readFileSync(join(repository, 'node_modules/react-dom/cjs/react-dom.development.js'), 'utf8'),
    'react-dom/client': readFileSync(join(repository, 'node_modules/react-dom/cjs/react-dom-client.development.js'), 'utf8'),
    ...modules,
  };
  return `window.process={env:{NODE_ENV:'development'}};
    const factories={${Object.entries(sources).map(([name, code]) => `${JSON.stringify(name)}:function(module,exports,require){${code}\n}`).join(',')}};
    const cache={}; function require(name){if(!cache[name]){if(!factories[name])throw Error('Missing local fixture module: '+name);const module=cache[name]={exports:{}};factories[name](module,module.exports,require);}return cache[name].exports;}
    const React=require('react'),{createRoot}=require('react-dom/client'),{flushSync}=require('react-dom');
    ${entry}`;
}

export function transpileBrowserTestModule(path) {
  return ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
