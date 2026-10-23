import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Production buildLeadHistory -> LeadUnifiedThread/form bubble, real React and
// application CSS. Reuse the closed offline history-controls bootstrap, keeping
// its auth/query/WhatsApp transport boundaries synthetic. No CRM or DB is used.
const require = createRequire(import.meta.url);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const baseline = process.env.LEAD_FORM_ANSWERS_BASELINE_DIR;
const artifacts = process.env.LEAD_FORM_ANSWERS_ARTIFACT_DIR;
const phase = process.env.LEAD_FORM_ANSWERS_PHASE || 'green';
const directory = await mkdtemp(join(tmpdir(), 'vimob-lead-form-answers-'));
const measurements = [];
let css, dialogClass;

const base = await readFile(join(repository, 'components/features/leads/history-thread-controls.runtime.test.mjs'), 'utf8');
let bootstrap = base.slice(0, base.indexOf('// History surface assertions'));
function replace(from, to) {
  assert.ok(bootstrap.includes(from), `Shared offline fixture still contains ${from.slice(0, 90)}`);
  bootstrap = bootstrap.replace(from, to);
}
replace("import { buildLeadHistory } from '../../../hooks/lead-history/build-history.ts';", '');
replace("import { chromium } from '@playwright/test';", `import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)};const{chromium}=playwright;`);
replace('const require = createRequire(import.meta.url);', `const require=createRequire(${JSON.stringify(join(repository, 'package.json'))});`);
replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');", `const repository=${JSON.stringify(repository)};`);
// RED uses the three captured projection files, even though only metadata/forms
// change. All other dependencies stay real/current and their hashes are recorded.
replace('module.exports=s=>ts.transpileModule(s,', `module.exports=function(s){${baseline ? `const path=require('node:path'),fs=require('node:fs');const relative=path.relative(${JSON.stringify(repository.replaceAll('\\', '/'))},this.resourcePath).split(path.sep).join('/');if(['hooks/lead-history/metadata.ts','hooks/lead-history/forms.ts','hooks/lead-history/build-history.ts'].includes(relative))s=fs.readFileSync(path.join(${JSON.stringify(resolve(baseline).replaceAll('\\', '/'))},relative),'utf8');` : ''}return ts.transpileModule(s,`);
replace('jsx:ts.JsxEmit.ReactJSX}}).outputText;', 'jsx:ts.JsxEmit.ReactJSX}}).outputText;};');
replace("import{LeadUnifiedThread}from'@/components/features/leads/LeadUnifiedThread';", `import{LeadUnifiedThread}from'@/components/features/leads/LeadUnifiedThread';import{buildLeadHistory}from'@/hooks/lead-history/build-history';`);
replace('    h.render();`);', `
    const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value};
    h.project=raw=>{const before=JSON.stringify(raw);freeze(raw);const events=buildLeadHistory(raw,'lead-a',{formatCurrency:String,formatPropertyCurrency:String,formatResponseTime:String});h.rawUnchanged=before===JSON.stringify(raw);h.raw=raw;h.history.data=events;h.render();return events;};
    h.render();\`);`);
replace('  const errors = [];', '  const errors = [], requests = [];');
replace("await page.route('**/*', route => route.abort());", "await page.route('**/*', route => {requests.push(route.request().url());return route.abort();});");
replace('try { assert.deepEqual(errors, []); }', 'try { assert.deepEqual(errors, []);assert.deepEqual(requests, [], "No external request was attempted"); }');
bootstrap += '\nexport {fixture};\n';
const bootstrapPath = join(directory, 'bootstrap.mjs');
await writeFile(bootstrapPath, bootstrap);
const { fixture: sharedFixture } = await import(pathToFileURL(bootstrapPath).href);

before(async () => {
  const globals = await readFile(join(repository, 'app/globals.css'), 'utf8');
  const sources = ['components/features/leads/LeadUnifiedThread.tsx', 'components/features/leads/lead-detail/history-event-presentation.ts', 'components/features/whatsapp', 'components/ui']
    .map(path => `@source "${join(repository, path).replaceAll('\\', '/')}";`).join('\n');
  const compiled = await require('postcss')([require('@tailwindcss/postcss')({ base: repository })]).process(
    `${globals.replace('@import "tailwindcss";', '@import "tailwindcss" source(none);')}\n${sources}`,
    { from: join(repository, 'app/lead-form-answers-fixture.css') });
  const modulePath = join(repository, 'components/features/leads/lead-detail/PipelineLeadDetail.module.css');
  const moduleCSS = require('lightningcss').transform({ filename: modulePath, code: await readFile(modulePath), cssModules: true });
  dialogClass = moduleCSS.exports.dialog.name;
  css = `${compiled.css}\n${moduleCSS.code.toString()}`;
  if (artifacts) await mkdir(artifacts, { recursive: true });
});

