import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const directory = await mkdtemp(path.join(tmpdir(), 'vimob-contacts-pagination-layout-'));
const proof = process.env.VIMOB_CONTACTS_PAGINATION_PROOF_DIR || null;
const playwright = pathToFileURL(require.resolve('@playwright/test')).href;
const { expect } = require('@playwright/test');
let harness = await readFile(path.join(repository, 'scripts/tests/contacts-sidebar-runtime/harness.mjs'), 'utf8');
harness = harness
  .replace("import { chromium, expect } from '@playwright/test';", () => 'import playwright from ' + JSON.stringify(playwright) + ';const{chromium,expect}=playwright;')
  .replace('createRequire(import.meta.url)', () => 'createRequire(' + JSON.stringify(path.join(repository, 'package.json')) + ')')
  .replace("path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')", () => JSON.stringify(repository))
  .replaceAll('tmpdir()', JSON.stringify(directory))
  .replace("'components/features/contacts/contacts-screen/ContactsToolbar.tsx'", "'components/features/contacts','components/features/leads/ReentryBadge.tsx'");
let fixture = await readFile(path.join(repository, 'scripts/tests/contacts-sidebar-runtime/fixture.mjs'), 'utf8');
fixture = fixture
  .replace("import { useIsMobile }", "import { ContactsList } from '@/components/features/contacts/contacts-screen/ContactsList';\nimport { ContactsPagination } from '@/components/features/contacts/contacts-screen/ContactsPagination';\nimport { useIsMobile }")
  .replace('  const isMobile = useIsMobile();', [
    '  const isMobile = useIsMobile();',
    '  const [currentPage,setPage]=useState(2),[pageSize,setPageSize]=useState(50),[showLauncher,setShowLauncher]=useState(!config.noChat),[showList,setShowList]=useState(true);',
    '  window.paginationPage=currentPage;window.paginationSetPage=setPage;window.paginationShowLauncher=setShowLauncher;window.paginationShowList=setShowList;',
    "  const contacts=Array.from({length:5},(_,i)=>({id:id(101+i),name:'Contato Sintético '+i,phone:'+5511999999999',email:'contato@example.invalid',created_at:'2026-10-01T10:00:00Z',stage_name:'Atendimento',pipeline_name:'Pipeline sintética',source:'manual',deal_status:'open',reentry_count:0,assignee_name:'Responsável Sintético',tags:[]}));",
  ].join('\n'))
  .replace("style={{minHeight:'100dvh',padding:12}}", "style={{height:'calc(100dvh - 64px)',minHeight:0,marginTop:64,marginLeft:isMobile?0:208,width:isMobile?'100%':'calc(100% - 208px)',padding:isMobile?'8px 20px 65px':'12px 24px 12px',display:'flex',flexDirection:'column',gap:12}}")
  .replace("<button type='button' data-background-before>Região anterior</button>", "<button type='button' data-background-before style={{position:'absolute',height:0,padding:0,overflow:'hidden'}}>Região anterior</button>")
  .replace("<button type='button' data-background-after>Região posterior</button>", [
    "{showList&&<ContactsList isMobile={isMobile} contacts={contacts} isLoading={false} isTransitioning={false} showRefreshError={false} showErrorState={false} errorMessage='' isFetching={false} hasActiveFilters={false} canCreateLeads canImportLeads canDeleteLeads canUseWhatsApp={false} lostLeadsView={false} selectedIds={new Set()} sortBy='created_at' sortDir='desc' onRetry={()=>{}} onClearFilters={()=>{}} onCreate={()=>{}} onImport={()=>{}} onToggleLostLeadsView={()=>{}} onViewDetails={()=>{}} onWhatsApp={()=>{throw Error('No WhatsApp row action');}} onRequestDelete={()=>{}} onToggleSelectAll={()=>{}} onToggleSelectOne={()=>{}} onSort={()=>{}} footer={<ContactsPagination page={currentPage} pageSize={pageSize} totalCount={7705} totalPages={155} onPageChange={setPage} onPageSizeChange={setPageSize}/>}/> }",
    "<button type='button' data-background-after style={{position:'absolute',height:0,padding:0,overflow:'hidden'}}>Região posterior</button>",
  ].join('\n'))
  .replace('<FloatingChatButton/>', '{showLauncher&&<FloatingChatButton/>}');
