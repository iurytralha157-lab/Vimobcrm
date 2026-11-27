import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Real LeadDetailLayout, LeadDetailTabBar and LeadDetailStageNav with compiled
// application CSS (light and dark). Slots are synthetic; no network is used.
const require = createRequire(import.meta.url);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
let directory, browser, bundle, css, moduleCSS, dialogClass;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-lead-layout-'));
  const loader = join(directory, 'loader.cjs'), entry = join(directory, 'entry.tsx');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
  await writeFile(entry, `import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{Clock,Home,FileText,UserRound,ArrowLeftRight,Crosshair}from'lucide-react';
    import{DesktopLeadLayout,MobileLeadLayout}from'@/components/features/leads/lead-detail/LeadDetailLayout';
    import{LeadDetailStageNav}from'@/components/features/leads/lead-detail/LeadDetailStageNav';
    const q=new URLSearchParams(location.search),mobile=q.get('mobile')==='1',count=Number(q.get('stages')||9);
    const h=window.h={moves:[]};
    const stages=Array.from({length:count},(_,i)=>({id:'s'+i,name:'Etapa sintética com nome longo '+(i+1)}));
    const tall=n=>Array.from({length:n},(_,i)=><p key={i} className='py-2 text-xs'>Linha sintética {i+1} com texto longo para medir a contenção sem estouro horizontal</p>);
    function Fixture(){const[tab,setTab]=useState('atividades'),[key,setKey]=useState('lead-a');h.setKey=setKey;h.setTab=setTab;
      const tabs=[{id:'atividades',label:'Atividades',icon:Clock,alert:12},{id:'imoveis',label:'Imóveis',icon:Home},{id:'arquivos',label:'Arquivos',icon:FileText,count:3},{id:'dados',label:mobile?'Dados':'Dados do lead',icon:UserRound},{id:'transferir',label:'Transferir',icon:ArrowLeftRight},{id:'origem',label:'Origem',icon:Crosshair}];
      const action=label=><button data-touch className={mobile?'h-11 flex-1 rounded-[6px]':'h-8 flex-1 rounded-[6px]'}>{label}</button>;
      const props={readNotice:null,closeButton:<button data-touch aria-label='Fechar detalhes do lead' className={mobile?'h-10 w-10':'h-8 w-8'}>x</button>,scrollKey:key,
        stageNav:<LeadDetailStageNav stages={stages} activeStageId='s1' leadName='Lead' daysInStage={3} mobile={mobile} disabled={false} needsConfirmation={()=>true} onMove={id=>h.moves.push(id)}/>,
        assignee:<button className='h-8 min-w-0 truncate'>Responsável sintético com nome bem comprido</button>,
        identity:{name:'Lead sintético com um nome extenso para truncar',initial:'L',avatarUrl:null,contactLine:'+55 (61) 99999-0000',badges:null,copyPhone:null},
        tiles:[{value:'274 dias',label:'no funil'},{value:'9 meses',label:'últ. contato',alert:true},{value:'21h 11m',label:'1º contato'}],
        tags:<div className='flex flex-wrap gap-1.5'>{Array.from({length:6},(_,i)=><span key={i} className='h-6 rounded-[5px] px-2 text-[10px]'>Tag sintética {i+1}</span>)}</div>,
        status:<button className='h-8 w-full'>Aberto</button>,quickActions:<div className='flex gap-2'>{action('Ligar')}{action('WhatsApp')}{action('E-mail')}</div>,
        interestProperty:<div>{tall(3)}</div>,contact:{rows:Array.from({length:8},(_,i)=>({label:'Campo '+(i+1),value:'Valor sintético '+(i+1)})),onEdit:()=>{}},
        tabIdPrefix:'t',tabs,activeTab:tab,onTabChange:setTab,tabActions:<button className='h-8'>Agendar visita</button>,
        panel:tab==='atividades'?<div className='flex min-h-0 flex-1 flex-col'><div data-history className='min-h-0 flex-1 overflow-y-auto'>{tall(80)}</div></div>:<div data-panel>{tall(80)}</div>,
        panelScrolls:tab!=='atividades'};
      return mobile?<div className='h-screen'><MobileLeadLayout {...props}/></div>
        :<div className='fixed inset-0 flex items-center justify-center'><div data-dialog className={${JSON.stringify('__DIALOG__')}}><DesktopLeadLayout {...props}/></div></div>;
    }
    document.documentElement.classList.add(q.get('theme')==='dark'?'dark':'light');createRoot(document.getElementById('root')).render(<Fixture/>);`);
  const modulePath = join(repository, 'components/features/leads/lead-detail/PipelineLeadDetail.module.css');
  const compiled = require('lightningcss').transform({ filename: modulePath, code: await readFile(modulePath), cssModules: true });
  moduleCSS = compiled.code.toString();
  // The production DialogContent base classes plus the Pipeline module class.
  dialogClass = `flex flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] ${compiled.exports.dialog.name}`;
  const source = (await readFile(entry, 'utf8')).replace(JSON.stringify('__DIALOG__'), JSON.stringify(dialogClass));
  await writeFile(entry, source);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((done, reject) => { const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry, output: { path: directory, filename: 'fixture.js' }, resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': repository }, modules: [join(repository, 'node_modules'), 'node_modules'] }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } }); compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : done())); });
  bundle = await readFile(join(directory, 'fixture.js'), 'utf8');
  const globals = await readFile(join(repository, 'app/globals.css'), 'utf8');
  const sources = ['components/features/leads/lead-detail', 'components/ui', directory].map(path => `@source "${resolve(repository, path).replaceAll('\\', '/')}";`).join('\n');
  css = (await require('postcss')([require('@tailwindcss/postcss')({ base: repository })]).process(`${globals.replace('@import "tailwindcss";', '@import "tailwindcss" source(none);')}\n${sources}`, { from: join(repository, 'app/globals.css') })).css;
  browser = await chromium.launch();
});

