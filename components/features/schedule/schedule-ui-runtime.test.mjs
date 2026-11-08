import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
let directory, browser, page;
const errors = [];

// Real React effects, Agenda controls, Radix dialogs and product CSS. Auth and
// transport are synthetic; all network requests are blocked and no CRM starts.
const synthetic = `
import React,{createContext,useContext,useState} from 'react';
import {scheduleDashboardEventsPageSchema} from '@/lib/validation/schedule-dashboard';
export const State=createContext({});
const own={id:'20000000-0000-4000-8000-000000000001',name:'Pessoa sintética',avatar_url:null};
export const baseEvent={id:'30000000-0000-4000-8000-000000000001',organization_id:'10000000-0000-4000-8000-000000000001',user_id:own.id,lead_id:null,property_id:null,title:'Atividade sintética',description:null,event_type:'task',start_time:'2026-10-12T12:00:00.000Z',end_time:'2026-10-12T21:00:00.000Z',is_all_day:false,location:'Sala sintética',status:'scheduled',outcome:null,reminder_minutes:30,recurrence_rule:null,assignee_user_ids:[],user:own,updated_at:'2026-10-01T12:00:00.000Z'};
const users=[own],empty=[];
export function Provider({children,initialState={}}){const[state,setState]=useState(initialState);window.fixturePatch=patch=>setState(current=>({...current,...patch}));window.fixtureState=state;return <State.Provider value={state}>{children}</State.Provider>}
export const useAuth=()=>({profile:own,user:own,activeOrganization:{organizationId:baseEvent.organization_id},tenantContext:{memberRole:'admin',ledUserIds:[]},userOrganizations:[],isSuperAdmin:false});
export const useUserPermissions=()=>{const state=useContext(State);return {hasPermission:()=>state.canManage!==false,isLoading:false}};
export const useOrganizationModules=()=>({hasModule:()=>true});
export const useScheduleUsers=()=>({data:users,canFilterScheduleUsers:true});
export const useTeams=()=>({data:empty});
export const useLeads=()=>({data:empty});
export const useProperties=()=>({data:empty,isLoading:false,isFetching:false});
export const useProperty=id=>{window.requestedProperty=id;return {data:id?{id,title:'Imóvel fora da primeira página',code:'S51'}:null,isLoading:false,isError:false,refetch:()=>{}}};
export const PropertyPreviewDialog=({property,open})=>open&&property?<div data-testid="property-preview">{property.id} · {property.title}</div>:null;
export const PropertyPickerDialog=()=>null;
export const useScheduleEventAssignees=()=>({assignees:empty,isLoading:false,isFetching:false,isError:false,refetch:()=>{}});
export const useToast=()=>({toast:()=>{}});
const mutation=name=>({isPending:name==='update'&&!!window.fixtureState.updatePending,mutate:input=>window.fixtureWrites.push({name,input}),mutateAsync:async input=>{window.fixtureWrites.push({name,input});if(window.fixtureState.writeFail)throw Error('synthetic failure');return {...baseEvent,...input}}});
export const useCreateScheduleEvent=()=>mutation('create');export const useUpdateScheduleEvent=()=>mutation('update');export const useCompleteScheduleEvent=()=>mutation('complete');export const useRescheduleScheduleEvent=()=>mutation('reschedule');export const useDeleteScheduleEvent=()=>mutation('delete');
export const useScheduleCapabilities=()=>{const state=useContext(State);return {data:state.capabilityError?undefined:{timeZone:state.capabilityMissingTimezone?undefined:state.timeZone||'America/Sao_Paulo',isTeamLeader:true},isSuccess:!state.capabilityError,isError:!!state.capabilityError,refetch:()=>window.fixturePatch({capabilityError:false,capabilityMissingTimezone:false})}};
export const useScheduleEvents=options=>{if(options.startDate){window.eventQuery=options;if(options.enabled!==false)window.fixtureReads.push(options)}return {data:options.enabled===false?undefined:window.fixtureEvents,isLoading:false,isError:false,refetch:()=>{}}};
export const useScheduleDashboardQueryScope=()=>({organizationId:baseEvent.organization_id,currentUserId:own.id,accessSignature:'synthetic',isReady:true});
export const useScheduleDashboard=()=>({data:window.fixtureDashboard,isPending:false,isError:false,isFetching:false,isPlaceholderData:false,refetch:()=>{}});
export const useScheduleDashboardEvents=()=>({data:{pages:[scheduleDashboardEventsPageSchema.parse({items:window.fixtureEvents.slice(0,20).map(event=>({...event,user_name:own.name,user_avatar_url:null,lead_name:null,property_code:null,property_title:null,is_overdue:false})),total:51,limit:20,offset:0,has_more:true})]},isPending:false,isError:false,isFetching:false,hasNextPage:true,fetchNextPage:()=>{},refetch:()=>{}});
export const scheduleAPI={getComments:async()=>{if(window.fixtureState.commentError)throw Error('synthetic failure');if(window.fixtureState.commentDelay)await new Promise(resolve=>window.releaseComments=resolve);return []},addComment:async(id,content,organizationId,requestId)=>{window.fixtureWrites.push({name:'comment',input:{id,content,organizationId,requestId}});if(window.fixtureState.writeFail)throw Error('synthetic failure');return {id:requestId,content}}};
export const GoogleCalendarConnect=()=>null;
export const MetaCreativePreview=()=>null;
export const AppLayout=({children})=><main style={{height:'100vh',padding:12}}>{children}</main>;
export const useRouter=()=>({push:()=>{},replace:()=>{}});export const useSearchParams=()=>new URLSearchParams();
export default function Link({children,href,...props}){return <a href={href} {...props}>{children}</a>}
export const dynamic=()=>()=>null;
`;