after(async () => {
  if (artifacts) {
    const paths = ['hooks/lead-history/metadata.ts', 'hooks/lead-history/forms.ts', 'hooks/lead-history/build-history.ts',
      'components/features/leads/LeadUnifiedThread.tsx', 'components/features/leads/lead-detail/history-event-presentation.ts',
      'components/features/leads/history-thread-controls.runtime.test.mjs', 'components/features/leads/lead-form-answers.runtime.test.mjs',
      'app/globals.css', 'components/features/leads/lead-detail/PipelineLeadDetail.module.css'];
    const inputs = await Promise.all(paths.map(async path => {
      const usedPath = baseline && ['hooks/lead-history/metadata.ts', 'hooks/lead-history/forms.ts', 'hooks/lead-history/build-history.ts'].includes(path)
        ? join(baseline, path) : join(repository, path);
      return { path, usedPath, sha256: createHash('sha256').update(await readFile(usedPath)).digest('hex') };
    }));
    await writeFile(join(artifacts, `form-answers-dom-${phase}.json`), JSON.stringify({ phase, baseline, inputs, measurements,
      boundary: 'Real builder and form bubbles in offline Chromium; synthetic reads/auth/no message transport. Not CRM/API/DB or physical mobile.' }, null, 2));
  }
  assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('vimob-lead-form-answers-'));
  await rm(directory, { recursive: true, force: true });
});

const at = '2026-10-19T12:00:00Z';
const fields = {
  financiamento: false, aceita_visita: true, dependentes: 0,
  respostas_mistas: { value: [false, true, 0] }, preferencia_estrita: { value: false, answer: true },
  literal_negativa: 'false', literal_afirmativa: 'true',
  sem_resposta: null, campo_vazio: ' ', objeto_sem_valor: { value: { unrelated: 'Never shown' } },
  token: 'never-show-token', email: 'never-show@example.invalid', campaign_id: 'never-show-id',
};
const raw = {
  historyCoverage: { complete: true },
  activityEvents: [
    { id: 'webhook-a', type: 'lead_created', created_at: at, metadata: { source: 'webhook', payload: { custom_fields: fields } } },
    { id: 'webhook-b', type: 'lead_reentry', created_at: '2026-10-19T12:01:00Z', metadata: { source_type: 'generic_webhook', raw_payload: {
      fields: [{ label: 'booleano_em_envelope', value: false }, { label: 'booleano_em_envelope', value: false }],
    } } },
    { id: 'meta-a', type: 'lead_created', created_at: '2026-10-19T12:02:00Z', metadata: { source: 'meta',
      custom_fields: { meta_financiamento: false }, field_data: { meta_visita: { values: [true, false, 0] } } } },
  ],
};
const expected = [
  ['Financiamento', 'false'], ['Aceita Visita', 'true'], ['Dependentes', '0'],
  ['Respostas Mistas', 'false, true, 0'], ['Preferencia Estrita', 'false'],
  ['Literal Negativa', 'false'], ['Literal Afirmativa', 'true'], ['Booleano Em Envelope', 'false'],
  ['meta financiamento', 'false'], ['meta visita', 'true, false, 0'],
];

async function project(page, input) {
  const rows = await page.evaluate(raw => window.harness.project(raw), input);
  assert.equal(await page.evaluate(() => window.harness.rawUnchanged), true, 'Builder leaves frozen raw values intact');
  await page.evaluate(() => new Promise(done => requestAnimationFrame(done)));
  return rows;
}

for (const width of [1366, 390]) test(`form answers retain explicit false/true/0 in actual history bubbles at ${width}px`, async t => {
  const page = await sharedFixture(t); page.setDefaultTimeout(3000);
  await page.setViewportSize({ width, height: 844 }); await page.addStyleTag({ content: css });
  await page.evaluate(({ width, dialogClass }) => {
    const root = document.getElementById('root'); root.className = `${dialogClass} vimob-dialog-content`;
    Object.assign(root.style, { width: width < 768 ? 'calc(100vw - 16px)' : '390px', height: '780px',
      maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100dvh - 24px)', margin: '12px auto', overflow: 'hidden' });
  }, { width, dialogClass });
  const rows = await project(page, raw), answers = rows.filter(row => ['webhook_form_answer', 'meta_form_answer'].includes(row.type));
  if (artifacts) await page.screenshot({ path: join(artifacts, `form-answers-${phase}-${width}.png`), fullPage: true });
  measurements.push({ width, phase: 'combined', rows: answers.map(row => ({ question: row.metadata.question, answer: row.content })) });
  for (const [question, answer] of expected) {
    const label = page.getByText(question, { exact: true });
    assert.equal(await label.count(), 1, `Exactly one bubble for ${question}`);
    const bubble = label.locator('..'); assert.equal(await bubble.locator(':scope > div').nth(2).innerText(), answer);
  }
  assert.equal(answers.length, expected.length);
  for (const question of ['Sem Resposta', 'Campo Vazio', 'Campo Ausente', 'Objeto Sem Valor']) assert.equal(await page.getByText(question, { exact: true }).count(), 0);
  for (const hidden of ['never-show-token', 'never-show@example.invalid', 'never-show-id', 'Never shown', '[object Object]'])
    assert.equal(await page.getByText(hidden, { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  const fallback = { lead: { id: 'lead-a', source: 'webhook', created_at: at }, leadMeta: { platform: 'webhook', raw_payload: { custom_fields: { financiamento_legado: false } } } };
  const legacyRows = await project(page, fallback);
  const legacy = page.getByText('Financiamento Legado', { exact: true });
  assert.equal(await legacy.count(), 1); assert.equal(await legacy.locator('..').locator(':scope > div').nth(2).innerText(), 'false');
  measurements.push({ width, phase: 'legacy-fallback', answers: legacyRows.filter(row => row.type === 'webhook_form_answer').map(row => row.content) });
  await project(page, { ...fallback, historyCoverage: { complete: false } });
  assert.equal(await page.getByText('Financiamento Legado', { exact: true }).count(), 0, 'Partial history must not infer an absent legacy answer');
});
