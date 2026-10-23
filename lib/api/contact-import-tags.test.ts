import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { apiTagResponseSchema, createTagInputSchema } from '@/lib/validation/crm-support';
import { parseDomainInput, validateDomainResponse } from '@/lib/validation/common';
import { DEFAULT_TAG_COLOR } from '@/config/tag-colors';

const source = readFileSync(new URL('./contact-import-tags.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('contact-import-tags.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'contactImportTagAdapter');
assert.ok(declaration);
const code = ts.transpileModule(declaration.getText(ast).replace(/^export\s+/, '') + '\nreturn contactImportTagAdapter;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('actual batch tag adapter binds actor and organization and validates its domain contract', async () => {
  let options: Record<string, unknown> | undefined;
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const tag = { id: '22222222-2222-4222-8222-222222222222', name: 'Quente', color: DEFAULT_TAG_COLOR, description: null, organization_id: organizationId, created_at: '2026-10-12T18:00:00Z', updated_at: '2026-10-12T18:00:00Z' };
  const dependencies = { tagsAPI: { list: async () => [tag] }, DEFAULT_TAG_COLOR, parseDomainInput, createTagInputSchema, validateDomainResponse, apiTagResponseSchema,
    vimobAPIRequest: async (_path: string, request: Record<string, unknown>) => { options = request; return { data: tag }; } };
  const factory = new Function(...Object.keys(dependencies), code)(...Object.values(dependencies)) as (org: string, actor: string, sessionId?: string) => { create: (name: string) => Promise<typeof tag>; load: () => Promise<typeof tag[]> };
  const adapter = factory(organizationId, 'original-actor', 'original-session');
  assert.deepEqual(await adapter.create(' Quente '), tag);
  assert.equal(options?.expectedUserId, 'original-actor');
  assert.equal(options?.expectedSessionId, 'original-session');
  assert.equal(options?.organizationId, organizationId);
  assert.equal(options?.method, 'POST');
  assert.deepEqual(options?.body, { name: 'Quente', color: DEFAULT_TAG_COLOR });
  assert.deepEqual(await adapter.load(), [tag]);
});