after(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

async function open({ width, height, mobile, theme = 'light', stages = 9 }) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith('http://fixture.local/') ? route.continue() : route.abort());
  await page.route('http://fixture.local/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><style>${css}\n${moduleCSS}</style></head><body><div id="root"></div><script>${bundle}</script></body></html>` }));
  await page.goto(`http://fixture.local/?mobile=${mobile ? 1 : 0}&theme=${theme}&stages=${stages}`);
  await page.getByRole('tablist').waitFor();
  return { page, errors };
}

const measure = page => page.evaluate(() => {
  const box = element => element.getBoundingClientRect();
  const tablist = document.querySelector('[role="tablist"]');
  return {
    documentOverflow: document.documentElement.scrollWidth > innerWidth,
    tablistOverflow: tablist.scrollWidth > tablist.clientWidth + 1,
    tablistScrollbar: tablist.offsetHeight - tablist.clientHeight > 0,
    tabs: [...document.querySelectorAll('[role="tab"]')].map(tab => ({ width: box(tab).width, height: box(tab).height, right: box(tab).right })),
    touch: [...document.querySelectorAll('[data-touch], [role="tab"]')].map(element => box(element).height),
    dialog: document.querySelector('[data-dialog]') && (({ x, y, right, bottom }) => ({ x, y, right, bottom }))(box(document.querySelector('[data-dialog]'))),
    horizontal: [...document.querySelectorAll('aside, main, header, [role="tabpanel"]')].filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.tagName),
  };
});

for (const [width, height] of [[1024, 600], [1280, 720], [1366, 768], [1440, 900], [1920, 1080]]) for (const theme of ['light', 'dark']) {
  test(`desktop ${width}x${height} ${theme}: dialog fits, tabs share one row without scrollbars`, async () => {
    const { page, errors } = await open({ width, height, mobile: false, theme });
    try {
      const measured = await measure(page), evidence = JSON.stringify(measured);
      assert.equal(measured.documentOverflow, false, evidence);
      assert.ok(measured.dialog.x >= 23 && measured.dialog.y >= 23 && measured.dialog.right <= width - 23 && measured.dialog.bottom <= height - 23, evidence);
      assert.equal(measured.tablistOverflow, false, evidence);
      assert.equal(measured.tablistScrollbar, false, evidence);
      assert.deepEqual(measured.horizontal, [], evidence);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}

for (const [width, height] of [[320, 568], [360, 640], [390, 844]]) for (const theme of ['light', 'dark']) {
  test(`mobile ${width}x${height} ${theme}: no horizontal overflow, six tabs fit, touch targets of at least 40px`, async () => {
    const { page, errors } = await open({ width, height, mobile: true, theme });
    try {
      const measured = await measure(page), evidence = JSON.stringify(measured);
      assert.equal(measured.documentOverflow, false, evidence);
      assert.equal(measured.tablistOverflow, false, evidence);
      assert.equal(measured.tabs.length, 6);
      assert.ok(measured.tabs.every(tab => tab.right <= width + 0.5), evidence);
      assert.ok(measured.touch.every(value => value >= 40), evidence);
      assert.deepEqual(measured.horizontal, [], evidence);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}

test('a refreshed snapshot keeps the sidebar scroll, another lead starts at the top', async () => {
  const { page } = await open({ width: 1280, height: 720, mobile: false });
  try {
    const aside = page.locator('aside');
    await aside.evaluate(element => { element.scrollTop = 200; });
    await page.evaluate(() => window.h.setKey('lead-a'));
    assert.ok(await aside.evaluate(element => element.scrollTop) > 0, 'same lead keeps its position');
    await page.evaluate(() => window.h.setKey('lead-b'));
    await page.waitForFunction(() => document.querySelector('aside').scrollTop === 0);
  } finally { await page.close(); }
});

for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} stage move asks first; Escape cancels and confirm moves once`, async () => {
  const { page } = await open(mobile ? { width: 390, height: 844, mobile } : { width: 1366, height: 768, mobile });
  try {
    await page.getByRole('button', { name: 'Próxima etapa', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Confirmar mudança de etapa' });
    await confirm.waitFor();
    await page.keyboard.press('Escape');
    await confirm.waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => window.h.moves), []);
    await page.getByRole('button', { name: 'Mover para Etapa sintética com nome longo 4', exact: true }).click();
    await confirm.getByRole('button', { name: 'Mover lead', exact: true }).click();
    await confirm.waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => window.h.moves), ['s3']);
  } finally { await page.close(); }
});

test('more than ten stages show bars only and the list search finds a stage', async () => {
  const { page } = await open({ width: 1366, height: 768, mobile: false, stages: 24 });
  try {
    assert.equal(await page.locator('[data-lead-stage-step]').count(), 24);
    assert.equal(await page.locator('[data-lead-stage-step] span.truncate').count(), 0);
    await page.getByRole('button', { name: /^Etapa atual:/ }).click();
    await page.getByRole('textbox', { name: 'Buscar etapa' }).fill('longo 17');
    assert.equal(await page.getByRole('option').count(), 1);
  } finally { await page.close(); }
});
