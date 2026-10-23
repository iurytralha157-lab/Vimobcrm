import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/query-core';
import { randomUUID } from 'node:crypto';
import { getLeadAttachmentUploadReceipt } from '../../../../lib/lead-attachment-upload.ts';
import { getGlobalSignOutSessionId } from '../../../../lib/auth/global-sign-out.ts';
import { deferred, evaluateProduction, productionDeclaration } from '../../../../hooks/leads/lead-request-runtime-fixture.mjs';

function source(path) {
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  return ast.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)).map(node => node.getText(ast)).join('\n');
}
const token = (actor, sid) => `header.${Buffer.from(JSON.stringify({ sub: actor, session_id: sid })).toString('base64url')}.synthetic`;
export const { ClientActionRateLimitError, getClientRateLimitMessage } = evaluateProduction(
  source('lib/client-action-rate-limit.ts'), {}, '({ ClientActionRateLimitError, getClientRateLimitMessage })');

// Production upload hook, detail access hook and popup handler, with actual
// mutation scheduling/cache. Only auth, rate-limit trigger and HTTP are synthetic.
export function attachmentUploadRuntime({ popup = true } = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false, gcTime: Infinity } } });
  const slots = [], observers = [], requests = [], notices = [], invalidations = [], limits = [];
  const auth = { activeOrganization: { organizationId: 'org-a' }, user: { id: 'actor-a' }, session: { access_token: token('actor-a', 'sid-a') } };
  const lead = { id: 'lead-a' }, file = new File(['synthetic'], 'fixture.pdf'), input = { value: 'fixture.pdf' };
  let cursor = 0, allowed = true, failure, rateFailure, reply, captureDetailOperation, mutation, draftHook, mounted = true;
  const changed = (old, next) => !old || next.some((value, index) => !Object.is(value, old[index]));
  const react = {
    useRef: value => { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo: (build, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: build() }; return slots[index].value; },
    useEffect: (setup, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; } },
  };
  react.useLayoutEffect = react.useEffect;
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = (...args) => { invalidations.push(args[0]); return invalidate(...args); };
  const deps = { ...react, useQueryClient: () => client, useAuth: () => auth, getGlobalSignOutSessionId,
    createUUID: randomUUID,
    useQuery: options => { const observer = new QueryObserver(client, options); observers.push(observer); return observer.getCurrentResult(); },
    getClientRateLimitMessage, console: { error() {} },
    enforceClientActionRateLimit: (...args) => { limits.push(args); if (rateFailure) throw rateFailure; },
    toast: Object.fromEntries(['success', 'error', 'warning'].map(kind => [kind, message => notices.push({ kind, message })])),
    useMutation: options => { const observer = new MutationObserver(client, options); observers.push(observer); return { mutateAsync: variables => observer.mutate(variables) }; },
    leadAttachmentsAPI: { upload: async (...args) => { requests.push(args); getLeadAttachmentUploadReceipt(args[1], { organizationId: args[2], leadId: args[0], userId: args[3].expectedUserId, sessionId: args[3].expectedSessionId }); if (reply) await reply.promise; if (failure) throw failure;
      return { id: 'attachment-a', lead_id: lead.id, file_name: file.name, file_url: null, availability: 'signing_unavailable' }; } },
  };
  const hook = evaluateProduction(source(process.env.PIPELINE_ATTACHMENT_HOOK_SOURCE || 'hooks/use-lead-attachments.ts'), deps, 'useUploadLeadAttachment');
  const detailScope = evaluateProduction(productionDeclaration('hooks/leads/use-lead-detail-operation-scope.ts',
    node => ts.isFunctionDeclaration(node) && node.name?.text === 'useLeadDetailOperationScope'), deps, 'useLeadDetailOperationScope');
  deps.useLeadDetailOperationScope = detailScope;
  // This factory executes the production hook against the deterministic
  // lifecycle above, rather than calling React hooks from a component render.
  const createDraftFrame = evaluateProduction(source('hooks/leads/use-lead-attachment-upload-draft.ts'), deps, 'useLeadAttachmentUploadDraft');
  const dialogPath = process.env.PIPELINE_ATTACHMENT_DETAIL_SOURCE || 'components/features/leads/LeadDetailDialog.tsx';
  const declaration = name => 'const ' + productionDeclaration(dialogPath, node => ts.isVariableDeclaration(node) && node.name.getText() === name);
  const render = (patch = {}) => {
    if (!mounted) throw Error('Fixture unmounted');
    if ('org' in patch) auth.activeOrganization.organizationId = patch.org;
    if ('actor' in patch) auth.user = { id: patch.actor };
    if ('actor' in patch || 'sid' in patch) auth.session = { access_token: token(auth.user.id, patch.sid ?? getGlobalSignOutSessionId(auth.session)) };
    if ('allowed' in patch) allowed = patch.allowed;
    if ('leadId' in patch) lead.id = patch.leadId;
    cursor = 0;
    if (!client.getQueryCache().find({ queryKey: ['lead-attachments', auth.activeOrganization.organizationId, lead.id], exact: true })) client.setQueryData(['lead-attachments', auth.activeOrganization.organizationId, lead.id], []);
    draftHook = createDraftFrame(auth.activeOrganization.organizationId, lead.id, auth.user.id, getGlobalSignOutSessionId(auth.session));
    mutation = popup ? evaluateProduction(declaration('uploadAttachment'), { useUploadLeadAttachment: hook }, 'uploadAttachment') : hook();
    captureDetailOperation = detailScope(lead.id, auth.activeOrganization.organizationId, auth.user.id, client, allowed, getGlobalSignOutSessionId(auth.session));
    return mutation;
  };
  const handler = () => evaluateProduction(declaration('handleFileUpload'), {
    ...deps, lead, canOperateLead: allowed, captureDetailOperation, uploadAttachment: mutation, attachmentUploadDraft: draftHook, queryClient: client,
    fileInputRef: { current: input }, getErrorMessage: error => error.message,
  }, 'handleFileUpload');
  const unmount = () => { mounted = false; slots.forEach(slot => slot?.cleanup?.()); };
  return { client, requests, notices, invalidations, limits, file, input, render, handler,
    draft: () => client.getQueryData(['lead-attachment-upload-draft', auth.activeOrganization.organizationId, auth.user.id, getGlobalSignOutSessionId(auth.session), lead.id]),
    receipt: () => getLeadAttachmentUploadReceipt(file, { organizationId: auth.activeOrganization.organizationId, leadId: lead.id, userId: auth.user.id, sessionId: getGlobalSignOutSessionId(auth.session) }),
    reopen: () => { mounted = true; slots.length = 0; return render(); },
    upload: () => handler()({ target: { files: [file] } }),
    state: () => ({ uploading: client.getQueryData(['lead-attachment-upload-draft', auth.activeOrganization.organizationId, auth.user.id, getGlobalSignOutSessionId(auth.session), lead.id])?.phase === 'pending' }), fail: error => { failure = error; }, rateLimit: error => { rateFailure = error; },
    deferReply: () => reply = deferred(), unmount,
    close: () => { if (mounted) unmount(); observers.forEach(observer => observer.reset?.()); client.clear(); },
  };
}
