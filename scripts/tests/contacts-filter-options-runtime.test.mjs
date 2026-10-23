import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(import.meta.url);
const directory=await mkdtemp(path.join(tmpdir(),'vimob-contacts-filter-options-'));
let runtime=await readFile(path.join(repository,'scripts/tests/contacts-filter-application-runtime.test.mjs'),'utf8');
runtime=runtime.slice(0,runtime.indexOf("test('an explicit snapshot"));
assert.ok(runtime.includes("const synthetic ="),'reuse the offline real-screen fixture');
runtime=runtime.replace("import { chromium, expect } from '@playwright/test';",()=>'import playwright from '+JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)+';const{chromium,expect}=playwright;')
  .replace("path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')",()=>JSON.stringify(repository))
  .replace('createRequire(import.meta.url)',()=>'createRequire('+JSON.stringify(path.join(repository,'package.json'))+')')
  .replaceAll('tmpdir()',JSON.stringify(directory))
  .replace("import React from 'react';","import React, {useSyncExternalStore} from 'react';")
  .replace("const noop=()=>{};",[
    "const noop=()=>{};",
    "window.fixtureOptionErrors={tags:false,teams:false,meta:false};window.fixtureOptionCalls={tags:0,teams:0,meta:0};",
    "const subscribe=callback=>{window.addEventListener('fixture-options-change',callback);return()=>window.removeEventListener('fixture-options-change',callback);};",
    "const catalog=key=>{const failed=useSyncExternalStore(subscribe,()=>window.fixtureOptionErrors[key]);return{data:[],isLoading:false,isFetching:false,isError:failed,isSuccess:!failed,error:failed?Error('synthetic '+key+' unavailable'):null,refetch:async()=>{window.fixtureOptionCalls[key]++;window.fixtureOptionErrors[key]=false;window.dispatchEvent(new Event('fixture-options-change'));return{data:[]};}};};",
  ].join('\n'))
  .replace("export const useTags=()=>({data:[],refetch:noop,isError:false,isFetching:false,isLoading:false});","export const useTags=()=>catalog('tags');\nexport const useCreateTag=()=>({isPending:false,mutateAsync:()=>{throw Error('No tag writes');}});")
  .replace("export const useTeams=()=>({data:[],refetch:noop,isError:false,isFetching:false,isLoading:false,isSuccess:true});","export const useTeams=()=>catalog('teams');")
  .replace("export const getLeadMetaFilters=async()=>({sources:[],pages:[],campaigns:[],adsets:[],ads:[]});","export const getLeadMetaFilters=async()=>{window.fixtureOptionCalls.meta++;if(window.fixtureOptionErrors.meta)throw Error('synthetic metadata unavailable');return{sources:[],pages:[],campaigns:[],adsets:[],ads:[]};};");
runtime=runtime.replace("const entry = path.join(directory, 'fixture.tsx');","const entry = path.join(directory, 'fixture.tsx');");
runtime+='\nexport const currentPage=()=>page;\n';
await writeFile(path.join(directory,'runtime.mjs'),runtime);
const ui=await import(pathToFileURL(path.join(directory,'runtime.mjs')).href);
const {expect}=require('@playwright/test');
after(async()=>{
  const target=path.resolve(directory);
  assert.equal(path.dirname(target),path.resolve(tmpdir()));
  assert.match(path.basename(target),/^vimob-contacts-filter-options-/);
  await rm(target,{recursive:true,force:true});
});
for(const failed of ['tags','teams','meta']) {
  test('Contacts forwards '+failed+' catalog failure and retries only the failed catalog',async()=>{
    const page=ui.currentPage();
    await page.evaluate(failed=>{
      window.fixtureOptionErrors[failed]=true;
      window.dispatchEvent(new Event('fixture-options-change'));
      window.fixtureToolbar.filters.onFiltersOpenChange(true);
    },failed);
    await expect.poll(()=>page.evaluate(()=>window.fixtureToolbar.filters.hasDynamicOptionsError)).toBe(true);
    if(failed==='meta')assert.equal(await page.evaluate(()=>window.fixtureToolbar.filters.hasCampaignsError),true);
    await page.evaluate(()=>window.fixtureContext.setSource('manual'));
    await expect.poll(()=>page.evaluate(()=>window.fixtureToolbar.filters.source)).toBe('manual');
    const before=await page.evaluate(()=>({...window.fixtureOptionCalls}));
    await page.evaluate(async()=>{
      window.fixtureOptionErrors.meta=false;
      await window.fixtureToolbar.filters.onRetryDynamicOptions();
    });
    await expect.poll(()=>page.evaluate(()=>window.fixtureToolbar.filters.hasDynamicOptionsError)).toBe(false);
    assert.equal(await page.evaluate(()=>window.fixtureToolbar.filters.source),'manual','retry preserves the applied source');
    const calls=await page.evaluate(()=>window.fixtureOptionCalls);
    assert.equal(calls[failed],before[failed]+1,'one retry is dispatched for the failed catalog');
    for(const key of ['tags','teams','meta'].filter(key=>key!==failed))assert.equal(calls[key],before[key],'healthy '+key+' catalog is not refetched');
  });
}
test('Contacts retries simultaneous catalog failures without clearing filters or accepting duplicate retries',async()=>{
  const page=ui.currentPage();
  await page.evaluate(()=>{
    window.fixtureOptionErrors={tags:true,teams:true,meta:true};
    window.dispatchEvent(new Event('fixture-options-change'));
    window.fixtureToolbar.filters.onFiltersOpenChange(true);
  });
  await expect.poll(()=>page.evaluate(()=>window.fixtureToolbar.filters.hasCampaignsError)).toBe(true);
  await page.evaluate(()=>window.fixtureContext.setSource('manual'));
  const before=await page.evaluate(()=>({...window.fixtureOptionCalls}));
  await page.evaluate(async()=>{
    window.fixtureOptionErrors.meta=false;
    const retry=window.fixtureToolbar.filters.onRetryDynamicOptions;
    await Promise.all([retry(),retry()]);
  });
  await expect.poll(()=>page.evaluate(()=>window.fixtureToolbar.filters.hasDynamicOptionsError)).toBe(false);
  assert.equal(await page.evaluate(()=>window.fixtureToolbar.filters.source),'manual');
  const after=await page.evaluate(()=>window.fixtureOptionCalls);
  for(const key of ['tags','teams','meta'])assert.equal(after[key],before[key]+1,'deduplicates '+key+' retry');
});
