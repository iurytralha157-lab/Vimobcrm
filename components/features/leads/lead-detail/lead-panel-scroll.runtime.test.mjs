import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Real production React effects, refs, container attributes, Dialog/Drawer and
// application/module CSS. Only the panels' heavy domain descendants are replaced
// by tall synthetic content. No CRM, transport, AuthContext or environment is used.
const require = createRequire(import.meta.url), ts = require('typescript');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sourcePath = process.env.LEAD_PANEL_SCROLL_SOURCE || join(repository, 'components/features/leads/LeadDetailDialog.tsx');
const artifacts = process.env.LEAD_PANEL_SCROLL_ARTIFACT_DIR;
const phase = process.env.LEAD_PANEL_SCROLL_PHASE || 'green';
let directory, browser, bundle, styles, sourceHash;
const errors = [], evidence = [];

function productionParts(source) {
  const ast = ts.createSourceFile('LeadDetailDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map(), effects = [], elements = [];
  const visit = node => {
    if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(ast), node);
    if (ts.isCallExpression(node) && ['useEffect', 'useLayoutEffect'].includes(node.expression.getText(ast))) {
      const text = node.getText(ast);
      if (text.includes('setEditForm(nextForm)') || text.includes('v2LeadInfoScrollRef.current?.scrollTo')) effects.push(text);
    }
    if (ts.isJsxElement(node)) elements.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const declaration = name => {
    assert.ok(declarations.has(name), `Missing production declaration ${name}`);
    return `const ${declarations.get(name).getText(ast)};`;
  };
  const attribute = (node, name) => node.openingElement.attributes.properties.find(prop => prop.name?.getText(ast) === name);
  const text = node => node?.getText(ast) || '';
  const find = predicate => {
    const matches = elements.filter(predicate); assert.equal(matches.length, 1, 'Production container must be unique'); return matches[0];
  };
  const classIncludes = (node, value) => text(attribute(node, 'className')).includes(value);
  const opening = (node, retained = ['className', 'ref', 'role', 'id', 'aria-labelledby', 'hidden', 'tabIndex']) =>
    node.openingElement.attributes.properties.filter(prop => retained.includes(prop.name?.getText(ast))).map(text).join(' ');
  const info = find(node => text(attribute(node, 'ref')) === 'ref={v2LeadInfoScrollRef}');
  const work = find(node => text(attribute(node, 'ref')) === 'ref={v2LeadWorkScrollRef}');
  const mobilePanel = id => find(node => text(attribute(node, 'id')) === `id={\`${'${mobileTabsId}'}-${id}-panel\`}`);
  const mobileScroll = panel => {
    const matches = elements.filter(node => node.pos > panel.pos && node.end < panel.end &&
      classIncludes(node, 'lead-detail-v2-scroll h-full overflow-y-auto p-3'));
    assert.equal(matches.length, 1); return matches[0];
  };
  const summary = mobilePanel('summary'), actions = mobilePanel('actions');
  const mobileRoot = find(node => classIncludes(node, 'lead-detail-dialog lead-detail-v2 flex h-full min-h-0 flex-col'));
  const desktopRoot = find(node => classIncludes(node, 'lead-detail-dialog lead-detail-v2 flex h-full max-h-full flex-col'));
  const grid = find(node => classIncludes(node, 'lead-detail-v2-grid grid'));
  const dialog = find(node => node.openingElement.tagName.getText(ast) === 'DialogContent');
  const drawer = find(node => node.openingElement.tagName.getText(ast) === 'DrawerContent');
  assert.ok(effects.length >= 1 && effects.length <= 2);
  assert.equal(effects.filter(effect => effect.includes('setEditForm(nextForm)')).length, 1);
  return {
    declarations: ['v2LeadInfoScrollRef', 'v2LeadWorkScrollRef', 'leadId', '[editForm, setEditForm]'].map(declaration).join('\n'),
    session: declarations.has('panelSessionId') ? declaration('panelSessionId') : '',
    effects: effects.join(';\n'),
    desktop: `<Dialog open onOpenChange={h.close}><DialogContent ${opening(dialog, ['className', 'style'])}>
      <DialogTitle className="sr-only">Synthetic lead</DialogTitle><DialogDescription className="sr-only">Synthetic panel navigation</DialogDescription>
      <div ${opening(desktopRoot)}><header className="shrink-0 p-4">Synthetic lead panels</header>
      <div ${opening(grid)}><aside ${opening(info.parent)}><div ${opening(info)} data-testid="info"><PanelContent name="info"/></div></aside>
      <main ${opening(work.parent)}><div ${opening(work)} data-testid="work"><PanelContent name="work"/></div></main>
      <aside className="lead-detail-v2-column"><div>History placeholder</div></aside></div></div>
      </DialogContent></Dialog>`,
    mobile: `<Drawer open onOpenChange={h.close}><DrawerContent ${opening(drawer, ['className'])} showHandle={false}>
      <DrawerTitle className="sr-only">Synthetic lead</DrawerTitle><DrawerDescription className="sr-only">Synthetic panel navigation</DrawerDescription>
      <div ${opening(mobileRoot)}><header className="shrink-0 p-3">Synthetic lead panels</header>
      <div ${opening(summary.parent)}><div ${opening(summary)}>{mobileActiveTab==='summary'&&<div ${opening(mobileScroll(summary))} data-testid="summary"><PanelContent name="summary"/></div>}</div>
      <div ${opening(actions)}>{mobileActiveTab==='actions'&&<div ${opening(mobileScroll(actions))} data-testid="actions"><PanelContent name="actions"/></div>}</div></div></div>
      </DrawerContent></Drawer>`,
  };
}

before(async () => {
  const source = await readFile(sourcePath, 'utf8'), parts = productionParts(source);
  sourceHash = createHash('sha256').update(source).digest('hex');
  directory = await mkdtemp(join(tmpdir(), 'vimob-lead-panel-scroll-'));
  const entry = join(directory, 'fixture.tsx'), loader = join(directory, 'loader.cjs'), cssSheet = join(directory, 'pipeline-sheet.js');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
  const postcss = require('postcss'), tailwind = require('@tailwindcss/postcss');
  // Compile the production CSS module with the same installed compiler used by
  // the other offline presentation harnesses; no selectors/rules are copied.
  const modulePath = join(repository, 'components/features/leads/lead-detail/PipelineLeadDetail.module.css');
  const moduleCSS = require('lightningcss').transform({ filename: modulePath, code: await readFile(modulePath), cssModules: true });
  const locals = Object.fromEntries(Object.entries(moduleCSS.exports).map(([name, value]) => [name, value.name]));
  await writeFile(cssSheet, `export default{locals:${JSON.stringify(locals)},toString:()=>${JSON.stringify(moduleCSS.code.toString())}};`);
  await writeFile(entry, `import React,{useState,useEffect,useLayoutEffect,useRef}from'react';import{createRoot}from'react-dom/client';
    import{Dialog,DialogContent,DialogTitle,DialogDescription}from'@/components/ui/dialog';
    import{Drawer,DrawerContent,DrawerTitle,DrawerDescription}from'@/components/ui/drawer';
    import{getGlobalSignOutSessionId}from'@/lib/auth/global-sign-out';import{cn}from'@/lib/utils';
    import pipelineSheet from'@/components/features/leads/lead-detail/PipelineLeadDetail.module.css';
    const pipelineDetailStyles=pipelineSheet.locals;const moduleStyle=document.createElement('style');moduleStyle.textContent=pipelineSheet.toString();document.head.append(moduleStyle);
    const h=window.h={commits:0,scrollCalls:[],nodes:new Map(),nextNode:1,writes:[]};
    const nativeScrollTo=HTMLElement.prototype.scrollTo;HTMLElement.prototype.scrollTo=function(...args){if(this.dataset.testid)h.scrollCalls.push({panel:this.dataset.testid,top:args[0]?.top});return nativeScrollTo.apply(this,args);};
    const token=(id,revision=1)=>({access_token:'synthetic.'+btoa(JSON.stringify({session_id:id,sub:'actor-A',revision}))+'.synthetic',user:{id:'actor-A'}});
    const freshLead=(patch={})=>({id:'lead-A',organization_id:'org-A',name:'Original',phone:'11999999999',property_id:'property-A',valor_interesse:100,commission_percentage:5,updated_at:'2026-10-19T10:00:00.000001Z',...patch});
    const initialScope={lead:freshLead(),org:'org-A',actor:'actor-A',session:token('sid-A'),catalog:0};
    function SyntheticContent({name,draft}){return <><div>Panel {name}</div><input aria-label={'Property draft '+name} value={draft.property_id} readOnly/>{Array.from({length:70},(_,i)=><div key={i} className="min-h-10 py-2">Synthetic row {i}</div>)}</>;}
    function Capture({scope,variant,mobile,tab}){
      const leadProp=scope.lead,activeOrganization={organizationId:scope.org},user={id:scope.actor},session=scope.session;
      ${parts.declarations}
      ${parts.session}
      ${parts.effects};
      useLayoutEffect(()=>{h.commits++;h.state={draft:editForm,lead:leadProp};});
      h.edit=patch=>setEditForm(current=>({...current,...patch}));
      const mobileActiveTab=tab,mobileTabsId='synthetic-tabs';
      return mobile?(${parts.mobile.replaceAll('<PanelContent name=', '<SyntheticContent draft={editForm} name=')}):(${parts.desktop.replaceAll('<PanelContent name=', '<SyntheticContent draft={editForm} name=')});
    }
    function Fixture(){const[scope,setScope]=useState(initialScope),[shown,setShown]=useState(true),[tab,setTab]=useState('summary');
      h.close=()=>setShown(false);h.reopen=()=>setShown(true);h.tab=setTab;h.change=patch=>setScope(current=>({...current,...patch}));
      h.refresh=patch=>setScope(current=>({...current,lead:{...current.lead,...patch}}));h.sameObject=()=>setScope(current=>({...current,catalog:current.catalog+1}));
      h.session=(id,revision)=>setScope(current=>({...current,session:token(id,revision)}));
      h.current=scope;return shown?<Capture scope={scope} variant={window.fixture.variant} mobile={window.fixture.mobile} tab={tab}/>:null;}
    createRoot(document.getElementById('app')).render(<Fixture/>);`);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolveBuild, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry,
      output: { path: directory, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/components/features/leads/lead-detail/PipelineLeadDetail.module.css$': cssSheet, '@': repository }, modules: [join(repository, 'node_modules'), 'node_modules'] },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors()
      ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolveBuild()));
  });
  bundle = await readFile(join(directory, 'fixture.js'), 'utf8');
  const globals = await readFile(join(repository, 'app/globals.css'), 'utf8');
  const sources = ['components/features/leads/LeadDetailDialog.tsx', 'components/ui', entry]
    .map(relative => `@source "${(relative === entry ? entry : join(repository, relative)).replaceAll('\\', '/')}";`).join('\n');
  styles = (await postcss([tailwind({ base: repository })]).process(
    globals.replace('@import "tailwindcss";', '@import "tailwindcss" source(none);') + '\n' + sources,
    { from: join(repository, 'app/globals.css') })).css;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (artifacts) {
    await mkdir(artifacts, { recursive: true });
    await writeFile(join(artifacts, `lead-panel-scroll-${phase}.json`), JSON.stringify({ sourcePath, sourceHash, evidence, errors,
      boundary: 'Production effects/refs/container attributes/shared primitives/application CSS. Heavy descendants synthetic. Offline Chromium, not CRM or iPhone/production.' }, null, 2));
  }
  if (directory) {
    const target = resolve(directory); assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(target.split(/[\\/]/).at(-1).startsWith('vimob-lead-panel-scroll-')); await rm(target, { recursive: true, force: true });
  }
  assert.deepEqual(errors, []);
});

