// Browser matrix for login routing and access resilience. See README.md.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createRunnerLifecycle } from './runner-lifecycle.mjs';

const F = 'http://127.0.0.1:54400';
const APP = process.env.AUTH_SCENARIOS_URL || 'http://127.0.0.1:3199';
const require = createRequire(import.meta.url);
const lifecycle = createRunnerLifecycle({ cwd: fileURLToPath(new URL('../../', import.meta.url)) });

const ctl=o=>fetch(F+'/__control',{method:'POST',body:o?JSON.stringify(o):undefined}).then(r=>r.json());
const results=[];
async function login(p,email,start='/login',pw='Senha!12345'){await p.goto(APP+start,{waitUntil:'domcontentloaded',timeout:120000});await p.waitForFunction(()=>{const i=document.querySelector('input[name="email"]');return i&&Object.keys(i).some(k=>k.startsWith('__reactProps'))},null,{timeout:90000});await p.waitForTimeout(300);await p.locator('input[name="email"]').fill(email);await p.locator('input[name="password"]').fill(pw);await p.getByRole('button',{name:/^Acessar o CRM$/}).click();}
const until=(p,re,t=60000)=>p.waitForURL(re,{timeout:t,waitUntil:'commit'});
async function sc(browser,name,fn){await ctl({reset:true});const ctx=await browser.newContext();const p=await ctx.newPage();const t=Date.now();let ok=true,info='';try{await fn(p,ctx);}catch(e){ok=false;info=String(e.message).split('\n')[0].slice(0,140);}let url='';try{url=new URL(p.url()).pathname+new URL(p.url()).search}catch{}
 const cc=await ctl();results.push({name,ok,url,info});info+=' [global='+cc.logoutGlobal+' local='+cc.logoutLocal+']';console.log((ok?'PASS':'FAIL'),name,'→',url,info,`(${Math.round((Date.now()-t)/1000)}s)`);await ctx.close();}
