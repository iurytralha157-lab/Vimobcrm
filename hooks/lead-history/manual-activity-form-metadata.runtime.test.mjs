import assert from 'node:assert/strict';
import test from 'node:test';
import {buildLeadHistory} from './build-history.ts';
import {extractWebhookFormAnswers,extractMetaFormAnswers} from './forms.ts';

// Actual form extraction and history projection, entirely synthetic and offline.
const at='2026-10-19T12:00:00Z',answer='Resposta legítima do formulário';
const formatters={formatCurrency:String,formatPropertyCurrency:String,formatResponseTime:String};
const fields=[['constructor','Constructor'],['__proto__','Proto'],['toString','ToString'],['valueOf','ValueOf'],
  ['hasOwnProperty','HasOwnProperty'],['propertyIsEnumerable','PropertyIsEnumerable']];
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze)}return value};
function raw(source,payload){
  if(source==='lead-meta')return{lead:{id:'lead-a',source:'webhook',created_at:at},leadMeta:{platform:'webhook',raw_payload:payload}};
  return{activityEvents:[{id:'stored-a',type:source==='activity-payload'?'lead_created':'lead_reentry',content:'Registro canônico',
    created_at:at,metadata:{source:'webhook',[source==='activity-payload'?'payload':'raw_payload']:payload}}]};
}
for(const [key,expected]of fields)for(const nested of[false,true])for(const source of['activity-payload','activity-raw-payload','lead-meta']){
  test(`stored webhook field ${key} remains text through ${source}, nested=${nested}`,()=>{
    // JSON.parse retains __proto__ as an ordinary stored own property.
    const payload=nested?{fields:[{label:key,value:answer}]}:JSON.parse(JSON.stringify({[key]:answer}));
    const input=freeze(raw(source,payload)),before=structuredClone(input);
    const rows=buildLeadHistory(input,'lead-a',formatters).filter(row=>row.type==='webhook_form_answer');
    assert.equal(rows.length,1);assert.equal(rows[0].metadata.question,expected);assert.equal(rows[0].content,answer);
    assert.equal(typeof rows[0].metadata.question,'string');assert.deepEqual(input,before);
    assert.equal(Object.prototype.constructor,Object);
  });
}

for(const source of['activity-payload','activity-raw-payload','lead-meta'])test(`known labels and technical filters stay unchanged through ${source}`,()=>{
  const payload={principal_desafio:answer,tipo_empreendimento:'Residencial',email:'synthetic@example.invalid',phone:'5511000000000',
    campaign_id:'synthetic-campaign',token:'synthetic-filtered-token',created_at:at};
  const input=freeze(raw(source,payload)),before=structuredClone(input);
  const rows=buildLeadHistory(input,'lead-a',formatters).filter(row=>row.type==='webhook_form_answer');
  assert.deepEqual(rows.map(row=>[row.metadata.question,row.content]),[['Principal desafio',answer],['Tipo do empreendimento','Residencial']]);
  assert.deepEqual(input,before);
});

test('direct extractors return plain labels and preserve Meta field behavior',()=>{
  assert.deepEqual(extractWebhookFormAnswers({payload:JSON.parse('{"constructor":"Resposta"}')}),[{question:'Constructor',answer:'Resposta'}]);
  assert.deepEqual(extractMetaFormAnswers({custom_fields:JSON.parse('{"constructor":"Resposta"}')}),[{question:'constructor',answer:'Resposta'}]);
});