async function open(variant, mobile) {
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => { errors.push(error.message); });
  const requests = [];
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent('<div id="app"></div>'); await page.addStyleTag({ content: styles });
  await page.evaluate(config => { window.fixture = config; }, { variant, mobile });
  await page.addScriptTag({ content: bundle });
  await page.getByTestId(mobile ? 'summary' : 'info').waitFor();
  await page.waitForFunction(() => window.h.state?.draft.property_id === 'property-A');
  page.requests = requests; return page;
}

async function snapshot(page, label) {
  assert.deepEqual(errors, [], 'Browser errors fail the isolated fixture');
  const state = await page.evaluate(() => {
    const h = window.h;
    return { draft: h.state.draft.property_id, value: h.state.draft.valor_interesse, commission: h.state.draft.commission_percentage,
      calls: h.scrollCalls.length,
      panels: Object.fromEntries([...document.querySelectorAll('[data-testid]')].map(node => {
        if (!h.nodes.has(node)) h.nodes.set(node, h.nextNode++);
        return [node.dataset.testid, { top: node.scrollTop, node: h.nodes.get(node),
          height: node.clientHeight, content: node.scrollHeight, overflow: getComputedStyle(node).overflowY }];
      })), horizontalOverflow: document.documentElement.scrollWidth > innerWidth, writes: h.writes };
  });
  assert.equal(state.horizontalOverflow, false); assert.deepEqual(state.writes, []);
  assert.deepEqual(page.requests, [], 'No network is expected, including blocked requests');
  evidence.push({ label, ...state }); return state;
}

