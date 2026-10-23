import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Real ContactCard, Radix, React and product CSS; the existing offline harness
// blocks all outbound requests. Text-only enlargement is explicit CSS, not a
// claim about OS/browser text scaling or a substitute for device homologation.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const directory = await mkdtemp(path.join(tmpdir(), 'vimob-contact-card-layout-'));
const proof = process.env.VIMOB_CONTACT_CARD_PROOF_DIR || null;
const { expect } = require('@playwright/test');
let harness = await readFile(path.join(repository, 'scripts/tests/contacts-sidebar-runtime/harness.mjs'), 'utf8');
harness = harness
  .replace("import { chromium, expect } from '@playwright/test';", () => 'import playwright from ' + JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href) + ';const{chromium,expect}=playwright;')
  .replace('createRequire(import.meta.url)', () => 'createRequire(' + JSON.stringify(path.join(repository, 'package.json')) + ')')
  .replace("path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')", () => JSON.stringify(repository))
  .replaceAll('tmpdir()', JSON.stringify(directory))
  .replace("'components/features/contacts/contacts-screen/ContactsToolbar.tsx'", "'components/features/contacts/ContactCard.tsx','components/features/leads/ReentryBadge.tsx','components/features/contacts/contacts-screen/ContactsToolbar.tsx'");
let fixture = await readFile(path.join(repository, 'scripts/tests/contacts-sidebar-runtime/fixture.mjs'), 'utf8');
fixture = fixture
  .replace("import { useIsMobile }", "import { ContactCard } from '@/components/features/contacts/ContactCard';\nimport { useIsMobile }")
  .replace('  const isMobile = useIsMobile();', [
    '  const isMobile = useIsMobile();',
    '  const [selected,setSelected]=useState(false);',
    "  const contact={id:id(101),name:'Contato Sintético',phone:'+5511999999999',email:'contato@example.invalid',created_at:'2026-10-01T10:00:00Z',stage_name:'Atendimento',pipeline_name:'Pipeline sintética',source:'manual',deal_status:'open',reentry_count:0,assignee_name:config.assigned===false?null:'Responsável Sintético',tags:[]};",
    '  window.cardSelection=selected;window.cardDetails??=0;window.cardWhatsApp??=0;window.cardDeletes??=0;',
  ].join('\n'))
  .replace("style={{minHeight:'100dvh',padding:12}}", "style={{minHeight:'100dvh',padding:20}}")
  .replace("<button type='button' data-background-after>Região posterior</button>", "<section data-card-fixture><ContactCard contact={contact} sourceLabels={{manual:'Manual'}} selected={selected} onSelect={config.selectable===false?undefined:()=>setSelected(value=>!value)} onViewDetails={()=>window.cardDetails++} onWhatsApp={()=>window.cardWhatsApp++} onDelete={()=>window.cardDeletes++}/></section>");
assert.ok(fixture.includes('data-card-fixture'), 'fixture mounts the real contact card');
await writeFile(path.join(directory, 'fixture.mjs'), fixture);
await writeFile(path.join(directory, 'harness.mjs'), harness);
const ui = await import(pathToFileURL(path.join(directory, 'harness.mjs')).href);
after(async () => {
  const target = path.resolve(directory);
  assert.equal(path.dirname(target), path.resolve(tmpdir()));
  assert.match(path.basename(target), /^vimob-contact-card-layout-/);
  await rm(target, { recursive:true, force:true });
});

