import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium, expect } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(import.meta.url);
let directory, browser, bundle;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-team-invitations-'));
  const stub = path.join(directory, 'synthetic.tsx');
  const entry = path.join(directory, 'entry.tsx');
  const loader = path.join(directory, 'loader.cjs');
  await writeFile(stub, `
    import { createContext, useContext } from 'react';
    export const Lists = createContext(null);
    const organizationId = 'synthetic-org';
    export const useAuth = () => ({ activeOrganization: { organizationId }, profile: { id: 'actor' },
      isSuperAdmin: false, tenantContext: { organizationId, memberRole: 'admin' } });
    export const useLanguage = () => ({ t: { settings: { users: { title: 'Usuários', newUser: 'Novo usuário',
      role: 'Perfil', admin: 'Administrador', manager: 'Gerente', user: 'Usuário' } },
      common: { cancel: 'Cancelar', inactive: 'Inativo' } } });
    export const useUserPermissions = () => ({ hasPermission: () => false });
    export const useInvitations = () => ({ data: useContext(Lists).invitations, dataUpdatedAt: Date.now(),
      refetch: () => window.refreshes.push('invitations') });
    export const useOrganizationUsers = () => ({ data: useContext(Lists).users,
      refetch: () => window.refreshes.push('users') });
    export const useDeleteUserImpact = () => ({});
    const mutation = () => ({ isPending: false });
    export { mutation as useUpdateUser, mutation as useDeleteUser, mutation as useCreateInvitations,
      mutation as useDeleteInvitation, mutation as useUpdateInvitation, mutation as useResendInvitation };
    export const getInvitationEmailState = () => 'accepted';
    export const getInvitationEmailLabel = () => 'Aceito pelo provedor; entrega não confirmada';
    export const MAX_ORGANIZATION_INVITATIONS_PER_BATCH = 10;
    export const organizationInvitationBatchSchema = {};
    export default function Link(props) { return <a {...props}/>; }
  `);
  await writeFile(entry, `
    import { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { Lists } from './synthetic';
    import { TeamTab } from '@/components/features/settings/TeamTab';
    window.refreshes = [];
    function Fixture() {
      const [state, update] = useState({ users: [], invitations: [] });
      window.updateLists = update;
      return <Lists.Provider value={state}><TeamTab search={state.search}/></Lists.Provider>;
    }
    createRoot(document.getElementById('app')).render(<Fixture />);
  `);
  await writeFile(loader, `const ts = require(${JSON.stringify(require.resolve('typescript'))});
    module.exports = source => ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;`);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  const stubs = ['@/contexts/AuthContext', '@/contexts/LanguageContext', '@/hooks/use-user-permissions',
    '@/hooks/use-users', '@/hooks/use-invitations', '@/lib/validation', 'next/link'];
  const alias = { ...Object.fromEntries(stubs.map(name => [`${name}$`, stub])), '@': root };
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: 'development', target: 'web', devtool: false, entry,
      output: { path: directory, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(root, 'node_modules'), 'node_modules'], alias },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
    });
    compiler.run((error, stats) => compiler.close(() =>
      error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  bundle = await readFile(path.join(directory, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
}, { timeout: 180_000 });

after(async () => {
  await browser?.close();
  if (directory) {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert.ok(path.basename(target).startsWith('vimob-team-invitations-'));
    await rm(target, { recursive: true, force: true });
  }
});

test('o aceite troca o convite pelo membro e mantém as ações dos demais convites', async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/*', route => route.abort());
    await page.setContent('<div id="app"></div>');
    await page.addScriptTag({ content: bundle });
    const list = page.getByRole('region', { name: 'Usuários e convites da organização' });
    await expect(list).toBeVisible();

    const now = new Date().toISOString();
    const invitation = { id: 'transition', email: 'aceite@example.test', role: 'user', used_at: null, expires_at: now, is_expired: false };
    const expired = { ...invitation, id: 'expired', email: 'expirado@example.test', is_expired: true };
    const pending = { ...invitation, id: 'pending', email: 'pendente@example.test' };
    await page.evaluate(data => window.updateLists(data), { users: [], invitations: [invitation, pending, expired] });
    await expect(list.getByRole('button', { name: 'Reenviar convite para aceite@example.test' })).toBeVisible();

    const member = { id: 'new-member', name: 'Membro do teste', email: invitation.email, role: 'user', is_active: true };
    const accepted = { ...invitation, used_at: now };
    await page.evaluate(data => window.updateLists(data), { users: [], invitations: [accepted, pending, expired] });
    await expect(list.getByText(invitation.email, { exact: true })).toHaveCount(0);
    await page.evaluate(data => window.updateLists(data), { users: [member], invitations: [accepted, pending, expired] });
    const memberCard = list.getByRole('article').filter({ hasText: member.name });
    await expect(memberCard.getByRole('combobox')).toBeEnabled();
    await expect(memberCard.getByRole('link', { name: `Editar permissoes de ${member.name}` })).toHaveAttribute('href', `/settings/users/${member.id}`);
    await expect(list.getByText(member.email, { exact: true })).toHaveCount(1);
    await expect(list.getByText('Aceito', { exact: true })).toHaveCount(0);
    await expect(list.getByRole('button', { name: 'Reenviar convite para pendente@example.test' })).toBeVisible();
    await expect(list.getByRole('button', { name: 'Renovar convite para expirado@example.test' })).toBeVisible();
    await page.getByRole('button', { name: 'Atualizar usuários e convites' }).click();
    assert.deepEqual(await page.evaluate(() => window.refreshes.sort()), ['invitations', 'users']);

    await page.evaluate(data => window.updateLists(data), { users: [], invitations: [accepted], search: invitation.email });
    await expect(list.getByText('Nenhum usuário vinculado a esta organização.')).toBeVisible();
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