async function scroll(page) {
  await page.evaluate(() => document.querySelectorAll('[data-testid]').forEach((node, index) => { node.scrollTop = 350 + index * 70; }));
  const measured = await snapshot(page, 'scrolled');
  for (const panel of Object.values(measured.panels)) { assert.ok(panel.top >= 350); assert.ok(panel.content > panel.height); assert.equal(panel.overflow, 'auto'); }
  return measured;
}

async function act(page, operation, arg) {
  const previous = await page.evaluate(() => window.h.commits);
  await page.evaluate(({ operation, arg }) => {
    if (operation === 'session') window.h.session(...arg); else window.h[operation](arg);
  }, { operation, arg });
  await page.waitForFunction(beforeCommit => window.h.commits > beforeCommit, previous);
  await page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
}

function preserved(beforeState, afterState) {
  assert.deepEqual(afterState.panels, beforeState.panels, 'Same context keeps real scroll offsets and DOM nodes');
  assert.equal(afterState.calls, beforeState.calls, 'Same context must not issue another reset');
}

for (const variant of ['pipeline', 'contacts']) test(`${variant} desktop: realtime, mutation, catalogs, property draft and token refresh keep both panels without freezing property data`, async () => {
  const page = await open(variant, false);
  try {
    const beforeState = await scroll(page);
    await act(page, 'sameObject'); preserved(beforeState, await snapshot(page, `${variant}: same object/catalog`));
    await act(page, 'refresh', { name: 'Updated', property_id: 'property-B', valor_interesse: 250, updated_at: '2026-10-19T10:01:00.000002Z' });
    let current = await snapshot(page, `${variant}: realtime revision`); preserved(beforeState, current);
    assert.equal(current.draft, 'property-B'); assert.equal(current.value, '250'); assert.equal(current.commission, '5');
    await act(page, 'refresh', { deal_status: 'lost', assigned_user_id: 'other', stage_id: 'stage-B', tags: ['synthetic'] });
    preserved(beforeState, await snapshot(page, `${variant}: mutation snapshot`));
    await act(page, 'edit', { property_id: 'optimistic-property', valor_interesse: '325', commission_percentage: '8' });
    current = await snapshot(page, `${variant}: property draft`); preserved(beforeState, current);
    assert.equal(current.draft, 'optimistic-property'); assert.equal(current.value, '325'); assert.equal(current.commission, '8');
    await act(page, 'refresh', { property_id: 'canonical-property', valor_interesse: 400, commission_percentage: 9 });
    current = await snapshot(page, `${variant}: canonical property`); preserved(beforeState, current);
    assert.equal(current.draft, 'canonical-property'); assert.equal(current.value, '400'); assert.equal(current.commission, '9');
    await act(page, 'session', ['sid-A', 2]); preserved(beforeState, await snapshot(page, `${variant}: same SID refreshed token`));
    if (artifacts) { await mkdir(artifacts, { recursive: true }); await page.screenshot({ path: join(artifacts, `scroll-${phase}-${variant}-desktop.png`) }); }
  } finally { await page.close(); }
});

