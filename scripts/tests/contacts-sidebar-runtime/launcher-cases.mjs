import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expect } from '@playwright/test';
import { bounds, errors, externalRequests, open, page, save, search, show, sidebar, state, trigger } from './harness.mjs';

const launcher=()=>page.getByRole('button',{name:/Abrir chat do WhatsApp/});
async function dragLeft(){
  const box=await bounds(launcher());await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();await page.mouse.move(36,box.y+box.height/2,{steps:6});await page.mouse.up();
  await expect.poll(()=>launcher().evaluate(n=>n.getBoundingClientRect().x)).toBe(24);
  assert.equal(await page.evaluate(()=>window.sidebarChat.state.isOpen),false,'drag does not open chat');
}
async function assertWrapperTabLoop(first,last){
  await last.focus();await page.keyboard.press('Tab');
  try{await expect(first).toBeFocused({timeout:1000});}
  catch{await save('wrapper-tab-focus-failure');assert.fail('Tab failed to wrap to the first control: '+await page.evaluate(()=>document.activeElement?.outerHTML));}
  await first.focus();await page.keyboard.press('Shift+Tab');
  try{await expect(last).toBeFocused({timeout:1000});}
  catch{await save('wrapper-shift-tab-focus-failure');assert.fail('Shift+Tab failed to wrap to the last control: '+await page.evaluate(()=>document.activeElement?.outerHTML));}
}
for(const width of [320,390,1024,1440])test(`launcher avoids sidebar controls and restores its previous side at ${width}`,async()=>{
  await show({width,height:740});
  for(const preferredSide of ['right','left']){
    if(preferredSide==='left')await dragLeft();
    const previous=await bounds(launcher());await open();
    await expect(launcher()).toHaveCount(1);
    const button=await bounds(launcher()),panel=await bounds(sidebar());
    assert.equal(button.width,56,'launcher retains its original width');
    assert.equal(button.height,56,'launcher retains its original height');
    assert.ok(await launcher().evaluate(n=>{const radius=getComputedStyle(n).borderRadius;return radius.endsWith('%')?parseFloat(radius)>=50:parseFloat(radius)>=28;}),'launcher remains circular inside or outside the Sheet');
    if(width<768){
      assert.equal(await launcher().evaluate(n=>Boolean(n.closest('[data-filter-sidebar="footer"]'))),true,'mobile launcher is a real child of the modal footer');
      const footer=await bounds(sidebar().locator('[data-filter-sidebar="footer"]'));
      assert.ok(button.x>=footer.x&&button.y>=footer.y&&button.y+button.height<=footer.y+footer.height+1,'launcher fits the footer');
      for(const label of ['Limpar filtros','Buscar']){
        const action=await bounds(sidebar().getByRole('button',{name:label,exact:true}));
        assert.ok(button.x+button.width<=action.x||action.x+action.width<=button.x||button.y+button.height<=action.y||action.y+action.height<=button.y,'launcher never overlaps '+label);
      }
    }else assert.ok(button.x+button.width<=panel.x,'desktop launcher stays to the left of the panel');
    await save(`launcher-${width}-${preferredSide}`);
    await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();await expect(sidebar()).toHaveCount(0);
    const restored=await bounds(launcher());assert.equal(restored.x,previous.x,'the stored drag side survives opening/closing');
  }
});

test('launcher respects invalid-search refusal before requesting chat and commits valid search once',async()=>{
  await show({width:390,height:740});await open();await search().fill('x'.repeat(181));
  await launcher().tap();await expect(sidebar()).toBeVisible();await expect(search()).toBeFocused();
  assert.equal(await page.evaluate(()=>window.sidebarChat.state.isOpen),false);
  assert.equal((await state()).searchQuery,'');
  await search().fill('Busca antes do chat');await launcher().tap();
  await expect(sidebar()).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>window.sidebarChat.state.isOpen)).toBe(true);
  assert.equal((await state()).searchQuery,'Busca antes do chat');
  await page.evaluate(()=>window.sidebarChat.closeChat());await expect(launcher()).toBeFocused();
});