const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import Agenda from '@/components/features/schedule/AgendaScreen';
import {EventSheet} from '@/components/features/schedule/EventSheet';
import {CalendarView} from '@/components/features/schedule/CalendarView';
import {EventsList} from '@/components/features/schedule/EventsList';
import {CompactScheduleEventsList} from '@/components/features/schedule/CompactScheduleEventsList';
import {ptBR} from 'date-fns/locale';
import {AgendaSourceDistributionPanel} from '@/components/features/schedule/dashboard/AgendaDashboardPanels';
import {AgendaDashboardKpis} from '@/components/features/schedule/dashboard/AgendaDashboardKpis';
import {AgendaDashboard} from '@/components/features/schedule/dashboard/AgendaDashboard';
import {AgendaDashboardPeriodFilter} from '@/components/features/schedule/dashboard/AgendaDashboardPeriodFilter';
import {DateFilterPopover} from '@/components/ui/date-filter-popover';
import {AgendaDataQualityNotice} from '@/components/features/schedule/dashboard/AgendaDataQualityNotice';
import {useScheduleComments} from '@/hooks/use-schedule-comments';
import {scheduleDashboardDataSchema} from '@/lib/validation/schedule-dashboard';
import {Provider,baseEvent} from './synthetic';
const kpis={total:51,completed:5,open:46,overdue:4,no_show:0,upcoming:42,visits:0,meetings:0,calls:0,eligible:9,appointment_eligible:0,cancelled:0,completion_rate:55.56,no_show_rate:0};
window.fixtureDashboard=scheduleDashboardDataSchema.parse({kpis,report_timezone:'America/Sao_Paulo',period:{date_from:'2026-10-11',date_to:'2026-10-17',date_basis:'start_time'},hourly:[],daily:[{date:'2026-10-12',total:51,completed:5,open:46,overdue:4,cancelled:0,no_show:0}],weekly:[],by_outcome:[],top_performers:[],upcoming_events:[],by_type:[{key:'task',count:51}],by_source:Array.from({length:12},(_,index)=>({key:'source'+index,label:'Origem sintética '+index,count:index===11?40:1})),overdue_by_owner:[{user_id:baseEvent.user_id,name:'Pessoa sintética',avatar_url:null,overdue:4}],performer_ranking:[{user_id:baseEvent.user_id,name:'Pessoa sintética',avatar_url:null,total:51,appointments:0,appointment_eligible:0,completed:5,open:46,overdue:4,no_show:0,eligible:9,completion_rate:55.56,no_show_rate:0}]});
function Comments(){const comments=useScheduleComments(baseEvent.id);window.sendFixtureComment=content=>comments.addComment(content);return <div>Comments probe</div>}
function Period({timeZone}){
const[filters,setFilters]=useState({dateFrom:'2026-10-12',dateTo:'2026-10-18',dateBasis:'start_time',source:'synthetic-source'});
window.fixturePeriod=filters;
return <div style={{display:'flex',justifyContent:'flex-end',gap:8}}><DateFilterPopover datePreset="custom" customDateRange={{from:new Date(2026,9,12),to:new Date(2026,9,18,23,59,59,999)}} onDatePresetChange={()=>{}} dateLabel="Período de referência" triggerClassName="bg-primary/50 text-white hover:bg-primary hover:text-white"/><AgendaDashboardPeriodFilter filters={filters} reportTimezone={timeZone} onChange={value=>{window.fixturePeriodChanges.push(value);setFilters(value)}}/></div>;
}
function Fixture({mode,eventType,duration,revision,canManage=true,propertyId,masked=false,initialState,quality,eventOverrides,calendarDate,calendarTimeZone='America/Sao_Paulo'}){
const [open,setOpen]=useState(true);window.fixtureClosed=!open;
const event={...baseEvent,is_masked:masked,event_type:eventType||'task',end_time:new Date(Date.parse(baseEvent.start_time)+(duration||540)*60000).toISOString(),property_id:propertyId||null,property:propertyId?{id:propertyId,title:'Imóvel fora da primeira página',code:'S51'}:null,...eventOverrides};
return <Provider initialState={initialState}><div data-fixture={revision} className="app-shell" style={{height:'100vh'}}>
{mode==='period'?<Period timeZone={calendarTimeZone}/>:mode==='sheet'?<EventSheet open={open} onOpenChange={setOpen} event={event} defaultUserId={event.user_id}/>:mode==='create'?<EventSheet open={open} onOpenChange={setOpen} defaultUserId={event.user_id} defaultDate={new Date(2030,9,12)} defaultTime="09:00"/>:mode==='week'||mode==='month'?<section style={{height:580}}><CalendarView events={[event]} selectedDate={calendarDate?new Date(...calendarDate):new Date(2026,mode==='week'?9:7,mode==='week'?12:1)} pivotDate={calendarDate?new Date(...calendarDate):new Date(2026,mode==='week'?9:7,mode==='week'?12:1)} onDateSelect={day=>window.fixtureSelected=day.getDate()} onPivotChange={()=>{}} viewMode={mode} canManageEvents={canManage} onEventUpdate={(id,input)=>window.fixtureWrites.push({name:'timing',input:{id,...input}})} onEditEvent={()=>window.fixtureOpened++} timeZone={calendarTimeZone}/></section>:mode==='list'?<EventsList events={window.fixtureEvents} paginate canManage={canManage} onEditEvent={()=>window.fixtureOpened++} timeZone="America/Sao_Paulo"/>:mode==='compact'?<CompactScheduleEventsList events={window.fixtureEvents} locale={ptBR} onEditEvent={()=>window.fixtureOpened++}/>:mode==='sources'?<AgendaSourceDistributionPanel items={Array.from({length:12},(_,index)=>({key:'source'+index,label:'Origem sintética '+index,count:12-index}))}/>:mode==='kpis'?<section className="@container/agenda-dashboard" style={{width:'100%'}}><AgendaDashboardKpis kpis={kpis} dateBasis="start_time"/></section>:mode==='dashboard'?<AgendaDashboard syncFiltersToUrl={false} initialFilters={{dateFrom:'2026-10-11',dateTo:'2026-10-17'}}/>:mode==='quality'?<AgendaDataQualityNotice quality={quality}/>:mode==='comments'?<Comments/>:<Agenda/>}
</div></Provider>}
const app=createRoot(document.getElementById('app'));let revision=0;
window.showFixture=options=>{window.fixtureWrites=[];window.fixturePeriodChanges=[];window.fixtureReads=[];window.fixtureOpened=0;window.fixtureEvents=Array.from({length:options.eventCount??51},(_,i)=>({...baseEvent,id:'30000000-0000-4000-8000-'+String(i+2).padStart(12,'0'),title:'Evento sintético '+i,start_time:new Date(Date.parse(baseEvent.start_time)+i*60000).toISOString(),status:i%2?'completed':'scheduled',...options.eventOverrides}));const next=++revision;const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});window.fixtureClient=client;app.render(<QueryClientProvider client={client}><Fixture key={next} revision={next} {...options}/></QueryClientProvider>);return next};
window.showFixture({mode:'sheet'});
`;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "vimob-agenda-ui-"));
  await writeFile(path.join(directory, "fixture.tsx"), fixture);
  await writeFile(path.join(directory, "synthetic.tsx"), synthetic);
  await writeFile(path.join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(path.join(root,"node_modules/typescript"))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;`);
  const names = ["components/features/meta","contexts/AuthContext","hooks/use-user-permissions","hooks/use-organization-modules","hooks/use-schedule-users","hooks/use-teams","hooks/use-leads","hooks/use-properties","hooks/use-schedule-event-assignees","hooks/use-schedule-events","hooks/schedule/use-schedule-dashboard","hooks/schedule/use-schedule-dashboard-events","hooks/use-toast","lib/api/schedule","components/features/properties/PropertyPreviewDialog","components/features/properties/PropertyPickerDialog","components/features/schedule/GoogleCalendarConnect","components/shared/layout/AppLayout"];
  const alias = Object.fromEntries(names.map(name=>[`@/${name}$`,path.join(directory,"synthetic.tsx")]));
  // Same installed icons through the CJS entry, without thousands of ESM barrel modules.
  alias["lucide-react$"]=require.resolve("lucide-react");
  alias["next/navigation$"]=path.join(directory,"synthetic.tsx");
  alias["next/link$"]=path.join(directory,"synthetic.tsx");
  // Dynamic dashboard is outside this calendar fixture; use a separate inert export.
  await writeFile(path.join(directory,"dynamic.tsx"),"export default function dynamic(){return ()=>null}");
  alias["next/dynamic$"]=path.join(directory,"dynamic.tsx");
  const {webpack}=require("next/dist/compiled/webpack/webpack");
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:"development",target:"web",devtool:false,entry:path.join(directory,"fixture.tsx"),output:{path:directory,filename:"fixture.js",publicPath:"/"},plugins:[new webpack.DefinePlugin({"process.env":JSON.stringify({NODE_ENV:"development"})})],resolve:{extensions:[".tsx",".ts",".js",".mjs"],alias:{...alias,"@":root},modules:[path.join(root,"node_modules"),"node_modules"]},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(directory,"loader.cjs")}]}});
    compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  const cssSource=(await readFile(path.join(root,"app/globals.css"),"utf8")).replace('@import "tailwindcss";','@import "tailwindcss" source(none);');
  const sources=["components/features/schedule","components/features/marketing/marketing-ui.tsx","components/ui","components/shared/SearchableFilterSelect.tsx","config/filter-ui.ts"];
  const css=await require("postcss")([require("@tailwindcss/postcss")({base:root})]).process(`${cssSource}\n${sources.map(source=>`@source "${path.join(root,source).replaceAll("\\","/")}";`).join("\n")}`,{from:path.join(root,"app/agenda-fixture.css")});
  browser=await chromium.launch({headless:true});
  page=await browser.newPage({viewport:{width:1024,height:768},timezoneId:"Europe/Lisbon"});
  // Keep assertions strict while allowing bounded action latency on busy hosts.
  page.setDefaultTimeout(15000);
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/*",route=>route.request().url()==="https://agenda-fixture.local/"?route.fulfill({contentType:"text/html",body:`<style>${css.css}</style><div id="app"></div>`}):route.abort());
  await page.goto("https://agenda-fixture.local/");
  await page.clock.setFixedTime(new Date("2026-10-12T13:00:00.000Z"));
  await page.addScriptTag({content:await readFile(path.join(directory,"fixture.js"),"utf8")});
  try { await page.waitForFunction(()=>typeof window.showFixture==="function",null,{timeout:3000}); }
  catch(error) { throw Error(`${error.message}\nBrowser errors: ${errors.join('; ')}\n${await page.locator('body').innerText()}`); }
});

after(async()=>{
  await browser?.close();
  if(directory){const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(tmpdir()));assert.match(path.basename(resolved),/^vimob-agenda-ui-/);await rm(resolved,{recursive:true,force:true});}
});

async function show(options,width=1024,height=768){
  await page.setViewportSize({width,height});
  const revision=await page.evaluate(options=>window.showFixture(options),options);
  await expect(page.locator(`[data-fixture="${revision}"]`)).toBeAttached();
}

for (const width of [320,390,1024,1440]) for (const theme of ["light","dark"]) test(`Agenda period uses shared Dashboard presentation at ${width}px/${theme}`,async()=>{
  // Compare resting colors rather than arbitrary frames of theme/hover transitions.
  await page.addStyleTag({content:"*,*::before,*::after{transition:none!important;animation:none!important}"});
  await page.evaluate(theme=>document.documentElement.className=theme,theme);
  await show({mode:"period",calendarTimeZone:"Pacific/Kiritimati"},width,840);
  const measure=async()=>page.locator('[data-date-filter]').evaluate(panel=>{
    const day=panel.querySelector('[data-day] button'),action=panel.querySelector('[data-date-action="apply"]');
    const font=node=>{const css=getComputedStyle(node),box=node.getBoundingClientRect();return {size:css.fontSize,weight:css.fontWeight,color:css.color,background:css.backgroundColor,width:box.width,height:box.height}};
    const box=panel.getBoundingClientRect();
    return {day:font(day),action:font(action),width:box.width,shortcuts:[...panel.querySelectorAll('[data-date-shortcut]')].map(node=>node.textContent),left:box.left,right:box.right};
  });
  await page.getByRole('button',{name:/^Período de referência:/}).click();
  await page.mouse.move(1,820);
  const reference=await measure();
  const triggerStyle=locator=>locator.evaluate(node=>{const css=getComputedStyle(node);return {font:css.fontSize,weight:css.fontWeight,background:css.backgroundColor,color:css.color,height:node.getBoundingClientRect().height}});
  const referenceTrigger=await triggerStyle(page.getByRole('button',{name:/^Período de referência:/}));
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:/^Período da agenda:/}).click();
  await page.mouse.move(1,820);
  const agenda=await measure();
  assert.deepEqual(await triggerStyle(page.getByRole('button',{name:/^Período da agenda:/})),referenceTrigger);
  assert.deepEqual(agenda.day,reference.day);
  assert.deepEqual(agenda.action,reference.action);
  assert.equal(agenda.width,reference.width);
  assert.deepEqual(agenda.shortcuts,reference.shortcuts);
  assert.ok(agenda.left>=11&&agenda.right<=width-11,"picker stays inside viewport");
  await expect(page.locator('[data-date-filter]').getByRole('grid')).toHaveCount(1);
  if(process.env.VIMOB_AGENDA_FILTER_PROOF_DIR){
    await mkdir(process.env.VIMOB_AGENDA_FILTER_PROOF_DIR,{recursive:true});
    await page.screenshot({path:path.join(process.env.VIMOB_AGENDA_FILTER_PROOF_DIR,`agenda-period-${width}-${theme}.png`)});
  }
  await page.locator('[data-date-filter]').getByRole('button',{name:'Hoje',exact:true}).click();
  const changes=await page.evaluate(()=>window.fixturePeriodChanges);
  assert.equal(changes.length,1);
  assert.deepEqual(changes[0],{dateFrom:'2026-10-13',dateTo:'2026-10-13',dateBasis:'start_time',source:'synthetic-source'});
  await page.getByRole('button',{name:/^Período da agenda:/}).click();
  await page.locator('[data-date-filter]').getByRole('button',{name:'Limpar período',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.fixturePeriod),{dateFrom:'2026-10-12',dateTo:'2026-10-18',dateBasis:'start_time',source:'synthetic-source'});
});

test("Agenda shared picker applies a custom range once and preserves other filters",async()=>{
  await show({mode:"period"});
  await page.getByRole('button',{name:/^Período da agenda:/}).click();
  await page.locator('[data-date-filter] [data-day="2026-10-04"] button').click();
  await page.locator('[data-date-filter] [data-day="2026-10-17"] button').click();
  await page.locator('[data-date-action="apply"]').click();
  assert.deepEqual(await page.evaluate(()=>window.fixturePeriodChanges),[{dateFrom:'2026-10-04',dateTo:'2026-10-17',dateBasis:'start_time',source:'synthetic-source'}]);
  await expect(page.locator('[data-date-filter]')).toHaveCount(0);
});

test("opening edit preserves each stored duration and a title-only save keeps the original interval",async()=>{
  for(const [eventType,duration,endTime] of [["task",540,"18:00"],["call",45,"09:45"],["email",90,"10:30"],["message",120,"11:00"]]){
    await show({mode:"sheet",eventType,duration});
    await page.getByRole("button",{name:"Editar",exact:true}).click();
    await expect(page.getByRole("button",{name:`Horário de fim: ${endTime}`})).toBeVisible();
    await page.getByRole("textbox",{name:"Título da atividade"}).fill("Título alterado");
    await page.getByRole("button",{name:"Salvar",exact:true}).click();
    const write=await page.evaluate(()=>window.fixtureWrites.at(-1));
    assert.equal(Date.parse(write.input.end_time)-Date.parse(write.input.start_time),duration*60000);
    assert.equal(write.input.expected_updated_at,"2026-10-01T12:00:00.000Z");
  }
  assert.deepEqual(errors,[]);
});

test("capability and comment failures show distinct retry states while retaining drafts",async()=>{
  await show({mode:"sheet"});
  await page.getByRole("button",{name:"Editar",exact:true}).click();
  await page.getByRole("textbox",{name:"Título da atividade"}).fill("Título conservado");
  await page.getByRole("textbox",{name:"Observações",exact:true}).fill("Descrição conservada");
  await page.getByRole("textbox",{name:"Comentário...",exact:true}).fill("Comentário conservado");
  await page.evaluate(()=>window.fixturePatch({capabilityError:true,commentError:true}));
  await page.evaluate(()=>window.fixtureClient.invalidateQueries({queryKey:['schedule_comments']}));
  await expect(page.getByText("Não foi possível carregar as configurações da agenda.")).toBeVisible();
  await expect(page.getByText("Não foi possível atualizar os comentários.")).toBeVisible();
  await expect(page.getByText("Nenhum comentário",{exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Salvar",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Salvar",exact:true}).click({force:true});
  assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
  await page.getByRole("button",{name:"Tentar novamente",exact:true}).first().click();
  await expect(page.getByText("Não foi possível carregar as configurações da agenda.")).toHaveCount(0);
  await expect(page.getByRole("textbox",{name:"Título da atividade"})).toHaveValue("Título conservado");
  await expect(page.getByRole("textbox",{name:"Observações",exact:true})).toHaveValue("Descrição conservada");
  await expect(page.getByRole("textbox",{name:"Comentário...",exact:true})).toHaveValue("Comentário conservado");
});

test("property previews use the selected ID outside the picker page",async()=>{
  await show({mode:"sheet",propertyId:"synthetic-property-51"});
  await page.getByText("S51 · Imóvel fora da primeira página",{exact:true}).click();
  await expect(page.getByTestId("property-preview")).toContainText("synthetic-property-51");
});

test("week scrolls horizontally and all six month rows remain reachable",async()=>{
  await show({mode:"week"},512,768);
  const week=page.locator('[data-calendar-week-scroll]');
  assert.equal(await week.evaluate(element=>getComputedStyle(element).overflowX),"auto");
  assert.ok(await week.evaluate(element=>element.scrollWidth>element.clientWidth));
  await week.evaluate(element=>element.scrollLeft=element.scrollWidth);
  assert.ok(await week.evaluate(element=>element.scrollLeft>0));
  await show({mode:"month"},768,600);
  const month=page.locator('[data-calendar-month-grid]');
  assert.equal(await month.evaluate(element=>getComputedStyle(element).overflowY),"auto");
  await month.evaluate(element=>element.scrollTop=element.scrollHeight);
  await expect(month.getByRole("button",{name:"segunda-feira, 31 de agosto",exact:true})).toBeInViewport();
  await month.getByRole("button",{name:"segunda-feira, 31 de agosto",exact:true}).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(()=>window.fixtureSelected),31);
  await show({mode:"month",eventOverrides:{start_time:"2026-08-12T12:00:00.000Z",end_time:"2026-08-12T13:00:00.000Z"}});
  await page.getByRole("button",{name:"Abrir detalhes de Atividade sintética",exact:true}).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(()=>window.fixtureOpened),1);
});

test("list keeps completed events, exposes every page and opens details for view-only users",async()=>{
  await show({mode:"list",canManage:false},390);
  await expect(page.getByText("20 de 51 atividades")).toBeVisible();
  await expect(page.getByRole("checkbox",{name:"Conclusão de Evento sintético 1",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Abrir detalhes de Evento sintético 1",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixtureOpened),1);
  await page.getByRole("button",{name:"Carregar mais atividades"}).click();
  await page.getByRole("button",{name:"Carregar mais atividades"}).click();
  await expect(page.getByRole("button",{name:"Abrir detalhes de Evento sintético 50",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Carregar mais atividades"})).toHaveCount(0);
});

test("list deletion requires a confirmation before the write",async()=>{
  await show({mode:"list"});
  await page.getByRole("button",{name:"Ações de Evento sintético 0",exact:true}).focus();
  await expect(page.getByRole("button",{name:"Ações de Evento sintético 0",exact:true})).toHaveCSS("opacity","1");
  await page.getByRole("button",{name:"Ações de Evento sintético 0",exact:true}).click();
  await page.getByRole("menuitem",{name:"Excluir",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button",{name:"Cancelar",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
});

test("all source entries remain reachable and KPI columns use their container",async()=>{
  await show({mode:"sources"},390);
  await expect(page.getByText("Origem sintética 11",{exact:true})).toBeAttached();
  for(const [width,columns] of [[480,2],[768,2],[1024,4]]){
    await show({mode:"kpis"},width);
    const grid=page.locator('[data-fixture] section>section').first();
    assert.equal(await grid.evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(' ').length),columns);
  }
});

test("retrying create or comment preserves a command UUID until success",async()=>{
  await show({mode:"create"});
  await page.evaluate(()=>window.fixturePatch({writeFail:true}));
  await page.getByRole("textbox",{name:"Título da atividade"}).fill("Nova atividade sintética");
  await page.getByRole("button",{name:"Adicionar",exact:true}).click();
  await page.getByRole("button",{name:"Adicionar",exact:true}).click();
  const ids=await page.evaluate(()=>window.fixtureWrites.map(write=>write.input.client_request_id));
  assert.ok(ids[0]);assert.equal(ids[0],ids[1]);
  await page.getByRole("textbox",{name:"Título da atividade"}).fill("Outro comando sintético");
  await page.getByRole("button",{name:"Adicionar",exact:true}).click();
  assert.notEqual(await page.evaluate(()=>window.fixtureWrites.at(-1).input.client_request_id),ids[0]);
  await show({mode:"comments"});
  await page.evaluate(()=>window.fixturePatch({writeFail:true}));
  await page.evaluate(()=>window.sendFixtureComment("Comentário sintético"));
  await expect.poll(()=>page.evaluate(()=>window.fixtureWrites.length)).toBe(1);
  await page.evaluate(()=>window.sendFixtureComment("Comentário sintético"));
  await expect.poll(()=>page.evaluate(()=>window.fixtureWrites.length)).toBe(2);
  const commentIds=await page.evaluate(()=>window.fixtureWrites.map(write=>write.input.requestId));
  assert.equal(commentIds[0],commentIds[1]);
});

test("drag and resize keep duration semantics, concurrency baseline and suppress accidental editing",async()=>{
  await show({mode:"week",eventOverrides:{start_time:"2026-10-12T12:00:17.123Z",end_time:"2026-10-12T13:00:47.456Z"}});
  const week=page.locator('[data-calendar-week-scroll]');
  await week.evaluate(element=>element.scrollTop=400);
  const card=week.locator('[data-calendar-event-density]');
  const bounds=await card.boundingBox();
  assert.ok(bounds);
  await page.mouse.move(bounds.x+12,bounds.y+12);
  await page.mouse.down();
  await page.mouse.move(bounds.x+12+134,bounds.y+12+56,{steps:8});
  await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>window.fixtureWrites.length)).toBe(1);
  const drag=await page.evaluate(()=>window.fixtureWrites[0].input);
  assert.equal(Date.parse(drag.end_time)-Date.parse(drag.start_time),3630333);
  assert.equal(drag.expected_updated_at,"2026-10-01T12:00:00.000Z");
  assert.equal(await page.evaluate(()=>window.fixtureOpened),0);

  await show({mode:"week",duration:60});
  await week.evaluate(element=>element.scrollTop=400);
  const handle=week.locator('[data-calendar-event-resize-handle]');
  const resize=await handle.boundingBox();
  assert.ok(resize);
  await page.mouse.move(resize.x+resize.width/2,resize.y+resize.height/2);
  await page.mouse.down();
  await page.mouse.move(resize.x+resize.width/2,resize.y+resize.height/2+56,{steps:6});
  await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>window.fixtureWrites.length)).toBe(1);
  const update=await page.evaluate(()=>window.fixtureWrites[0].input);
  assert.equal(update.end_time,"2026-10-12T14:00:00.000Z");
  assert.equal(update.expected_updated_at,"2026-10-01T12:00:00.000Z");
  assert.equal(await page.evaluate(()=>window.fixtureOpened),0);
});

test("attendance cards keep accessible rescheduling hints without a calendar banner or timing writes",async()=>{
  await show({mode:"week",eventType:"visit",duration:60});
  await expect(page.getByText("Visitas e reuniões: abra o compromisso para registrar resultado ou remarcar.")).toHaveCount(0);
  const week=page.locator('[data-calendar-week-scroll]');
  await week.evaluate(element=>element.scrollTop=400);
  const card=week.locator('[data-calendar-event-density]');
  assert.match(await card.getAttribute("aria-label"),/Resultado ou remarcar/);
  const bounds=await card.boundingBox();
  await page.mouse.move(bounds.x+10,bounds.y+10);
  await page.mouse.down();
  await page.mouse.move(bounds.x+130,bounds.y+70,{steps:8});
  await page.mouse.up();
  assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
});

test("new events follow the navigated day and month instead of the old selection",async()=>{
  await show({mode:"agenda"});
  await page.getByRole("button",{name:"Próximo período",exact:true}).click();
  await page.getByRole("button",{name:"Novo agendamento",exact:true}).click();
  await expect(page.getByRole("button",{name:"Data da atividade: 19/10/2026",exact:true})).toBeVisible();
  await show({mode:"agenda"});
  await page.getByRole("button",{name:"Filtros da agenda",exact:true}).click();
  await page.getByRole("button",{name:"Mês",exact:true}).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"Próximo período",exact:true}).click();
  await expect(page.getByText("novembro 2026",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Novo agendamento",exact:true}).click();
  await expect(page.getByRole("button",{name:"Data da atividade: 12/11/2026",exact:true})).toBeVisible();
});

test("initial comment loading is distinct from empty data and view-only sheets never expose writes",async()=>{
  await show({mode:"sheet",initialState:{commentDelay:true}});
  await expect(page.getByText("Carregando comentários...",{exact:true})).toBeVisible();
  await expect(page.getByText("Nenhum comentário",{exact:true})).toHaveCount(0);
  await page.evaluate(()=>window.releaseComments());
  await expect(page.getByText("Nenhum comentário",{exact:true})).toBeVisible();
  await show({mode:"sheet",initialState:{canManage:false}});
  await expect(page.getByRole("button",{name:"Editar",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Enviar comentário",exact:true})).toBeDisabled();
  await expect(page.getByRole("textbox",{name:"Local da atividade",exact:true})).toHaveCount(0);
  assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
});

test("location edits preserve timing and failed writes preserve the draft",async()=>{
  await show({mode:"sheet",duration:90});
  await page.getByRole("button",{name:"Editar",exact:true}).click();
  await page.getByRole("textbox",{name:"Local da atividade",exact:true}).fill("Sala alterada sintética");
  await page.evaluate(()=>window.fixturePatch({writeFail:true}));
  await page.getByRole("button",{name:"Salvar",exact:true}).click();
  await expect(page.getByRole("textbox",{name:"Local da atividade",exact:true})).toHaveValue("Sala alterada sintética");
  const write=await page.evaluate(()=>window.fixtureWrites.at(-1).input);
  assert.equal(write.location,"Sala alterada sintética");
  assert.equal(write.end_time,"2026-10-12T13:30:00.000Z");
});

test("dashboard retains controls and contains its panels across every audited width",async()=>{
  const screenshotDirectory=process.env.VIMOB_AGENDA_UI_SCREENSHOT_DIR;
  if(screenshotDirectory)await mkdir(path.resolve(screenshotDirectory),{recursive:true});
  for(const width of [360,390,480,768,1024,1280,1440]){
    await show({mode:"dashboard"},width);
    const dashboard=page.getByRole("region",{name:"Dashboard da agenda"});
    await expect(page.getByRole("button",{name:"Demais filtros da agenda",exact:true})).toBeVisible();
    assert.ok(await dashboard.evaluate(element=>element.scrollWidth<=element.clientWidth+1));
    await expect(page.getByText("Por tipo",{exact:true}).first()).toBeVisible();
    for(const [tab,heading] of [["Compromissos","Lista de compromissos"],["Equipe","Resultado por responsável"],["Resultados","Como terminaram"],["Visão geral","Próximo compromisso"]]){
      await page.getByRole("button",{name:tab,exact:true}).click();
      await expect(page.getByRole("heading",{name:heading,exact:true})).toBeVisible();
      assert.ok(await dashboard.evaluate(element=>element.scrollWidth<=element.clientWidth+1),`${tab} at ${width}px`);
    }
    if(screenshotDirectory)await page.screenshot({path:path.join(path.resolve(screenshotDirectory),`agenda-dashboard-${width}.png`),fullPage:true});
  }
  for(const width of [1024,1280,1440])for(const sidebar of [56,208]){
    await show({mode:"dashboard"},width);
    const dashboard=page.getByRole("region",{name:"Dashboard da agenda"});
    await dashboard.evaluate((element,usefulWidth)=>element.style.width=usefulWidth+'px',width-sidebar-48);
    assert.ok(await dashboard.evaluate(element=>element.scrollWidth<=element.clientWidth+1),`viewport ${width}, sidebar ${sidebar}`);
    await expect(page.getByRole("button",{name:"Demais filtros da agenda",exact:true})).toBeVisible();
  }
  assert.deepEqual(errors,[]);
});

test("historical coverage distinguishes an absent report from complete cohort data and unperiodized gaps",async()=>{
  await show({mode:"quality"},390);
  await expect(page.getByText("Cobertura histórica não informada nesta leitura.")).toBeVisible();
  await page.getByRole("button",{name:"Detalhes da qualidade dos dados da agenda"}).click();
  await expect(page.getByRole("dialog",{name:"Cobertura dos dados da agenda"})).toContainText("não comprovam que o histórico esteja completo");
  const quality={period_events:20,missing_created_by:2,missing_lead_source_snapshot:3,completed_without_performer:4,completed_without_result_time:5,unknown_result_time_in_scope:75};
  await show({mode:"quality",quality},390);
  await page.getByRole("button",{name:"Detalhes da qualidade dos dados da agenda"}).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog",{name:"Cobertura dos dados da agenda"})).toContainText("20 eventos considerados");
  await expect(page.getByRole("dialog",{name:"Cobertura dos dados da agenda"})).toContainText("75 finalizados sem data de desfecho no escopo dos filtros");
  await expect(page.getByRole("dialog",{name:"Cobertura dos dados da agenda"})).toContainText("não é atribuída ao período selecionado");
  await show({mode:"quality",quality:{period_events:20,missing_created_by:0,missing_lead_source_snapshot:0,completed_without_performer:0,completed_without_result_time:0,unknown_result_time_in_scope:0}});
  await expect(page.getByRole("button",{name:"Detalhes da qualidade dos dados da agenda"})).toHaveCount(0);
});

test("title-only edits do not reassign existing references or attendees",async()=>{
  await show({mode:"sheet",duration:90,propertyId:"synthetic-property-51"});
  await page.getByRole("button",{name:"Editar",exact:true}).click();
  await page.getByRole("textbox",{name:"Título da atividade"}).fill("Título sem mudar vínculos");
  await page.getByRole("button",{name:"Salvar",exact:true}).click();
  const input=await page.evaluate(()=>window.fixtureWrites.at(-1).input);
  for(const key of ["user_id","lead_id","property_id","team_id","assignee_ids","recurrence_rule"])assert.equal(input[key],undefined);
  assert.equal(input.title,"Título sem mudar vínculos");
  assert.equal(input.end_time,"2026-10-12T13:30:00.000Z");
});

test("metadata edits preserve second precision and an existing multi-day all-day interval",async()=>{
  for(const eventOverrides of [
    {start_time:"2026-10-12T12:00:17.000Z",end_time:"2026-10-12T13:30:39.000Z"},
    {start_time:"2026-10-12T03:00:00.000Z",end_time:"2026-10-15T03:00:00.000Z",is_all_day:true},
  ]){
    await show({mode:"sheet",eventOverrides});
    await page.getByRole("button",{name:"Editar",exact:true}).click();
    await page.getByRole("textbox",{name:"Título da atividade"}).fill("Metadados alterados");
    await page.getByRole("button",{name:"Salvar",exact:true}).click();
    const input=await page.evaluate(()=>window.fixtureWrites.at(-1).input);
    assert.equal(input.start_time,eventOverrides.start_time);
    assert.equal(input.end_time,eventOverrides.end_time);
    assert.equal(input.is_all_day,Boolean(eventOverrides.is_all_day));
  }
});

test("completed activities distinguish the recorded executor from the person who entered the result",async()=>{
  await show({mode:"list",canManage:false,eventOverrides:{status:"completed",performed_by:null,completed_by:"recorder",completed_by_user:{name:"Pessoa que registrou"}}});
  await expect(page.getByText("Executor não informado",{exact:true}).first()).toBeVisible();
  await expect(page.getByText("Conclusão registrada por Pessoa que registrou.",{exact:true}).first()).toBeVisible();
  await expect(page.getByText("Concluído por: Pessoa que registrou",{exact:true})).toHaveCount(0);
  await show({mode:"list",canManage:false,eventOverrides:{status:"completed",performed_by:"executor",performed_by_user:{name:"Pessoa que executou"},completed_by:"recorder",completed_by_user:{name:"Pessoa que registrou"}}});
  await expect(page.getByText("Concluído por: Pessoa que executou",{exact:true}).first()).toBeVisible();
  await expect(page.getByText("Conclusão registrada por Pessoa que registrou.",{exact:true}).first()).toBeVisible();
});

test("calendar failure blocks reads and creation until the organization timezone is restored",async()=>{
  await page.evaluate(()=>localStorage.setItem("agendaViewMode","week"));
  await show({mode:"agenda",initialState:{capabilityError:true,timeZone:"Asia/Tokyo"}});
  await expect(page.getByText("Não foi possível carregar as configurações da agenda.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Novo agendamento",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Novo agendamento",exact:true}).click({force:true});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent("vimob:mobile-create-agenda")));
  const calendar=await page.locator('[data-tour="agenda-calendar"]').boundingBox();
  await page.mouse.move(calendar.x+8,calendar.y+8);
  await page.mouse.down();
  await page.mouse.move(calendar.x+70,calendar.y+70,{steps:5});
  await page.mouse.up();
  await expect(page.locator('[data-calendar-event-density]')).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
  assert.equal(await page.evaluate(()=>window.fixtureReads.length),0);
  assert.equal(await page.evaluate(()=>window.eventQuery.enabled),false);
  await page.getByRole("button",{name:"Tentar novamente",exact:true}).click();
  await expect(page.locator('[data-calendar-week-scroll]')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.eventQuery.startDate.toISOString())).toBe("2026-10-10T15:00:00.000Z");
  await expect(page.locator('[data-calendar-event-density]').filter({hasText:"Evento sintético 0"}).first()).toHaveAttribute("aria-label",/^Evento sintético 0\. 21:00/);
  await page.evaluate(()=>window.fixturePatch({updatePending:true}));
  await expect(page.getByRole("button",{name:"Novo agendamento",exact:true})).toBeDisabled();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent("vimob:mobile-create-agenda")));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(()=>window.fixturePatch({updatePending:false}));
  await page.getByRole("button",{name:"Novo agendamento em 12/10/2026 às 23:00",exact:true}).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button",{name:"Horário de início: 23:00",exact:true})).toBeVisible();
  await page.getByRole("textbox",{name:"Título da atividade"}).fill("Criação depois de confirmar fuso");
  await page.getByRole("button",{name:"Adicionar",exact:true}).click();
  const created=await page.evaluate(()=>window.fixtureWrites.at(-1));
  assert.equal(created.name,"create");
  assert.equal(created.input.start_time,"2026-10-12T14:00:00.000Z");
});

test("moving only the start clock preserves exact duration including milliseconds and sub-minute events",async()=>{
  for(const delta of [5422000,20000,1]){
    const start_time="2026-10-12T12:00:17.000Z";
    const eventOverrides={start_time,end_time:new Date(Date.parse(start_time)+delta).toISOString()};
    await show({mode:"sheet",eventOverrides});
    await page.getByRole("button",{name:"Editar",exact:true}).click();
    await page.getByRole("button",{name:"Horário de início: 09:00",exact:true}).click();
    await page.locator('input[type="time"][aria-label="Horário de início"]').fill("10:00");
    await page.keyboard.press("Escape");
    await page.getByRole("button",{name:"Salvar",exact:true}).click();
    const write=await page.evaluate(()=>window.fixtureWrites.at(-1));
    assert.equal(write.input.start_time,"2026-10-12T13:00:00.000Z");
    assert.equal(Date.parse(write.input.end_time)-Date.parse(write.input.start_time),delta);
  }
});

test("changing an all-day date keeps its three civil days and its stored end convention",async()=>{
  for(const end_time of ["2026-10-15T03:00:00.000Z","2026-10-15T02:59:59.999Z"]){
    const eventOverrides={start_time:"2026-10-12T03:00:00.000Z",end_time,is_all_day:true};
    await show({mode:"sheet",eventOverrides});
    await expect(page.getByText(/Dia inteiro · 3 dias/)).toBeVisible();
    await page.getByRole("button",{name:"Editar",exact:true}).click();
    await page.getByRole("button",{name:"Data da atividade: 12/10/2026",exact:true}).click();
    await page.getByRole("button",{name:/terça-feira, 13 de outubro de 2026/i}).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button",{name:"Salvar",exact:true}).click();
    const write=await page.evaluate(()=>window.fixtureWrites.at(-1));
    assert.equal(write.input.start_time,"2026-10-13T03:00:00.000Z");
    assert.equal(Date.parse(write.input.end_time)-Date.parse(write.input.start_time),Date.parse(end_time)-Date.parse(eventOverrides.start_time));
  }
});

test("explicit rescheduling preserves exact duration and a multi-day all-day interval",async()=>{
  for(const eventOverrides of [
    {start_time:"2026-10-12T12:00:17.000Z",end_time:"2026-10-12T13:30:39.000Z"},
    {start_time:"2026-10-12T12:00:17.000Z",end_time:"2026-10-12T12:00:37.000Z"},
    {start_time:"2026-10-12T03:00:00.000Z",end_time:"2026-10-15T03:00:00.000Z",is_all_day:true},
  ]){
    await show({mode:"sheet",eventType:"visit",eventOverrides});
    await page.getByRole("button",{name:"Resultado ou remarcar",exact:true}).click();
    await page.getByRole("radio",{name:/Remarcar/}).click();
    await page.locator('input[type="date"][aria-label="Nova data"]').fill("2026-10-20");
    await page.getByRole("button",{name:"Confirmar remarcação",exact:true}).click();
    const write=await page.evaluate(()=>window.fixtureWrites.at(-1));
    assert.equal(write.name,"reschedule");
    assert.equal(Date.parse(write.input.end_time)-Date.parse(write.input.start_time),Date.parse(eventOverrides.end_time)-Date.parse(eventOverrides.start_time));
    assert.equal(write.input.expected_updated_at,"2026-10-01T12:00:00.000Z");
  }
});

test("deletion is blocked during another write, including after its confirmation has opened",async()=>{
  await show({mode:"sheet",initialState:{updatePending:true}});
  await expect(page.getByRole("button",{name:"Editar",exact:true})).toBeDisabled();
  await expect(page.getByRole("button",{name:"Excluir atividade",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Excluir atividade",exact:true}).click({force:true});
  assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
  await page.evaluate(()=>window.fixturePatch({updatePending:false}));
  await page.getByRole("button",{name:"Excluir atividade",exact:true}).click();
  await page.evaluate(()=>window.fixturePatch({updatePending:true}));
  await expect(page.getByRole("button",{name:"Excluir",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Excluir",exact:true}).click({force:true});
  assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
  await page.evaluate(()=>window.fixturePatch({updatePending:false}));
  await page.getByRole("button",{name:"Excluir",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixtureWrites.at(-1).name),"delete");
});

test("independent EventSheet rescheduling waits for confirmed timezone and retains the outcome draft across retry",async()=>{
  await show({mode:"sheet",eventType:"visit",initialState:{capabilityError:true,timeZone:"Asia/Tokyo"}});
  await expect(page.getByRole("button",{name:"Editar",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Resultado ou remarcar",exact:true}).click();
  const result=page.getByRole("dialog",{name:"Resultado da visita",exact:true});
  await expect(result.getByRole("radio",{name:/Remarcar/})).toBeDisabled();
  await expect(result.getByRole("radio",{name:/Visita realizada/})).toBeEnabled();
  await result.getByRole("textbox",{name:"Observações ou motivo do resultado"}).fill("Motivo preservado");
  assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
  await result.getByRole("button",{name:"Tentar novamente",exact:true}).click();
  await expect(result.getByRole("textbox",{name:"Observações ou motivo do resultado"})).toHaveValue("Motivo preservado");
  await result.getByRole("radio",{name:/Remarcar/}).click();
  await expect(result.locator('input[type="time"][aria-label="Novo horário"]')).toHaveValue("21:00");
  await result.locator('input[type="date"][aria-label="Nova data"]').fill("2026-10-20");
  await result.locator('input[type="time"][aria-label="Novo horário"]').fill("09:00");
  await page.evaluate(()=>window.fixturePatch({capabilityError:true}));
  await expect(result.getByRole("button",{name:"Confirmar remarcação",exact:true})).toBeDisabled();
  await result.getByRole("button",{name:"Confirmar remarcação",exact:true}).click({force:true});
  assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
  await result.getByRole("button",{name:"Tentar novamente",exact:true}).click();
  await expect(result.locator('input[type="date"][aria-label="Nova data"]')).toHaveValue("2026-10-20");
  await expect(result.locator('input[type="time"][aria-label="Novo horário"]')).toHaveValue("09:00");
  await result.getByRole("button",{name:"Confirmar remarcação",exact:true}).click();
  const write=await page.evaluate(()=>window.fixtureWrites.at(-1));
  assert.equal(write.name,"reschedule");
  assert.equal(write.input.start_time,"2026-10-20T00:00:00.000Z");
  assert.equal(write.input.outcome_notes,"Motivo preservado");
});

test("a successful capability response without timezone cannot confirm the fallback",async()=>{
  await page.evaluate(()=>localStorage.setItem("agendaViewMode","week"));
  await show({mode:"agenda",initialState:{capabilityMissingTimezone:true,timeZone:"Asia/Tokyo"}});
  await expect(page.getByText("Não foi possível carregar as configurações da agenda.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Novo agendamento",exact:true})).toBeDisabled();
  assert.equal(await page.evaluate(()=>window.fixtureReads.length),0);
  await page.getByRole("button",{name:"Tentar novamente",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.eventQuery.startDate.toISOString())).toBe("2026-10-10T15:00:00.000Z");
  await show({mode:"sheet",eventType:"visit",initialState:{capabilityMissingTimezone:true,timeZone:"Asia/Tokyo"}});
  await page.getByRole("button",{name:"Resultado ou remarcar",exact:true}).click();
  await expect(page.getByRole("radio",{name:/Remarcar/})).toBeDisabled();
  assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
});

test("day and week keyboard slots dispatch the organization civil date and clock",async()=>{
  for(const mode of ["day","week"]){
    await page.evaluate(mode=>localStorage.setItem("agendaViewMode",mode),mode);
    await show({mode:"agenda",initialState:{timeZone:"Asia/Tokyo"}});
    const slot=page.getByRole("button",{name:"Novo agendamento em 12/10/2026 às 23:00",exact:true});
    await slot.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button",{name:"Data da atividade: 12/10/2026",exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"Horário de início: 23:00",exact:true})).toBeVisible();
    await page.getByRole("textbox",{name:"Título da atividade"}).fill("Criação pelo slot "+mode);
    await page.getByRole("button",{name:"Adicionar",exact:true}).click();
    assert.equal(await page.evaluate(()=>window.fixtureWrites.at(-1).input.start_time),"2026-10-12T14:00:00.000Z");
  }
});

test("existing attendance type choices preserve the appointment contract and new tasks can become visits",async()=>{
    await show({mode:"sheet",eventType:"visit",duration:60});
    await page.getByRole("button",{name:"Editar",exact:true}).click();
    await page.getByRole("combobox",{name:"Tipo da atividade",exact:true}).click();
    await expect(page.getByRole("option",{name:"Tarefa",exact:true})).toHaveCount(0);
    await expect(page.getByRole("option",{name:"Ligação",exact:true})).toHaveCount(0);
    await page.getByRole("option",{name:"Reunião",exact:true}).click();
    await page.getByRole("button",{name:"Salvar",exact:true}).click();
    const appointment=await page.evaluate(()=>window.fixtureWrites.at(-1).input);
    assert.equal(appointment.event_type,"meeting");
    assert.equal(appointment.start_time,undefined);
    assert.equal(appointment.end_time,undefined);
  await show({mode:"sheet",eventType:"visit",duration:60,eventOverrides:{rescheduled_from_event_id:"30000000-0000-4000-8000-000000000099"}});
  await page.getByRole("button",{name:"Editar",exact:true}).click();
  await expect(page.getByRole("combobox",{name:"Tipo da atividade",exact:true})).toHaveCount(0);
  await page.getByRole("textbox",{name:"Título da atividade"}).fill("Metadados da substituta");
  await page.getByRole("button",{name:"Salvar",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixtureWrites.at(-1).input.event_type),"visit");
  await show({mode:"sheet",eventType:"task",duration:60,eventOverrides:{rescheduled_from_event_id:"30000000-0000-4000-8000-000000000099"}});
  await page.getByRole("button",{name:"Editar",exact:true}).click();
  await expect(page.getByRole("combobox",{name:"Tipo da atividade",exact:true})).toHaveCount(0);
  await page.getByRole("textbox",{name:"Título da atividade"}).fill("Metadados da cadeia legada");
  await page.getByRole("button",{name:"Salvar",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixtureWrites.at(-1).input.event_type),"task");
  await show({mode:"sheet",eventType:"task",duration:60});
  await page.getByRole("button",{name:"Editar",exact:true}).click();
  await page.getByRole("combobox",{name:"Tipo da atividade",exact:true}).click();
  await page.getByRole("option",{name:"Visita ao imóvel",exact:true}).click();
  await page.getByRole("button",{name:"Salvar",exact:true}).click();
  const task=await page.evaluate(()=>window.fixtureWrites.at(-1).input);
  assert.equal(task.event_type,"visit");
  assert.equal(task.start_time,"2026-10-12T12:00:00.000Z");
  assert.equal(task.end_time,"2026-10-12T13:00:00.000Z");
  await show({mode:"sheet",eventType:"task",duration:60});
  await page.getByRole("button",{name:"Editar",exact:true}).click();
  await page.getByRole("textbox",{name:"Título da atividade"}).fill("Rascunho conservado");
  await page.getByRole("button",{name:"Horário de início: 09:00",exact:true}).click();
  await page.locator('input[type="time"][aria-label="Horário de início"]').fill("10:00");
  await page.keyboard.press("Escape");
  await page.getByRole("combobox",{name:"Tipo da atividade",exact:true}).click();
  await page.getByRole("option",{name:"Visita ao imóvel",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("salve primeiro a mudança de tipo mantendo o horário original");
  await expect(page.getByRole("button",{name:"Salvar",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Salvar",exact:true}).click({force:true});
  assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
  await expect(page.getByRole("textbox",{name:"Título da atividade"})).toHaveValue("Rascunho conservado");
  await expect(page.getByRole("button",{name:"Horário de início: 10:00",exact:true})).toBeVisible();
});

test("busy intervals stay neutral in calendar, full and compact lists, and the read-only sheet",async()=>{
  for(const [eventType,label] of Object.entries({call:"Ligação",email:"E-mail",meeting:"Reunião",task:"Tarefa",message:"Mensagem",visit:"Visita"})){
    await show({mode:"week",eventType,duration:60,eventOverrides:{title:"  "}});
    const card=page.locator('[data-calendar-event-density]').first();
    await expect(card).toBeVisible();
    assert.ok((await card.getAttribute("aria-label")).startsWith(label+". "));
  }
  const eventOverrides={is_masked:true,event_type:null,status:null,user_id:null,user:null,title:"Texto privado que não deve aparecer",start_time:"2026-10-12T10:00:00.000Z",end_time:"2026-10-12T11:00:00.000Z",reminder_minutes:null,created_at:null,updated_at:null,assignee_user_ids:[]};
  for(const mode of ["week","list","compact","sheet"]){
    await show({mode,eventOverrides,masked:true,canManage:false,initialState:{canManage:false}});
    await expect(page.getByText("Horário ocupado",{exact:true}).first()).toBeVisible();
    assert.equal(await page.getByText(/Em aberto|Atrasad[ao]|Tarefa|Ligação|Sem lembrete/).count(),0);
    assert.equal(await page.getByText("Texto privado que não deve aparecer",{exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
  }
  await page.evaluate(()=>localStorage.setItem("agendaViewMode","week"));
  for(const width of [360,390,768,1024,1440]){
    for(const eventCount of [1,51]){
      await show({mode:"agenda",eventOverrides,eventCount,initialState:{canManage:false}},width);
      await page.getByRole("button",{name:"Filtros da agenda",exact:true}).click();
      await page.getByRole("button",{name:"Tarefa",exact:true}).click();
      await page.keyboard.press("Escape");
      const cards=page.locator('[data-calendar-event-density]').filter({hasText:"Horário ocupado"});
      await expect(cards).toHaveCount(eventCount);
      await expect(cards.first()).toBeVisible();
      assert.ok(await cards.evaluateAll(elements=>elements.every(element=>{const bounds=element.getBoundingClientRect();return bounds.width>0&&bounds.height>0})),`positive occupied bounds at ${width}px with ${eventCount} events`);
      const week=page.locator('[data-calendar-week-scroll]');
      const scroll=await week.count()?week:page.locator('[data-radix-scroll-area-viewport]').first();
      await scroll.evaluate(element=>{element.scrollLeft=180;element.scrollTop=200});
      await expect(cards.first()).toBeInViewport();
      await cards.first().focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog",{name:"Detalhes da atividade",exact:true})).toBeVisible();
      await expect(page.getByRole("heading",{name:"Horário ocupado",exact:true})).toBeVisible();
      assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
    }
  }
});

test("all-day dragging across a DST gap keeps civil days while timed gap slots remain unavailable",async()=>{
  await show({mode:"week",calendarDate:[2026,2,8],calendarTimeZone:"America/New_York",eventOverrides:{start_time:"2026-03-10T04:00:00.000Z",end_time:"2026-03-13T04:00:00.000Z",is_all_day:true}});
  const week=page.locator('[data-calendar-week-scroll]');
  const gap=week.locator('[data-calendar-slot="2026-03-08|02:00"]');
  await expect(gap).toHaveAttribute("data-disabled","true");
  assert.equal(await week.locator('[data-calendar-event-resize-handle]').count(),0);
  const card=week.locator('[data-calendar-event-density]').first();
  const bounds=await card.boundingBox();
  const target=await gap.boundingBox();
  assert.ok(bounds&&target);
  await page.mouse.move(bounds.x+12,bounds.y+12);
  await page.mouse.down();
  await page.mouse.move(target.x+12,target.y+12,{steps:10});
  await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>window.fixtureWrites.length)).toBe(1);
  const moved=await page.evaluate(()=>window.fixtureWrites[0].input);
  assert.equal(moved.start_time,"2026-03-08T05:00:00.000Z");
  assert.equal(moved.end_time,"2026-03-11T04:00:00.000Z");
  assert.equal(moved.expected_updated_at,"2026-10-01T12:00:00.000Z");
  await show({mode:"week",calendarDate:[2026,2,8],calendarTimeZone:"America/New_York",eventOverrides:{start_time:"2026-03-10T06:00:00.000Z",end_time:"2026-03-10T06:20:00.000Z",is_all_day:false}});
  await expect(gap).toHaveAttribute("data-disabled","true");
  await gap.dispatchEvent("keydown",{key:"Enter"});
  await gap.click({force:true});
  assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
});
