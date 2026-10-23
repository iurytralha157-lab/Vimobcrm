import assert from 'node:assert/strict';
import test from 'node:test';
import { MutationObserver } from '@tanstack/react-query';
import { deferred, leadHookRuntime, turn } from './lead-request-runtime-fixture.mjs';
import { LEAD_STATUS_FINANCIAL_REVIEW_MESSAGE } from '../../lib/lead-financial-review.ts';

const params = (f, newStatus) => ({ leadId: 'lead-a', organizationId: 'org-a', newStatus,
  authorizedLead: f.authorizedLead, userId: 'actor-a', propertyId: null, valorInteresse: 100,
  commissionPercentage: 5, leadName: 'Synthetic', lostReason: newStatus === 'lost' ? 'Synthetic reason' : null });

for (const [before, after, flag, expectedWarning] of [
  ['won', 'open', false, true], ['won', 'lost', false, true], ['open', 'won', true, true], ['lost', 'won', true, true],
  ['open', 'won', false, false], ['lost', 'won', false, false], ['open', 'lost', false, false], ['lost', 'open', false, false],
]) test(`actual status mutation ${before} -> ${after} respects preexisting-finance signal ${flag}`, async () => {
  const f = leadHookRuntime();
  try {
    Object.assign(f.authorizedLead, { deal_status: before, valor_interesse: 100, commission_percentage: 5 });
    const saved = { ...f.authorizedLead, deal_status: after, financial_review_required: flag };
    f.respond(method => ({ data: method === 'getLead' ? f.authorizedLead : saved, error: null }));
    const observer = new MutationObserver(f.client(), f.render('hooks/use-deal-status-change.ts', 'useDealStatusChange'));
    await observer.mutate(params(f, after));
    const warnings = f.notices.filter(notice => notice.kind === 'warning');
    assert.equal(warnings.length, expectedWarning ? 1 : 0);
    if (expectedWarning) assert.equal(warnings[0].text, LEAD_STATUS_FINANCIAL_REVIEW_MESSAGE);
    assert.equal(f.requests.filter(request => request.method === 'updateLead').length, 1);
    assert.ok(f.requests.every(request => ['getLead', 'updateLead'].includes(request.method)));
    assert.equal(f.requests.find(request => request.method === 'updateLead').args[1].financial_review_required, undefined);
  } finally { f.close(); }
});

test('a late financial-review response after SID replacement cannot notify the new session', async () => {
  const f = leadHookRuntime();
  try {
    const wait = deferred();
    f.respond(method => method === 'updateLead' ? wait.promise : { data: f.authorizedLead, error: null });
    const observer = new MutationObserver(f.client(), f.render('hooks/use-deal-status-change.ts', 'useDealStatusChange'));
    const pending = observer.mutate(params(f, 'won')); await turn();
    f.switchTo('org-a', 'actor-a', 'sid-b'); f.render('hooks/use-deal-status-change.ts', 'useDealStatusChange');
    wait.resolve({ data: { ...f.authorizedLead, deal_status: 'won', financial_review_required: true }, error: null });
    await pending;
    assert.deepEqual(f.notices, []);
  } finally { f.close(); }
});

test('a newer canonical cache response cannot hide the financial signal on a confirmed Won receipt', async () => {
 const f=leadHookRuntime();try{
  const wait=deferred();f.respond(method=>method==='updateLead'?wait.promise:{data:f.authorizedLead,error:null});
  const observer=new MutationObserver(f.client(),f.render('hooks/use-deal-status-change.ts','useDealStatusChange'));
  const pending=observer.mutate(params(f,'won'));await turn();
  const receipt={...f.authorizedLead,deal_status:'won',updated_at:'2026-10-18T12:00:00Z',financial_review_required:true};
  const newer={...receipt,updated_at:'2026-10-18T12:00:01Z',financial_review_required:false,name:'Newer canonical value'};
  f.client().setQueryData(['lead','org-a','lead-a'],newer);wait.resolve({data:receipt,error:null});const result=await pending;
  assert.equal(result.lead.name,newer.name);assert.equal(result.lead.updated_at,newer.updated_at);
  assert.equal(result.financialReviewRequired,true);assert(f.notices.some(notice=>notice.text===LEAD_STATUS_FINANCIAL_REVIEW_MESSAGE));
 }finally{f.close();}
});