test('unmounting the open filter owner restores the launcher and leaves no orphan dock or isolation',async()=>{
  await show({width:320,height:568});await open();
  await page.evaluate(()=>window.sidebarSetMounted(false));
  await expect(sidebar()).toHaveCount(0);await expect(page.locator('[data-filter-launcher-slot]')).toHaveCount(0);
  await expect(launcher()).toBeVisible();
  assert.equal(await launcher().evaluate(n=>Boolean(n.closest('[data-filter-sidebar]'))),false);
  await expect.poll(()=>page.evaluate(()=>window.sidebarPanel.active)).toBe(false);
  await expect.poll(()=>page.evaluate(()=>document.body.style.pointerEvents)).toBe('');
  await page.locator('[data-background-after]').focus();await expect(page.locator('[data-background-after]')).toBeFocused();
});

test('unmounting the filter owner cancels a chat request pending behind its exit',async()=>{
  await show({width:390,height:740});await open();
  await page.evaluate(()=>{
    window.sidebarChatRequests=0;
    window.sidebarPanel.requestOpenChat(()=>{window.sidebarChatRequests++;window.sidebarChat.openChat();});
    window.sidebarSetMounted(false);
  });
  await expect(sidebar()).toHaveCount(0);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
  assert.equal(await page.evaluate(()=>window.sidebarChatRequests),0);
  assert.equal(await page.evaluate(()=>window.sidebarChat.state.isOpen),false);
  await expect(launcher()).toBeVisible();
});

for(const change of ['path','organization'])test(`real scoped provider cancels pending chat when ${change} changes`,async()=>{
  await show({width:390,height:740});await open();
  await page.evaluate(change=>{
    window.sidebarChatRequests=0;
    window.sidebarPanel.requestOpenChat(()=>{window.sidebarChatRequests++;window.sidebarChat.openChat();});
    if(change==='path')window.sidebarFixturePath='/crm/contacts-next';
    else window.sidebarFixtureOrg='10000000-0000-4000-8000-000000000002';
    window.dispatchEvent(new Event('sidebar-fixture-scope'));
  },change);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
  assert.equal(await page.evaluate(()=>window.sidebarChatRequests),0,'retired scope never invokes an old chat callback');
  assert.equal(await page.evaluate(()=>window.sidebarChat.state.isOpen),false);
});

async function recordMotion(){
  await page.evaluate(()=>{
    window.sidebarMotionSamples=[];window.sidebarMotionDone=false;const until=performance.now()+1100;
    function sample(){
      const buttons=[...document.querySelectorAll('button[aria-controls="floating-whatsapp-chat"]')];
      const rect=buttons[0]?.getBoundingClientRect();
      window.sidebarMotionSamples.push({count:buttons.length,x:rect?.x,y:rect?.y,width:rect?.width,height:rect?.height,layoutWidth:buttons[0]?.clientWidth,layoutHeight:buttons[0]?.clientHeight});
      if(performance.now()<until)requestAnimationFrame(sample);else window.sidebarMotionDone=true;
    }requestAnimationFrame(sample);
  });
}
async function checkMotion(width,phase){
  await page.waitForFunction(()=>window.sidebarMotionDone);
  const frames=await page.evaluate(()=>window.sidebarMotionSamples);assert.ok(frames.length>=10,'real animation frames were observed');
  for(const frame of frames){
    assert.equal(frame.count,1,phase+' has exactly one launcher');
    assert.equal(frame.layoutWidth,56);assert.equal(frame.layoutHeight,56);
    assert.ok(Math.abs(frame.width-56)<0.01&&Math.abs(frame.height-56)<0.01,'transform rounding never changes the 56px layout size');
    assert.ok(frame.x>=-1&&frame.x+frame.width<=width+1&&frame.y>=-1&&frame.y+frame.height<=741,phase+' remains in viewport: '+JSON.stringify(frame));
  }
}
for(const width of [320,390])test(`launcher no-preference animation stays in bounds early, midway and settled at ${width}`,async()=>{
  await show({width,height:740});await page.emulateMedia({reducedMotion:'no-preference'});
  const previous=await bounds(launcher());await recordMotion();await trigger().click();
  await page.waitForTimeout(70);await save(`launcher-motion-${width}-open-early`);
  await page.waitForTimeout(220);await save(`launcher-motion-${width}-open-mid`);
  await checkMotion(width,'opening');await save(`launcher-motion-${width}-open-end`);
  assert.equal(await launcher().evaluate(n=>Boolean(n.closest('[data-filter-sidebar="footer"]'))),true);
  await recordMotion();await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();
  await page.waitForTimeout(70);await save(`launcher-motion-${width}-close-early`);
  await page.waitForTimeout(140);await save(`launcher-motion-${width}-close-mid`);
  await checkMotion(width,'closing');await save(`launcher-motion-${width}-close-end`);
  assert.equal((await bounds(launcher())).x,previous.x,'animated close restores the previous side');
});

