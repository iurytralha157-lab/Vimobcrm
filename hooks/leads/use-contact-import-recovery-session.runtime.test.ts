import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';
import { contactImportScopeKey } from '@/lib/lead-import-scope';
import { createContactImportRecoveryStore, type ContactImportRecovery } from '@/components/features/contacts/contact-import-recovery';

const source = readFileSync(new URL('./use-contact-import-recovery-session.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('use-contact-import-recovery-session.ts', source, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useContactImportRecoverySession');
assert.ok(fn);
const code = ts.transpileModule(fn.getText(ast).replace(/^export /, '') + '\nreturn useContactImportRecoverySession;', {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const snapshot = (): ContactImportRecovery => ({
  rows: [{ rowNumber: 2, nome: 'Sintético' }], file: new File(['Nome\nSintético'], 'contacts.csv'),
  destination: { pipeline: '', assignee: 'none', source: 'import', customSource: '', autoDistribute: false, roundRobin: 'automatic' },
  pending: true, phase: 'importing', progress: null, result: null, unknownPreparationRows: [], preparedRows: 0, createdTags: 0,
});
const session = (id: string, version = 1) => ({ access_token: `header.${Buffer.from(JSON.stringify({ session_id: id, version })).toString('base64url')}.signature` });

test('the globally mounted recovery hook clears a session ending outside Contacts and preserves token renewal', () => {
  const store = createContactImportRecoveryStore();
  let auth = { user: { id: 'actor-a' } as { id: string } | null, session: session('sid-a') as ReturnType<typeof session> | null };
  let previous: unknown[] | undefined;
  let effects = 0;
  const deps = {
    useAuth: () => auth, contactImportRecovery: store, getGlobalSignOutSessionId,
    useLayoutEffect: (activate: () => void, current: unknown[]) => {
      if (!previous || current.some((item, index) => item !== previous![index])) { effects += 1; activate(); previous = current; }
    },
  };
  const render = new Function(...Object.keys(deps), code)(...Object.values(deps)) as () => void;
  const keyA = contactImportScopeKey('org-a', 'actor-a', 'sid-a')!;
  const keyB = contactImportScopeKey('org-b', 'actor-a', 'sid-a')!;
  const run = store.start(keyA, snapshot())!;
  store.start(keyB, snapshot());
  render();
  auth = { ...auth, session: session('sid-a', 2) }; render();
  assert.equal(effects, 1);
  assert.ok(store.get(keyA)); assert.ok(store.get(keyB));
  auth = { user: null, session: null }; render();
  assert.equal(store.get(keyA), undefined); assert.equal(store.get(keyB), undefined);
  store.update(keyA, run, { pending: false });
  assert.equal(store.get(keyA), undefined);
  const provider = readFileSync(new URL('../../components/providers/auth-provider-wrapper.tsx', import.meta.url), 'utf8');
  const lifecycle = readFileSync(new URL('../../components/features/contacts/ContactImportRecoveryLifecycle.tsx', import.meta.url), 'utf8');
  assert.match(provider, /<AuthProvider>.*<ContactImportRecoveryLifecycle\s*\/>/);
  assert.match(lifecycle, /useContactImportRecoverySession\(\)/);
});