const focus=async p=>{await p.clock.fastForward(36000);await p.evaluate(()=>window.dispatchEvent(new Event('focus'))).catch(()=>{});await p.waitForTimeout(2500)};
const stay=async(p,re)=>{await p.waitForTimeout(1500);if(!re.test(new URL(p.url()).pathname+new URL(p.url()).search))throw new Error('saiu da página: '+p.url())};
(async()=>{
let browser;
const unwatch = lifecycle.watchSignals(() => browser);
try {
const backend = lifecycle.startNode('Fake backend', [fileURLToPath(new URL('./fake-backend.mjs', import.meta.url))], {}, 'fake up');
await lifecycle.waitFor(F + '/__control', backend);
let next;
if (!process.env.AUTH_SCENARIOS_URL) {
  next = lifecycle.startNode('Next dev', [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3199'], {
    NEXT_DIST_DIR: '.next-auth-scenarios',
    NEXT_PUBLIC_SUPABASE_URL: F,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    NEXT_PUBLIC_VIMOB_API_URL: F,
    VIMOB_API_URL: F,
    NEXT_PUBLIC_SITE_URL: APP,
    NEXT_PUBLIC_APP_URL: APP,
    NEXT_PUBLIC_DISABLE_ERROR_TELEMETRY: 'true',
    NEXT_TELEMETRY_DISABLED: '1',
  }, 'Ready in');
}
await lifecycle.waitFor(APP + '/login', next);
browser=await chromium.launch(process.env.AUTH_SCENARIOS_CHROMIUM?{executablePath:process.env.AUTH_SCENARIOS_CHROMIUM}:{});
const only=process.argv[2]?new RegExp(process.argv[2]):null; const S=(n,f)=>only&&!only.test(n)?null:sc(browser,n,f);
await S('01 uma org → /inicio',async p=>{await login(p,'one@t.test');await until(p,/\/inicio/)});
await S('02 volta com query',async p=>{await p.goto(APP+'/settings?tab=x',{timeout:120000});await until(p,/\/login\?redirectTo/);await login(p,'one@t.test','/login?redirectTo=%2Fsettings%3Ftab%3Dx');await until(p,/\/settings\?tab=x/)});
await S('03 várias orgs → seleção',async p=>{await login(p,'many@t.test');await until(p,/\/select-organization/)});
await S('05 sem org → seleção vazia',async p=>{await login(p,'none@t.test');await until(p,/\/select-organization/);await p.getByText('não está cadastrado').waitFor({timeout:20000})});
await S('06 superadmin sem org → /admin',async p=>{await login(p,'sa0@t.test');await until(p,/\/(admin|inicio)/);await p.waitForTimeout(800);if(!/\/admin/.test(p.url()))throw new Error('foi para '+p.url())});
await S('06b superadmin com org → /admin',async p=>{await login(p,'sa1@t.test');await until(p,/\/admin/,30000)});
await S('07 superadmin /admin/users',async p=>{await login(p,'sa0@t.test','/login?redirectTo=%2Fadmin%2Fusers');await until(p,/\/admin\/users/)});
await S('08 superadmin logado abre /login → /admin',async p=>{await login(p,'sa0@t.test');await until(p,/\/(admin|inicio)/);await p.goto(APP+'/login',{timeout:120000});await until(p,/\/admin/,40000)});
await S('04 várias orgs mantém a escolhida ao recarregar',async p=>{await login(p,'many@t.test');await until(p,/\/select-organization/);await p.getByText('Org B').click();await until(p,/\/inicio/);await p.waitForTimeout(1000);await p.reload({waitUntil:'commit'});await p.waitForTimeout(3000);if(!/\/inicio/.test(p.url()))throw new Error('saiu: '+p.url());const v=await p.evaluate(()=>Object.entries(localStorage).find(([k])=>k.startsWith('vimob_active_organization'))?.[1]);if(v!=='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')throw new Error('org '+v)});
await S('09 superadmin impersonando usa o /inicio',async p=>{await login(p,'sa1@t.test');await until(p,/\/admin/);await p.evaluate(()=>localStorage.setItem('impersonating',JSON.stringify({orgId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',orgName:'Org A'})));await p.goto(APP+'/inicio',{waitUntil:'commit'});await p.waitForTimeout(4000);if(!/\/inicio/.test(p.url()))throw new Error('redirecionou: '+p.url())});
await S('09b superadmin com org abre o /inicio dela',async p=>{await login(p,'sa1@t.test');await until(p,/\/admin/);await p.goto(APP+'/inicio',{waitUntil:'commit'});await p.waitForTimeout(4000);if(!/\/inicio/.test(p.url()))throw new Error('redirecionou: '+p.url())});
await S('10 comum em /admin bloqueado',async p=>{await login(p,'one@t.test','/login?redirectTo=%2Fadmin');await until(p,/\/admin/);await p.getByText('Painel exclusivo').waitFor({timeout:30000})});
await S('12 redirect externo ignorado',async p=>{await login(p,'one@t.test','/login?redirectTo=https%3A%2F%2Fsite-externo.test');await until(p,/\/inicio/)});
await S('13 API fora ao focar fica na página',async p=>{await p.clock.install();await login(p,'one@t.test','/login?redirectTo=%2Fsettings%3Ftab%3Dx');await until(p,/\/settings/);await p.getByRole('main').first().waitFor({timeout:40000}).catch(()=>{});await ctl({api:'down'});await focus(p);await stay(p,/^\/settings/);await p.getByText(/validar seu acesso|conexão/i).first().waitFor({timeout:8000})});
await S('14 401 com Auth válido não desloga',async p=>{await p.clock.install();await login(p,'one@t.test','/login?redirectTo=%2Fsettings');await until(p,/\/settings/);await p.waitForTimeout(2000);await ctl({api:'401'});await focus(p);await stay(p,/^\/settings/);const c=await ctl();if(c.logoutGlobal)throw new Error('logout global '+c.logoutGlobal)});
await S('15 sessão revogada vai ao login, sem global',async p=>{await p.clock.install();await login(p,'one@t.test','/login?redirectTo=%2Fsettings');await until(p,/\/settings/);await p.waitForTimeout(2000);await ctl({api:'401',auth:'revoked'});await focus(p);await until(p,/\/login/,20000).catch(async()=>{await p.clock.fastForward(5000);await until(p,/\/login/,20000)});const c=await ctl();if(c.logoutGlobal)throw new Error('logout global '+c.logoutGlobal)});
await S('14b org removida perde acesso e guarda query',async p=>{await p.clock.install();await login(p,'one@t.test','/login?redirectTo=%2Fsettings%3Ftab%3Dx');await until(p,/\/settings/);await p.waitForTimeout(2000);await ctl({removed:true});await focus(p);await until(p,/\/select-organization/,20000);if(!/redirectTo=%2Fsettings%3Ftab%3D/.test(p.url()))throw new Error('perdeu destino: '+p.url())});
await S('16 suspenso recarrega é desconectado',async p=>{await login(p,'one@t.test');await until(p,/\/inicio/);await p.waitForTimeout(2000);await ctl({suspended:true});await p.reload({timeout:120000,waitUntil:'commit'});await p.waitForTimeout(6000);const c=await ctl();if(!c.logoutGlobal)throw new Error('sem logout; url='+p.url())});
await S('M4 impersonating corrompido não derruba',async p=>{await p.addInitScript(()=>localStorage.setItem('impersonating','{corrompido'));await p.goto(APP+'/login',{timeout:120000});await p.locator('input[name="email"]').waitFor({timeout:30000});await p.locator('input[name="email"]').fill('a@b.c');const v=await p.locator('input[name="email"]').inputValue();await p.waitForTimeout(1500);const err=await p.getByText(/Application error|client-side exception/i).count();if(err||v!=='a@b.c')throw new Error('app caiu')});
await S('M6 acesso lento conclui depois do aviso',async p=>{await p.goto(APP+'/login',{waitUntil:'domcontentloaded'});await p.waitForTimeout(16000);await ctl({slowMs:9000,slowLeft:2});await p.locator('input[name="email"]').fill('one@t.test');await p.locator('input[name="password"]').fill('Senha!12345');await p.getByRole('button',{name:/^Acessar o CRM$/}).click();await p.getByText('O acesso demorou mais que o esperado').waitFor({timeout:20000});await until(p,/\/inicio/,30000)});
await S('M7 serviço fora tem mensagem própria',async p=>{await ctl({login:503});await login(p,'one@t.test');await p.getByText(/Não foi possível conectar ao serviço/).waitFor({timeout:30000})});
await S('M7 429 tem mensagem própria',async p=>{await ctl({login:429});await login(p,'one@t.test');await p.getByText(/Muitas tentativas/).waitFor({timeout:15000})});
await S('M7 senha errada segue neutra',async p=>{await login(p,'one@t.test','/login','errada');await p.getByText('Não foi possível entrar. Confira seus dados').waitFor({timeout:15000})});
const f=results.filter(r=>!r.ok);console.log(`\n${results.length-f.length}/${results.length} ok`);process.exitCode ||= f.length?1:0;
} finally {
  unwatch();
  await lifecycle.cleanup(browser);
}
})().catch((error) => { console.error(error.message); process.exitCode ||= 1; });