const card = () => ui.page.locator('[data-card-fixture] [role="article"]');
async function measure() {
  return card().evaluate(article => {
    const time = article.querySelector('time'), right = time.parentElement, row = right.parentElement, left = row.firstElementChild;
    const bounds = n => { const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
    const a=bounds(left), b=bounds(right), content=[...left.children].map(bounds);
    const x=Math.max(0,Math.max(...content.map(r=>r.right))-b.x);
    const y=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y));
    return {a,b,row:bounds(row),card:bounds(article),font:parseFloat(getComputedStyle(left.firstElementChild).fontSize),
      avatar:bounds(left.querySelector('[role="img"]')),collision:x>0.5&&y>0.5,
      contentsFit:[left,...left.children,right,time].every(n=>n.scrollWidth<=n.clientWidth+1),documentOverflow:document.documentElement.scrollWidth>innerWidth};
  });
}
async function doubleText() {
  await card().evaluate(article => {
    const original=[...article.querySelectorAll(':not(svg):not(path)')].map(n=>{
      const s=getComputedStyle(n);return {n,font:parseFloat(s.fontSize),line:parseFloat(s.lineHeight)};
    });
    // Capture all values first so inherited sizes are doubled exactly once.
    for(const {n,font,line} of original){if(font)n.style.fontSize=font*2+'px';if(line)n.style.lineHeight=line*2+'px';}
  });
  await ui.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function save(name) {
  if(proof){await mkdir(proof,{recursive:true});await ui.page.screenshot({path:path.join(proof,name+'.png'),fullPage:true});}
}
async function assertReadable() {
  const actual=await measure();
  assert.equal(actual.collision,false,'responsible content and created date must not intersect');
  assert.equal(actual.contentsFit,true,'metadata text remains visible without clipping');
  assert.equal(actual.documentOverflow,false,'no horizontal document overflow');
  for(const box of [actual.a,actual.b]){
    assert.ok(box.x>=actual.card.x-1&&box.right<=actual.card.right+1,'metadata stays inside the card');
    assert.ok(box.y>=actual.row.y-1&&box.bottom<=actual.row.bottom+1,'metadata stays inside its row');
  }
  return actual;
}

for(const width of [320,390,500]) {
  test('card preserves approved sizes and side-by-side metadata at '+width,async()=>{
    await ui.show({width,height:740});
    const actual=await assertReadable();
    assert.equal(actual.font,10);assert.equal(actual.avatar.width,28);assert.equal(actual.avatar.height,28);
    assert.ok(Math.abs((actual.a.y+actual.a.height/2)-(actual.b.y+actual.b.height/2))<=1,'same baseline at normal text size');
    assert.ok(Math.abs(actual.b.right-(actual.card.right-8))<=1,'created date remains right-aligned');
    await save('normal-'+width);
  });
  for(const assigned of [true,false]) test('200 percent text keeps card metadata readable at '+width+' assigned='+assigned,async()=>{
    await ui.show({width,height:740,assigned});await doubleText();
    const actual=await assertReadable();
    assert.equal(actual.font,20,'the probe really enlarges text to 200 percent');
    assert.equal(actual.avatar.width,28);assert.equal(actual.avatar.height,28);
    await save('text-200-'+width+'-'+assigned);
  });
}
test('200 percent text remains readable without selection and preserves focus across resize',async()=>{
  await ui.show({width:320,height:740,selectable:false});await doubleText();await assertReadable();
  const avatar=card().getByRole('img',{name:'Responsável: Responsável Sintético'});
  await avatar.focus();await expect(avatar).toBeFocused();
  for(const width of [390,320,500]){await ui.page.setViewportSize({width,height:740});await assertReadable();await expect(avatar).toBeFocused();}
});
test('wrapping metadata preserves selection and details actions without outbound requests',async()=>{
  await ui.show({width:320,height:740});await doubleText();await assertReadable();
  await ui.page.evaluate(()=>{window.cardDetails=0;});
  await card().getByRole('checkbox',{name:'Selecionar Contato Sintético'}).check();
  await expect.poll(()=>ui.page.evaluate(()=>window.cardSelection)).toBe(true);
  assert.equal(await ui.page.evaluate(()=>window.cardDetails),0,'selection does not open contact details');
  await card().getByRole('button',{name:'Contato Sintético',exact:true}).click();
  assert.equal(await ui.page.evaluate(()=>window.cardDetails),1);
  assert.deepEqual(ui.externalRequests,[]);assert.deepEqual(ui.errors,[]);
});

for(const activation of ['mouse','Enter','Space']) {
  test('details menu calls once and restores focus via '+activation+' at normal and 200 percent text',async()=>{
    for(const enlarged of [false,true]) {
      await ui.show({width:320,height:740});
      if(enlarged)await doubleText();
      await ui.page.evaluate(()=>{window.cardDetails=0;window.cardWhatsApp=0;window.cardDeletes=0;});
      const trigger=card().getByRole('button',{name:'Ações de Contato Sintético'});
      if(activation==='mouse')await trigger.click();
      else{await trigger.focus();await ui.page.keyboard.press(activation);}
      const details=ui.page.getByRole('menuitem',{name:'Ver detalhes',exact:true});
      await expect(details).toBeVisible();
      if(activation==='mouse')await details.click();
      else{await details.focus();await ui.page.keyboard.press(activation);}
      await expect(ui.page.getByRole('menu')).toHaveCount(0);
      await expect(trigger).toBeFocused();
      assert.equal(await ui.page.evaluate(()=>window.cardDetails),1,'one intention must invoke the callback once, without relying on batched state');
      assert.equal(await ui.page.evaluate(()=>window.cardWhatsApp),0);
      assert.equal(await ui.page.evaluate(()=>window.cardDeletes),0);
      const actual=await assertReadable();
      assert.equal(actual.font,enlarged?20:10);
      assert.equal(actual.avatar.width,28);assert.equal(actual.avatar.height,28);
      await save('details-'+activation+'-'+(enlarged?'text-200':'normal'));
    }
    assert.deepEqual(ui.externalRequests,[]);assert.deepEqual(ui.errors,[]);
  });
}

test('card, name, selection and neighboring menu callbacks remain independent at normal and 200 percent text',async()=>{
  for(const enlarged of [false,true]) {
    await ui.show({width:320,height:740});
    if(enlarged)await doubleText();
    await ui.page.evaluate(()=>{window.cardDetails=0;window.cardWhatsApp=0;window.cardDeletes=0;});
    const selection=card().getByRole('checkbox',{name:'Selecionar Contato Sintético'});
    await selection.focus();await ui.page.keyboard.press('Space');
    await expect(selection).toBeChecked();
    assert.equal(await ui.page.evaluate(()=>window.cardDetails),0,'selection does not bubble to the card');
    await card().getByRole('button',{name:'Contato Sintético',exact:true}).click();
    assert.equal(await ui.page.evaluate(()=>window.cardDetails),1,'name click remains one intent');
    await card().click({position:{x:4,y:4}});
    assert.equal(await ui.page.evaluate(()=>window.cardDetails),2,'card padding remains a separate intent');
    await ui.page.evaluate(()=>{window.cardDetails=0;});
    const trigger=card().getByRole('button',{name:'Ações de Contato Sintético'});
    await trigger.click();await ui.page.getByRole('menuitem',{name:'WhatsApp',exact:true}).click();
    await expect(ui.page.getByRole('menu')).toHaveCount(0);await expect(trigger).toBeFocused();
    assert.equal(await ui.page.evaluate(()=>window.cardWhatsApp),1);
    assert.equal(await ui.page.evaluate(()=>window.cardDetails),0,'WhatsApp does not bubble to details');
    await trigger.click();await ui.page.getByRole('menuitem',{name:'Excluir contato',exact:true}).click();
    await expect(ui.page.getByRole('menu')).toHaveCount(0);await expect(trigger).toBeFocused();
    assert.equal(await ui.page.evaluate(()=>window.cardDeletes),1);
    assert.equal(await ui.page.evaluate(()=>window.cardWhatsApp),1);
    assert.equal(await ui.page.evaluate(()=>window.cardDetails),0,'delete does not bubble to details');
    await expect(selection).toBeChecked();await assertReadable();
  }
  assert.deepEqual(ui.externalRequests,[]);assert.deepEqual(ui.errors,[]);
});
