import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';
import{createRequire}from'node:module';
import{test}from'node:test';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=readFileSync(process.env.WHATSAPP_LEAD_HANDLER_BASELINE||new URL('./LeadUnifiedThread.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('LeadUnifiedThread.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let declaration;
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='handleLoadOlderMessages')declaration=node.getText(ast);ts.forEachChild(node,visit)}visit(ast);assert.ok(declaration);
const body=ts.transpileModule('const '+declaration+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}};
function fixture(){const history=deferred(),windows=[],notices=[];const audioAuthorizationRef={current:'A'},audioAuthorizationGenerationRef={current:1};
const deps={audioAuthorizationRef,audioAuthorizationGenerationRef,threadScroll:{loadOlderPreservingPosition:fn=>fn()},loadOlderMessages:()=>history.promise,setRenderWindow:value=>windows.push(value),LEAD_HISTORY_RENDER_PAGE_SIZE:80,leadId:'lead-A',toast:{error:(...args)=>notices.push(args)}};
const handleLoadOlderMessages=Function(...Object.keys(deps),body+';return handleLoadOlderMessages;')(...Object.values(deps));
return{history,windows,notices,handlers:{handleLoadOlderMessages},navigateBack(){audioAuthorizationRef.current='B';audioAuthorizationGenerationRef.current+=2;audioAuthorizationRef.current='A';audioAuthorizationGenerationRef.current+=2}};}

for(const result of [{isError:true},{isFetchNextPageError:true}]) {
  test(`actual lead pagination does not expand its window after ${Object.keys(result)[0]}`,async()=>{
    const f=fixture();const pending=f.handlers.handleLoadOlderMessages();f.history.resolve(result);await pending;
    assert.deepEqual(f.windows,[]);assert.deepEqual(f.notices,[]);
  });
}
test('actual lead late pagination cannot reset another lead or a new attendance after ABA',async()=>{
  const f=fixture();const pending=f.handlers.handleLoadOlderMessages();f.navigateBack();
  f.history.resolve({isError:false,isFetchNextPageError:false});await pending;
  assert.deepEqual(f.windows,[]);assert.deepEqual(f.notices,[]);
});
test('actual lead successful current pagination expands its own window only',async()=>{
  const f=fixture();const pending=f.handlers.handleLoadOlderMessages();f.history.resolve({isError:false,isFetchNextPageError:false});await pending;
  assert.equal(f.windows.length,1);assert.deepEqual(f.windows[0]({leadId:'lead-A',count:80}),{leadId:'lead-A',count:120});
});
