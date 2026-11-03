import http from 'node:http';
const ORG=(id,name)=>({id,name,logo_url:null,theme_mode:'dark',accent_color:'#ff4529',is_active:true,subscription_status:'active',subscription_type:'paid',trial_ends_at:null,billing_grace_until:null,segment:'imobiliario',cnpj:null,creci:null,inscricao_estadual:null,razao_social:null,nome_fantasia:null,cep:null,endereco:null,numero:null,complemento:null,bairro:null,cidade:null,uf:null,telefone:null,whatsapp:null,email:null,website:null,default_commission_percentage:null,property_edit_policy:'everyone',property_owner_contact_visibility:'visible',updated_at:'2026-01-01T00:00:00Z'});
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U={ 'one@t.test':{id:'11111111-1111-4111-8111-111111111111',orgs:[A],sa:false},'many@t.test':{id:'22222222-2222-4222-8222-222222222222',orgs:[A,B],sa:false},'none@t.test':{id:'33333333-3333-4333-8333-333333333333',orgs:[],sa:false},'sa0@t.test':{id:'44444444-4444-4444-8444-444444444444',orgs:[],sa:true},'sa1@t.test':{id:'55555555-5555-4555-8555-555555555555',orgs:[A],sa:true},'sus@t.test':{id:'66666666-6666-4666-8666-666666666666',orgs:[],sa:false,suspended:true}};
const byId=id=>Object.entries(U).find(([,u])=>u.id===id);
let c; const reset=()=>c={api:'ok',auth:'ok',login:null,logoutGlobal:0,logoutLocal:0,removed:false,suspended:false}; reset();
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
let n=0;
const tok=(email,u,amr='password')=>`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:u.id,email,aud:'authenticated',role:'authenticated',session_id:`s-${u.id}`,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),amr:[{method:amr,timestamp:1}]})}.sig`;
const authUser=(email,u)=>({id:u.id,aud:'authenticated',role:'authenticated',email,app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'});
const sub=req=>{try{return JSON.parse(Buffer.from((req.headers.authorization||'').split(' ')[1].split('.')[1],'base64url')).sub}catch{return null}};
http.createServer((req,res)=>{let body='';req.on('data',d=>body+=d);req.on('end',()=>{
 const url=new URL(req.url,'http://x');const p=url.pathname;
 const h={'access-control-allow-origin':req.headers.origin||'*','access-control-allow-headers':req.headers['access-control-request-headers']||'*','access-control-allow-methods':'*','access-control-allow-credentials':'true','content-type':'application/json'};
 const send=(s,o)=>{res.writeHead(s,h);res.end(o===undefined?'':JSON.stringify(o))};
 if(req.method==='OPTIONS')return send(204);
 if(p==='/__control'){if(body){const o=JSON.parse(body);if(o.reset)reset();Object.assign(c,o)};return send(200,c)}
 if(p==='/auth/v1/token'){ if(c.login)return send(c.login,{code:c.login===429?'over_request_rate_limit':'unexpected_failure',msg:'x',message:'x'});
   if(url.searchParams.get('grant_type')==='refresh_token'){const rt=JSON.parse(body||'{}').refresh_token||'';const e=byId(rt.slice(1));if(!e||c.auth==='revoked')return send(400,{code:'refresh_token_not_found',msg:'gone'});return send(200,{access_token:tok(e[0],e[1]),token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:rt,user:authUser(e[0],e[1])})}
   const {email,password}=JSON.parse(body||'{}');const u=U[email];if(!u||password!=='Senha!12345')return send(400,{code:'invalid_credentials',msg:'Invalid login credentials'});
   return send(200,{access_token:tok(email,u),token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:'r'+u.id,user:authUser(email,u)})}
 if(p==='/auth/v1/user'){ if(c.auth==='down')return send(503,{message:'down'}); if(c.auth==='revoked')return send(403,{code:'session_not_found',msg:'gone'});
   const e=byId(sub(req));return e?send(200,authUser(e[0],e[1])):send(401,{msg:'no'})}
 if(p==='/auth/v1/logout'){ url.searchParams.get('scope')==='global'?c.logoutGlobal++:c.logoutLocal++; return send(204)}
 if(p.startsWith('/auth/'))return send(200,{});
 if(!p.startsWith('/v1/')||p.startsWith('/v1/public/'))return send(200,{data:[]});
 if(c.api==='down')return send(503,{error:{code:'service_unavailable',message:'down'}});
 if(c.api==='401')return send(401,{error:{code:'unauthorized',message:'Invalid or expired bearer token.'}});
 const e=byId(sub(req)); if(!e)return send(401,{error:{code:'unauthorized',message:'no'}});
 const [email,u]=e; const orgs=(c.removed||c.suspended)?[]:u.orgs;
 if(p==='/v1/user-organizations')return send(200,{data:orgs.map(id=>({organization_id:id,organization_name:id===A?'Org A':'Org B',organization_logo:null,member_role:'admin',is_active:true,joined_at:'2026-01-01T00:00:00Z',last_accessed_at:null}))});
 if(p==='/v1/me/account-status')return send(200,{profileExists:true,globallyActive:!(u.suspended||c.suspended),isSuperAdmin:u.sa});
 if(p==='/v1/me/switch-organization')return send(200,{ok:true});
 if(p==='/v1/me/profile'||p==='/v1/me'){const want=req.headers['x-organization-id']||orgs[0];const oid=orgs.includes(want)?want:undefined;
   return send(200,{user:{id:u.id,email},profile:{id:u.id,email,name:email,avatar_url:null,organization_id:oid??null,role:u.sa?'super_admin':'admin',is_active:true,language:null,theme_mode:null,whatsapp:null,cpf:null},organization:oid?ORG(oid,'Org A'):null,context:{userId:u.id,userRole:u.sa?'super_admin':'user',...(oid?{organizationId:oid,memberRole:'admin',subscriptionStatus:'active'}:{}),permissions:['*'],enabledModules:[],isTeamLeader:false,isSuperAdmin:u.sa}})}
 return send(200,{data:[],total:0});
})}).listen(54400,'127.0.0.1',()=>console.log('fake up'));