assert.ok(fixture.includes('window.paginationPage=currentPage'), 'fixture exposes synthetic pagination state');
await writeFile(path.join(directory, 'fixture.mjs'), fixture);
await writeFile(path.join(directory, 'harness.mjs'), harness);
const ui = await import(pathToFileURL(path.join(directory, 'harness.mjs')).href);
after(async () => {
  const target = path.resolve(directory);
  assert.equal(path.dirname(target), path.resolve(tmpdir()));
  assert.match(path.basename(target), /^vimob-contacts-pagination-layout-/);
  await rm(target, { recursive: true, force: true });
});
const launcher = () => ui.page.locator('button[aria-controls="floating-whatsapp-chat"]');
const footer = () => ui.page.locator('[data-contacts-pagination]');
async function dragLeft() {
  const box = await launcher().boundingBox();
  await ui.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await ui.page.mouse.down();
  await ui.page.mouse.move(36, box.y + box.height / 2, { steps: 6 });
  await ui.page.mouse.up();
  await expect.poll(() => launcher().evaluate(n => n.getBoundingClientRect().x)).toBe(24);
}
async function assertClear() {
  await expect.poll(() => ui.page.locator('[data-contacts-pagination] button,[data-contacts-pagination] input').evaluateAll(nodes => {
    const launcher = document.querySelector('[data-filter-panel-launcher]:not([aria-hidden="true"]) button');
    if (!launcher) return [];
    const a = launcher.getBoundingClientRect();
    return nodes.filter(n => {
      const b = n.getBoundingClientRect();
      return Math.min(a.right,b.right)-Math.max(a.left,b.left)>0.5 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>0.5;
    }).map(n => n.getAttribute('aria-label'));
  })).toEqual([]);
  assert.equal(await ui.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no document overflow');
  const fit = await footer().evaluate(n => {
    const area = n.getBoundingClientRect();
    return [...n.querySelectorAll('button,input')].every(el => {
      const box = el.getBoundingClientRect();
      return box.x >= area.x - 1 && box.right <= area.right + 1;
    });
  });
  assert.equal(fit, true, 'every pagination control fits its contact card');
}
for (const width of [320,390,768,1024,1440]) {
  for (const side of ['right','left']) {
    test('pagination click remains available at ' + width + ' on launcher ' + side, async () => {
      await ui.show({ width, height:740 });
      if (side === 'left') await dragLeft();
      await assertClear();
      for (const [label, expected] of [['Ir para a primeira página',1],['Ir para a última página',155]]) {
        const control = ui.page.getByRole('button', { name:label, exact:true });
        const box = await control.boundingBox();
        await ui.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect.poll(() => ui.page.evaluate(() => window.paginationPage)).toBe(expected);
        assert.equal(await ui.page.evaluate(() => window.sidebarChat.state.isOpen), false, 'a pagination click never opens chat');
      }
      if (proof) {
        await mkdir(proof, { recursive:true });
        await ui.page.screenshot({ path:path.join(proof, 'pagination-' + width + '-' + side + '.png') });
      }
    });
  }
}
test('contact pagination preserves the input draft and focus during resize and side changes', async () => {
  await ui.show({ width:390, height:740 });
  const input = ui.page.getByRole('textbox', { name:'Número da página', exact:true });
  await input.fill('12');
  await input.evaluate(n => { window.paginationOriginalInput=n; n.setSelectionRange(1,1); });
  for (const width of [1024,320,1440,390]) {
    await ui.page.setViewportSize({ width, height:740 });
    await assertClear();
    await expect(input).toHaveValue('12');
    assert.equal(await input.evaluate(n => n === window.paginationOriginalInput), true);
  }
  await input.focus();
  await ui.page.keyboard.press('Enter');
  await expect.poll(() => ui.page.evaluate(() => window.paginationPage)).toBe(12);
  await expect(input).toBeFocused();
});
test('pagination handles absent, late, hidden and removed launchers without observer loops', async () => {
  await ui.show({ width:320, height:740, noChat:true });
  await assertClear();
  await ui.page.evaluate(() => window.paginationShowLauncher(true));
  await expect(launcher()).toBeVisible();
  await dragLeft();
  await assertClear();
  await ui.page.evaluate(() => window.sidebarChat.openChat());
  await expect(launcher()).toHaveAttribute('tabindex','-1');
  await assertClear();
  await ui.page.evaluate(() => window.sidebarChat.closeChat());
  await expect(launcher()).toHaveAttribute('tabindex','0').catch(async () => { await expect(launcher()).not.toHaveAttribute('tabindex','-1'); });
  await assertClear();
  await ui.page.evaluate(() => window.paginationShowLauncher(false));
  await expect(launcher()).toHaveCount(0);
  await assertClear();
  const changes = await footer().evaluate(async n => {
    let changes=0;
    const observer=new MutationObserver(records => { changes+=records.length; });
    observer.observe(n, { subtree:true, attributes:true, attributeFilter:['style'] });
    for(let index=0;index<12;index++) await new Promise(requestAnimationFrame);
    observer.disconnect();
    return changes;
  });
  assert.equal(changes,0,'a settled footer does not keep writing layout styles');
});
test('pagination respects safe areas on both sides with its existing control sizes', async () => {
  const cdp = await ui.page.context().newCDPSession(ui.page);
  try {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets:{ top:24,left:30,right:30,bottom:34 } });
    for(const width of [320,390]) for(const side of ['right','left']) {
      await ui.show({ width, height:740 });
      if(side==='left') await dragLeft();
      await assertClear();
      const sizes = await footer().locator('button[aria-label^="Ir para"]').evaluateAll(nodes => nodes.map(n => {
        const box=n.getBoundingClientRect();return { width:box.width,height:box.height };
      }));
      assert.ok(sizes.every(size => size.width===32 && size.height===32),'approved controls remain 32px');
    }
  } finally {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets:{} });
    await cdp.detach();
  }
});
test('pagination remains usable after the filter sidebar docks and restores either launcher side', async () => {
  for(const width of [390,1024]) {
    await ui.show({width,height:740});
    await dragLeft();
    await ui.page.emulateMedia({reducedMotion:'no-preference'});
    await ui.open();
    await expect(ui.sidebar()).toBeVisible();
    await ui.sidebar().getByRole('button',{name:'Buscar',exact:true}).click();
    await expect(ui.sidebar()).toHaveCount(0);
    await assertClear();
    const input=ui.page.getByRole('textbox',{name:'Número da página',exact:true});
    await input.fill('7');
    await input.press('Enter');
    await expect.poll(()=>ui.page.evaluate(()=>window.paginationPage)).toBe(7);
  }
});
test('unmount cancels pending contact pagination layout work', async () => {
  await ui.show({width:390,height:740});
  await ui.page.evaluate(()=>{
    window.retiredPagination=document.querySelector('.contacts-pagination');
    window.dispatchEvent(new Event('resize'));
    window.paginationShowList(false);
  });
  await expect(footer()).toHaveCount(0);
  const changes=await ui.page.evaluate(async()=>{
    let changes=0;
    const observer=new MutationObserver(records=>{changes+=records.length;});
    observer.observe(window.retiredPagination,{attributes:true,attributeFilter:['style']});
    for(let index=0;index<12;index++)await new Promise(requestAnimationFrame);
    observer.disconnect();
    return changes;
  });
  assert.equal(changes,0,'no queued layout writes reach an unmounted contact footer');
});

test('pagination regression transport is offline and has no browser errors', () => {
  assert.deepEqual(ui.errors,[]);
  assert.deepEqual(ui.externalRequests,[]);
});
