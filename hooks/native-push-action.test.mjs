import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const path=process.env.VIMOB_AUTO_LOGOUT_BEFORE
  ?'D:/Vimob/tmp/whatsapp-deep-fixes-20261012/media/logout-auto-baseline/use-push-notifications.ts'
  :new URL('./use-push-notifications.ts',import.meta.url);
const source=ts.createSourceFile('use-push-notifications.ts',readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
let guard,action,handler;
function visit(node){
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)){
    if(node.name.text==='isCurrentInitialization')guard=node.initializer.getText(source);
    if(node.name.text==='handleNotificationAction')handler=node.initializer.getText(source);
  }
  if(ts.isCallExpression(node)&&node.expression.getText(source)==='PushNotifications.addListener'
    &&node.arguments[0]?.getText(source)==="'pushNotificationActionPerformed'")action=node.arguments[1].getText(source);
  ts.forEachChild(node,visit);
}
visit(source);assert.ok(guard&&action&&handler);
function harness(){
  const navigations=[],initializationGeneration={current:1};let intentCurrent=true;
  const sandbox={generation:1,initializationGeneration,initializationIntent:{isCurrent:()=>intentCurrent},
    console:{log(){}},useCallback:callback=>callback,router:{push:path=>navigations.push(path)},
    pushContextRef:{current:{canViewWhatsApp:true}},getPushNotificationRoute:()=>'/conversas?synthetic=1'};
  vm.runInNewContext(ts.transpileModule(`const isCurrentInitialization=${guard};const handleNotificationAction=${handler};globalThis.click=${action};`,
    {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,sandbox);
  return {navigations,initializationGeneration,cancelIntent:()=>{intentCurrent=false},click:()=>sandbox.click({actionId:'tap',notification:{data:{}}})};
}
test('current native listener still handles its notification click exactly once',()=>{
  const h=harness();h.click();assert.equal(h.navigations.length,1);
});
test('a queued native click from a removed initialization cannot navigate a new visit',()=>{
  const h=harness();h.initializationGeneration.current++;h.click();assert.deepEqual(h.navigations,[]);
});
test('layout-invalidated identity blocks an old click before passive listener cleanup changes its generation',()=>{
  const h=harness();h.cancelIntent();assert.equal(h.initializationGeneration.current,1);h.click();assert.deepEqual(h.navigations,[]);
});
