import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Actual mobile/desktop assignee JSX and catalog notice, with real Radix and
// Command filtering. Catalog responses/callbacks are synthetic, network denied.
const require = createRequire(import.meta.url), ts = require('typescript');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
let directory, browser, bundle, css;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-assignee-catalog-'));
  const detailCssPath = join(repository, 'components/features/leads/lead-detail/PipelineLeadDetail.module.css');
  const detailCss = require('lightningcss').transform({ filename: detailCssPath, code: await readFile(detailCssPath), cssModules: true });
  const detailClasses = Object.fromEntries(Object.entries(detailCss.exports).map(([name, value]) => [name, value.name]));
  const source = await readFile(process.env.ASSIGNEE_CATALOG_SOURCE || join(repository, 'components/features/leads/LeadDetailDialog.tsx'), 'utf8');
  const ast = ts.createSourceFile('LeadDetailDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = name => {
    let found; const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node; ts.forEachChild(node, visit); };
    visit(ast); assert.ok(found, name); return found;
  };
  const mobile = declaration('headerAssignee').initializer.getText(ast);
  const desktopBody = declaration('DesktopContentV2').initializer;
  let desktop;
  const find = node => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'Popover' &&
      node.getText(ast).includes('Buscar...')) desktop = node.getText(ast);
    ts.forEachChild(node, find);
  };
  find(desktopBody); assert.ok(desktop);
  const bindings = ['safeAllUsers','canTransferLead','canUnassignLead','assigneeCatalogBlocked','assignableUsers','handleAssigneePopoverChange','teams','assigneeAvailabilityUnverified'].map(name => {
    try { return 'const ' + declaration(name).getText(ast) + ';'; }
    catch { assert.ok(['assigneeCatalogBlocked','assigneeAvailabilityUnverified'].includes(name)); return `const ${name}=false;`; }
  }).join('\n');
  const entry = join(directory, 'entry.tsx'), loader = join(directory, 'loader.cjs');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
  await writeFile(entry, `import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{User,Loader2,ChevronDown}from'lucide-react';import{Button}from'@/components/ui/button';import{Popover,PopoverTrigger,PopoverContent}from'@/components/ui/popover';
    import{Command,CommandInput,CommandList,CommandEmpty,CommandGroup,CommandItem}from'@/components/ui/command';import{Avatar,AvatarImage,AvatarFallback}from'@/components/ui/avatar';
    import{Dialog,DialogContent,DialogTitle,DialogDescription}from'@/components/ui/dialog';import{LeadAssigneeCatalogNotice}from'@/components/features/leads/lead-detail/LeadAssigneeCatalogNotice';import{cn}from'@/lib/utils';
    const h=window.h={selected:[],retryCount:0};function Fixture(){const[catalog,setCatalog]=useState({loading:true,error:false,retrying:false,users:[]}),[assigneePopoverOpen,setAssigneePopoverOpen]=useState(false),[allowed,setAllowed]=useState(true),[variant,setVariant]=useState('pipeline'),[teamCatalog,setTeamCatalog]=useState({isPending:false,isError:false,data:[{id:'team-a'}]}),[teamView,setTeamView]=useState(true);
      h.set=patch=>setCatalog(current=>({...current,...patch}));h.allow=setAllowed;h.variant=setVariant;h.teamView=setTeamView;h.teams=patch=>setTeamCatalog(current=>({...current,...patch}));
      const allUsers=catalog.users,allUsersState=catalog.legacy?undefined:{...catalog,retry:()=>{h.retryCount++;setCatalog(current=>({...current,retrying:true}))}};
      const pipelineDetailStyles=${JSON.stringify(detailClasses)},isUpdatingAssignee=false,assigneeName='Atual',canOperateLead=allowed,hasPermission=permission=>permission==='team_view'&&teamView;
      const commandSearchFilter=(value,search)=>value.toLocaleLowerCase().includes(search.toLocaleLowerCase())?1:0;
      const handleAssignUser=id=>{h.selected.push(id);setAssigneePopoverOpen(false)};
      ${bindings}
      return <Dialog open><DialogContent><DialogTitle>Responsáveis sintéticos</DialogTitle><DialogDescription>Catálogo de teste.</DialogDescription>{innerWidth<768?${mobile}:${desktop}}</DialogContent></Dialog>;
    }createRoot(document.getElementById('root')).render(<Fixture/>);`);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((done,reject)=>{const compiler=webpack({mode:'development',target:'web',devtool:false,entry,output:{path:directory,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':repository},modules:[join(repository,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]}});compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):done()));});
  bundle = await readFile(join(directory,'fixture.js'),'utf8');
  const globals=(await readFile(join(repository,'app/globals.css'),'utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);');
  css=(await require('postcss')([require('@tailwindcss/postcss')({base:repository})]).process(`${globals}\n@source "${repository.replaceAll('\\','/')}/components/features/leads/LeadDetailDialog.tsx";\n@source "${repository.replaceAll('\\','/')}/components/features/leads/lead-detail/LeadAssigneeCatalogNotice.tsx";\n@source "${repository.replaceAll('\\','/')}/components/ui";`,{from:join(repository,'app/globals.css')})).css;
  css += detailCss.code.toString();
  browser=await chromium.launch({headless:true});
},{timeout:120_000});
after(async()=>{await browser?.close();if(directory){assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(directory.split(/[/\\]/).at(-1).startsWith('vimob-assignee-catalog-'));await rm(directory,{recursive:true,force:true})}});

async function open(t,width){const page=await browser.newPage({viewport:{width,height:844}}),errors=[];page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());t.after(async()=>{await page.close();assert.deepEqual(errors,[])});await page.setContent('<html><body><div id="root"></div></body></html>');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle});await page.getByRole('button',{name:'Alterar responsável pelo lead',exact:true}).click();await page.getByPlaceholder(width<768?'Buscar responsável...':'Buscar...').waitFor();return page;}
const users=[{id:'person-a',name:'Pessoa Alfa'},{id:'person-b',name:'Pessoa Beta'}];

for(const width of[390,1366])test(`loading and failed catalog never advertise an empty or assignable list at ${width}`,async t=>{
  const page=await open(t,width);await page.getByText('Carregando responsáveis…',{exact:true}).waitFor();assert.equal(await page.getByText('Nenhum encontrado.',{exact:true}).count(),0);assert.equal(await page.getByRole('option').count(),0);
  await page.evaluate(users=>window.h.set({loading:false,error:true,users}),users);await page.getByText('Não foi possível carregar os responsáveis.',{exact:true}).waitFor();assert.equal(await page.getByRole('option').count(),0);assert.equal(await page.getByText('Nenhum encontrado.',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Atualizando…',exact:true}).isDisabled(),true);assert.equal(await page.evaluate(()=>window.h.retryCount),1);
  await page.evaluate(users=>window.h.set({loading:false,error:false,retrying:false,users}),users);await page.getByRole('option',{name:'Pessoa Alfa'}).waitFor();assert.equal(await page.getByRole('status').count(),0);
  const search=page.getByPlaceholder(width<768?'Buscar responsável...':'Buscar...');
  await search.focus();
  const highlight=await search.evaluate(input=>{const wrapper=getComputedStyle(input.parentElement);return{background:wrapper.backgroundColor,border:wrapper.borderTopWidth,radius:wrapper.borderTopLeftRadius,shadow:wrapper.boxShadow,fontSize:getComputedStyle(input).fontSize}});
  assert.notEqual(highlight.background,'rgba(0, 0, 0, 0)');assert.equal(highlight.border,'1px');assert.equal(highlight.radius,'6px');assert.notEqual(highlight.shadow,'none');assert.equal(highlight.fontSize,width<768?'16px':'12px');
  if(process.env.ASSIGNEE_CATALOG_ARTIFACT_DIR){await mkdir(process.env.ASSIGNEE_CATALOG_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:join(process.env.ASSIGNEE_CATALOG_ARTIFACT_DIR,`assignee-search-${width}.png`)});}
  await search.fill('Beta');assert.equal(await page.getByRole('option',{name:'Pessoa Alfa'}).count(),0);await page.getByRole('option',{name:'Pessoa Beta'}).click();assert.deepEqual(await page.evaluate(()=>window.h.selected),['person-b']);
});

for(const width of[390,1366])test(`a complete catalog supports empty search and legacy callers at ${width}`,async t=>{
  const page=await open(t,width);await page.evaluate(users=>window.h.set({loading:false,error:false,legacy:true,users}),users);await page.getByRole('option',{name:'Pessoa Alfa'}).waitFor();assert.equal(await page.getByRole('status').count(),0);
  await page.getByPlaceholder(width<768?'Buscar responsável...':'Buscar...').fill('ausente');await page.getByText('Nenhum encontrado.',{exact:true}).waitFor();assert.equal(await page.getByRole('option').count(),0);
});

test('read-only permission still disables the selector after catalog recovery',async t=>{
  const page=await open(t,390);await page.keyboard.press('Escape');await page.evaluate(()=>{window.h.set({loading:false,error:false,users:[]});window.h.allow(false)});await page.waitForFunction(()=>document.querySelector('button[aria-label="Alterar responsável pelo lead"]')?.disabled);assert.equal(await page.getByRole('button',{name:'Alterar responsável pelo lead',exact:true}).isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.h.selected),[]);
});

const unknownAvailability = 'A disponibilidade de horário não pôde ser consultada.';
for(const width of[390,1366])for(const reason of['no-team-view','pending','error','empty'])test(`unknown schedule availability stays silent and preserves selection for ${reason} at ${width}`,async t=>{
  const page=await open(t,width);
  await page.evaluate(({reason,users})=>{
    window.h.set({loading:false,error:false,users});
    if(reason==='no-team-view')window.h.teamView(false);
    else window.h.teams(reason==='pending'?{isPending:true}:reason==='error'?{isError:true}:{data:[]});
  },{reason,users});
  await page.getByRole('option',{name:'Pessoa Alfa'}).waitFor();
  assert.equal(await page.getByText(unknownAvailability,{exact:true}).count(),0);
  assert.equal(await page.getByRole('status').count(),0);
  assert.equal(await page.getByRole('button',{name:/Tentar novamente|Atualizando|Confirmar/}).count(),0);
  await page.getByRole('option',{name:'Pessoa Beta'}).click();
  assert.deepEqual(await page.evaluate(()=>window.h.selected),['person-b']);
});

for(const width of[390,1366])test(`user catalog loading/error owns the notice before unknown availability at ${width}`,async t=>{
  const page=await open(t,width);await page.evaluate(()=>window.h.teamView(false));
  await page.getByText('Carregando responsáveis…',{exact:true}).waitFor();assert.equal(await page.getByText(unknownAvailability,{exact:true}).count(),0);
  await page.evaluate(()=>window.h.set({loading:false,error:true}));await page.getByText('Não foi possível carregar os responsáveis.',{exact:true}).waitFor();assert.equal(await page.getByText(unknownAvailability,{exact:true}).count(),0);
  await page.evaluate(users=>window.h.set({loading:false,error:false,users}),users);await page.getByRole('option',{name:'Pessoa Alfa'}).waitFor();
  assert.equal(await page.getByText(unknownAvailability,{exact:true}).count(),0);assert.equal(await page.getByRole('status').count(),0);
  await page.evaluate(()=>window.h.teamView(true));await page.waitForFunction(()=>!document.body.textContent.includes('A disponibilidade de horário não pôde ser consultada.'));
  assert.equal(await page.getByRole('option',{name:'Pessoa Alfa'}).count(),1);
});

for(const width of[390,1366])test(`non-Pipeline default stays unchanged when team availability is unknown at ${width}`,async t=>{
  const page=await open(t,width);await page.evaluate(users=>{window.h.variant('default');window.h.teamView(false);window.h.teams({isPending:true,isError:true,data:[]});window.h.set({loading:false,error:false,legacy:true,users})},users);
  await page.getByRole('option',{name:'Pessoa Alfa'}).waitFor();assert.equal(await page.getByText(unknownAvailability,{exact:true}).count(),0);assert.equal(await page.getByRole('status').count(),0);
  await page.getByRole('option',{name:'Pessoa Beta'}).click();assert.deepEqual(await page.evaluate(()=>window.h.selected),['person-b']);
});
