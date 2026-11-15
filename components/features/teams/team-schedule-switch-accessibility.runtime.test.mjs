import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const { chromium, expect } = require('@playwright/test');
const sourceRoot = process.env.VIMOB_TEAM_SWITCH_BEFORE_DIR || root;
let directory, browser, bundle;

async function source(relativePath) {
  return ts.createSourceFile(relativePath, await readFile(path.join(sourceRoot, relativePath), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function find(ast, predicate) {
  const found = [];
  const visit = node => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(ast);
  assert.equal(found.length, 1, 'the tested production fragment must remain unique');
  return found[0].getText(ast);
}

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-team-switch-a11y-'));
  const team = await source('components/features/teams/TeamEditorScreen.tsx');
  const member = await source('components/features/teams/MemberAvailabilityDialog.tsx');
  const names = await source('hooks/use-member-availability.ts');
  const teamRows = find(team, node => ts.isCallExpression(node) && node.expression.getText(team) === 'activeWeek.map');
  const memberRows = find(member, node => ts.isCallExpression(node) && node.expression.getText(member) === 'schedules.map');
  const globalSwitch = find(member, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(member) === 'Switch' && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(member) === 'checked' && attribute.initializer?.getText(member) === '{globalAllDay}'));
  const nameDeclarations = ['DAYS_OF_WEEK', 'DAYS_SHORT'].map(name => `const ${find(names, node => ts.isVariableDeclaration(node) && node.name.getText(names) === name)};`).join('\n');
  const dayName = find(names, node => ts.isFunctionDeclaration(node) && node.name?.text === 'getDayName').replace(/^export /, '');
  const entry = path.join(directory, 'fixture.tsx'), loader = path.join(directory, 'loader.cjs');
  // Render each caller's actual weekly JSX with the real Radix Switch. Only
  // surrounding business state/handlers are synthetic; no CRM or provider runs.
  await writeFile(entry, `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{Switch}from'@/components/ui/switch';import{Badge}from'@/components/ui/badge';import{Label}from'@/components/ui/label';
import{Select,SelectTrigger,SelectValue,SelectContent,SelectItem}from'@/components/ui/select';import{Copy}from'lucide-react';
import{cn}from'@/lib/utils';import{DAYS_OF_WEEK,availabilityTimeOptions}from'@/components/features/teams/availability-week';
import{isAvailabilityClock}from'@/lib/teams/availability-clock';
const getDayName=(()=>{${nameDeclarations}\n${dayName}\nreturn getDayName;})();
const initial=()=>Array.from({length:7},(_,day_of_week)=>({day_of_week,is_active:true,is_all_day:true,start_time:'09:00',end_time:'18:00'}));
function TimeSelect(){return null;}
function TeamFixture(){const[activeWeek,setWeek]=useState(initial);const activeScheduleUser={id:'synthetic-user'};
const updateSchedule=(_userId,day,patch)=>setWeek(old=>old.map(row=>row.day_of_week===day?{...row,...patch}:row));const applyScheduleToAllDays=()=>{};
return<section aria-label="Equipe">{${teamRows}}</section>;}
function MemberFixture(){const[schedules,setWeek]=useState(initial);const readOnly=false,bulkUpdate={isPending:false};
const patch=(day,change)=>setWeek(old=>old.map(row=>row.day_of_week===day?{...row,...change}:row));
const toggleDay=day=>setWeek(old=>old.map(row=>row.day_of_week===day?{...row,is_active:!row.is_active}:row));
const toggleDayAllDay=(day,value)=>patch(day,{is_all_day:value});const updateDayTime=(day,key,value)=>patch(day,{[key]:value});const applyDayToAllDays=()=>{};
const globalAllDay=schedules.every(row=>row.is_active&&row.is_all_day);const toggleGlobalAllDay=value=>setWeek(old=>old.map(row=>({...row,is_active:true,is_all_day:value})));
return<section aria-label="Disponibilidade">${globalSwitch}{${memberRows}}</section>;}
createRoot(document.getElementById('app')).render(<><TeamFixture/><MemberFixture/></>);
`);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry, output: { path: directory, filename: 'fixture.js' }, resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': root }, modules: [path.join(root, 'node_modules'), 'node_modules'] }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  bundle = await readFile(path.join(directory, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (!directory) return;
  const target = path.resolve(directory);
  assert.ok(target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('vimob-team-switch-a11y-'));
  await rm(target, { recursive: true, force: true });
});

async function pageFixture() {
  const page = await browser.newPage(), errors = [], network = [];
  page.setDefaultTimeout(3000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    network.push(route.request().url());
    return route.request().url() === 'https://team-switch.invalid/'
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="app"></div></body></html>' })
      : route.abort();
  });
  await page.goto('https://team-switch.invalid/');
  await page.addScriptTag({ content: bundle });
  await page.getByRole('region', { name: 'Equipe', exact: true }).waitFor();
  return { page, errors, network };
}

for (const [regionName, days] of [
  ['Equipe', ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']],
  ['Disponibilidade', ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']],
]) {
  test(`${regionName}: seven day and seven 24h switches expose unique accessible names`, async () => {
    const { page, errors, network } = await pageFixture();
    try {
      const region = page.getByRole('region', { name: regionName, exact: true });
      for (const day of days) for (const name of [`Ativar ${day}`, `Atender 24h em ${day}`]) {
        await expect(region.getByRole('switch', { name, exact: true })).toHaveCount(1);
        await expect(region.getByRole('switch', { name, exact: true })).toBeChecked();
      }
      assert.deepEqual(errors, []); assert.deepEqual(network, ['https://team-switch.invalid/']);
    } finally { await page.close(); }
  });

  test(`${regionName}: mouse and keyboard changes retain the named day and 24h controls`, async () => {
    const { page, errors } = await pageFixture();
    try {
      const region = page.getByRole('region', { name: regionName, exact: true });
      const day = region.getByRole('switch', { name: 'Ativar Domingo', exact: true });
      await day.click(); await expect(day).not.toBeChecked();
      await expect(region.getByRole('switch', { name: 'Atender 24h em Domingo', exact: true })).toHaveCount(0);
      await day.focus(); await page.keyboard.press('Space'); await expect(day).toBeChecked();
      const allDay = region.getByRole('switch', { name: 'Atender 24h em Domingo', exact: true });
      await allDay.focus(); await page.keyboard.press('Space'); await expect(allDay).not.toBeChecked();
      await expect(allDay).toHaveAccessibleName('Atender 24h em Domingo');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}

test('global 24h switch exposes its purpose and retains its name after toggling', async () => {
  const { page, errors } = await pageFixture();
  try {
    const control = page.getByRole('switch', { name: 'Marcar todos os dias como 24h', exact: true });
    await expect(control).toHaveCount(1); await expect(control).toBeChecked();
    await control.click(); await expect(control).not.toBeChecked();
    await expect(control).toHaveAccessibleName('Marcar todos os dias como 24h');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
