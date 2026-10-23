import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Exercise the actual UI selector, without reproducing its predicate.
const source = ts.createSourceFile('FloatingChat.tsx', readFileSync(new URL('../chat/FloatingChat.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'eligibleLeadStartSession');
assert.ok(declaration);
const compiled = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const eligible = new Function(`${compiled}; return eligibleLeadStartSession;`)();
const session = { status: 'connected', owner_user_id: 'owner', can_send: true };

test('shared start requires a loaded actor, even when the session grants sending', () => {
  for (const actor of [null, undefined, '']) assert.equal(eligible(session, actor, 'lead', true), false);
});
test('shared session selection requires a lead, original organization and explicit send grant', () => {
  assert.equal(eligible(session, 'broker', 'lead', true), true);
  assert.equal(eligible(session, 'broker', null, true), false);
  assert.equal(eligible(session, 'broker', 'lead', false), false);
  assert.equal(eligible({ ...session, can_send: undefined }, 'broker', 'lead', true), false);
  assert.equal(eligible({ ...session, status: 'disconnected' }, 'broker', 'lead', true), false);
});
test('owner selection still rejects an explicit send denial', () => {
  assert.equal(eligible(session, 'owner', undefined, true), true);
  assert.equal(eligible({ ...session, can_send: false }, 'owner', 'lead', true), false);
});