test('desktop context changes reset actual panels, and property draft changes without leaking to the next lead', async () => {
  const page = await open('pipeline', false);
  try {
    const changes = [ ['refresh', { id: 'lead-B', name: 'Next lead', updated_at: '2026-10-19T11:00:00Z' }],
      ['refresh', { id: 'lead-A', name: 'Original lead revisited' }],
      ['refresh', { organization_id: 'org-lead-B' }], ['change', { org: 'org-B' }],
      ['change', { actor: 'actor-B' }], ['session', ['sid-B', 3]] ];
    for (const [operation, arg] of changes) {
      const beforeState = await scroll(page); await act(page, operation, arg);
      const afterState = await snapshot(page, `identity: ${operation} ${JSON.stringify(arg)}`);
      assert.equal(afterState.panels.info.top, 0); assert.equal(afterState.panels.work.top, 0);
      assert.equal(afterState.calls, beforeState.calls + 2);
      assert.equal(afterState.panels.info.node, beforeState.panels.info.node); assert.equal(afterState.panels.work.node, beforeState.panels.work.node);
    }
    await act(page, 'edit', { property_id: 'old-context-property' });
    await scroll(page); await act(page, 'refresh', { id: 'lead-C', property_id: 'next-property' });
    const current = await snapshot(page, 'new lead replaces property draft');
    assert.equal(current.draft, 'next-property');
    assert.equal(current.panels.info.top, 0); assert.equal(current.panels.work.top, 0);
  } finally { await page.close(); }
});