test('reduced motion disables launcher motion while dock changes remain functional',async()=>{
  await show({width:390,height:740});await page.emulateMedia({reducedMotion:'reduce'});
  await open();await expect(launcher()).toHaveCSS('transition-duration','0s');
  await expect(launcher().locator('..')).toHaveCSS('transition-duration','0s');
  await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();await expect(launcher()).toBeVisible();
  await expect(launcher()).toHaveCSS('transition-duration','0s');
});

test('launcher remains clickable after an open mobile sidebar crosses into desktop',async()=>{
  await show({width:390,height:740});await open();
  await expect.poll(()=>launcher().evaluate(n=>Boolean(n.closest('[data-filter-launcher-slot]')))).toBe(true);
  await page.setViewportSize({width:1024,height:740});
  await expect.poll(()=>page.evaluate(()=>window.sidebarPanel.mobile)).toBe(false);
  await expect(sidebar()).toBeVisible();await expect(launcher()).toHaveCSS('pointer-events','auto');
  await launcher().click();await expect(sidebar()).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>window.sidebarChat.state.isOpen)).toBe(true);
});

test('launcher remains clickable after live reduced motion is enabled with a desktop sidebar open',async()=>{
  await show({width:1024,height:740});await page.emulateMedia({reducedMotion:'no-preference'});await open();
  await expect.poll(()=>sidebar().evaluate(n=>n.getAnimations().some(animation=>animation.playState==='running'))).toBe(false);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(sidebar()).toBeVisible();await expect(launcher()).toHaveCSS('pointer-events','auto');
  await launcher().click();await expect(sidebar()).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>window.sidebarChat.state.isOpen)).toBe(true);
});

test('real mobile chat wrapper retires modality while retaining the exact draft, file and stateful subtree',async()=>{
  await page.setViewportSize({width:390,height:740});
  await page.evaluate(()=>window.showMobileWrapperFixture());
  const draft=page.locator('[data-wrapper-draft]'),file=page.locator('[data-wrapper-file]');
  await expect(page.getByRole('dialog',{name:'Chat do WhatsApp',exact:true})).toHaveCount(1);
  await expect(draft).toBeFocused();await draft.fill('Rascunho mobile preservado');
  await file.setInputFiles({name:'arquivo-wrapper.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic file')});
  await page.locator('[data-wrapper-counter]').click();
  await assertWrapperTabLoop(draft,page.locator('[data-wrapper-counter]'));
  await draft.evaluate(n=>window.wrapperDraftNode=n);
  for(let index=0;index<3;index++){
    await page.evaluate(()=>window.setWrapperMinimized(true));
    await expect(page.locator('[data-floating-chat-modal]')).toHaveCount(0);await expect(draft).toBeHidden();
    await expect.poll(()=>page.evaluate(()=>document.body.style.pointerEvents)).toBe('');
    await page.locator('[data-wrapper-outside]').focus();await expect(page.locator('[data-wrapper-outside]')).toBeFocused();
    await page.evaluate(()=>window.setWrapperMinimized(false));
    await expect(draft).toBeVisible();await expect(draft).toBeFocused();
    await assertWrapperTabLoop(draft,page.locator('[data-wrapper-counter]'));
    await expect(draft).toHaveValue('Rascunho mobile preservado');
    assert.equal(await draft.evaluate(n=>n===window.wrapperDraftNode),true);
    assert.equal(await file.evaluate(n=>n.files[0]?.name),'arquivo-wrapper.txt');
    await expect(page.locator('[data-wrapper-counter]')).toHaveText('Contagem 1');
    assert.deepEqual(await page.evaluate(()=>({mounts:window.wrapperMounts,unmounts:window.wrapperUnmounts})),{mounts:1,unmounts:0});
  }
});

test('sidebar runtime has no uncaught browser errors or external requests',()=>{
  assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);
});