test('desktop close/reopen creates fresh panel nodes at the start', async () => {
  const page = await open('contacts', false);
  try {
    const beforeNull = await scroll(page), lead = await page.evaluate(() => window.h.current.lead);
    await act(page, 'change', { lead: null });
    preserved(beforeNull, await snapshot(page, 'null lead guard: no forced scroll on surviving test containers'));
    await act(page, 'change', { lead });
    const returned = await snapshot(page, 'same ID after null starts a fresh panel context');
    assert.equal(returned.panels.info.top, 0); assert.equal(returned.panels.work.top, 0);
    assert.equal(returned.calls, beforeNull.calls + 2);
    const beforeState = await scroll(page); await page.evaluate(() => window.h.close());
    await page.getByTestId('info').waitFor({ state: 'detached' }); await page.evaluate(() => window.h.reopen());
    await page.getByTestId('info').waitFor(); await page.waitForFunction(() => window.h.state.draft.property_id === 'property-A');
    const current = await snapshot(page, 'contacts desktop reopened');
    assert.equal(current.panels.info.top, 0); assert.equal(current.panels.work.top, 0);
    assert.notEqual(current.panels.info.node, beforeState.panels.info.node);
    assert.notEqual(current.panels.work.node, beforeState.panels.work.node);
  } finally { await page.close(); }
});

for (const variant of ['pipeline', 'contacts']) test(`${variant} mobile control: active summary/actions keep scroll on snapshot/property/token refresh and reopen starts fresh`, async () => {
  const page = await open(variant, true);
  try {
    for (const tab of ['summary', 'actions']) {
      if (tab === 'actions') { await act(page, 'tab', tab); await page.getByTestId(tab).waitFor(); }
      const beforeState = await scroll(page);
      await act(page, 'refresh', { property_id: `mobile-${tab}`, updated_at: '2026-10-19T12:01:00Z' });
      let current = await snapshot(page, `${variant} mobile ${tab} refresh`); preserved(beforeState, current); assert.equal(current.draft, `mobile-${tab}`);
      await act(page, 'edit', { property_id: 'mobile-property-draft' });
      current = await snapshot(page, `${variant} mobile ${tab} property draft`); preserved(beforeState, current); assert.equal(current.draft, 'mobile-property-draft');
      await act(page, 'refresh', { property_id: 'mobile-canonical-property' }); await act(page, 'session', ['sid-A', 4]);
      current = await snapshot(page, `${variant} mobile ${tab} canonical/token`); preserved(beforeState, current); assert.equal(current.draft, 'mobile-canonical-property');
    }
    if (artifacts) { await mkdir(artifacts, { recursive: true }); await page.screenshot({ path: join(artifacts, `scroll-${phase}-${variant}-mobile.png`) }); }
    const oldNode = (await snapshot(page, 'mobile before reopen')).panels.actions.node;
    await page.evaluate(() => window.h.close()); await page.getByTestId('actions').waitFor({ state: 'detached' });
    await page.evaluate(() => window.h.reopen()); await page.getByTestId('actions').waitFor();
    const reopened = await snapshot(page, `${variant} mobile reopen`); assert.equal(reopened.panels.actions.top, 0); assert.notEqual(reopened.panels.actions.node, oldNode);
  } finally { await page.close(); }
});
