-- Execute only against the verified disposable local WhatsApp clone. The
-- migration must already exist. Every synthetic row and role switch rolls back.
begin;

do $$
declare ci_nonce text := nullif(current_setting('vimob.whatsapp_ci_nonce',true),'');
begin
  if ci_nonce is not null then
    if ci_nonce !~ '^[a-f0-9]{64}$' or current_database() <> 'vimob_whatsapp_clone'
       or inet_server_port() <> 57924 or host(inet_server_addr()) <> '127.0.0.1'
       or current_setting('fsync') <> 'on' or current_setting('synchronous_commit') <> 'on'
       or not exists(select 1 from vimob_ci_fixture.identity i where i.marker='vimob-whatsapp-ci-v1'
         and i.nonce=ci_nonce and i.system_identifier=(select system_identifier::text from pg_control_system())
         and replace(i.data_directory,chr(92),'/')=replace(current_setting('data_directory'),chr(92),'/')
         and i.created_at<=now() and i.created_at>now()-interval '6 hours') then
      raise exception 'saved-message SQL requires the fresh owned CI cluster identity';
    end if;
  elsif current_database() <> 'vimob_whatsapp_clone'
     or inet_server_port() <> 57922
     or host(inet_server_addr()) <> '127.0.0.1'
     or current_setting('data_directory') <> 'D:/Vimob/tmp/whatsapp-db-validation-20261013/data'
     or (select system_identifier::text from pg_control_system()) <> '7696313589555176164' then
    raise exception 'saved-message SQL test requires the verified disposable clone';
  end if;
  if not exists(select 1 from pg_class where oid='private.whatsapp_quick_replies'::regclass and relrowsecurity and relforcerowsecurity) then
    raise exception 'RLS and FORCE RLS are required';
  end if;
  if exists(select 1 from pg_policy where polrelid='private.whatsapp_quick_replies'::regclass) then
    raise exception 'personal messages must have no browser policy';
  end if;
  if not has_schema_privilege('service_role','private','usage') then
    raise exception 'backend role lacks private schema usage';
  end if;
end;
$$;

create temporary table quick_reply_sql_fixture(org_a uuid,org_b uuid,user_a uuid,user_b uuid);
insert into quick_reply_sql_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
grant select on quick_reply_sql_fixture to service_role;

insert into public.organizations(id,name,slug)
select org_a,'Synthetic Quick Reply SQL A','quick-reply-sql-a-'||org_a::text from quick_reply_sql_fixture
union all select org_b,'Synthetic Quick Reply SQL B','quick-reply-sql-b-'||org_b::text from quick_reply_sql_fixture;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select user_a,'authenticated','authenticated',user_a::text||'@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now() from quick_reply_sql_fixture
union all select user_b,'authenticated','authenticated',user_b::text||'@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now() from quick_reply_sql_fixture;
insert into public.users(id,organization_id,name,email,role,is_active)
select user_a,org_a,'Synthetic Quick Reply SQL A',user_a::text||'@example.invalid','user',true from quick_reply_sql_fixture
union all select user_b,org_a,'Synthetic Quick Reply SQL B',user_b::text||'@example.invalid','user',true from quick_reply_sql_fixture
on conflict(id) do update set organization_id=excluded.organization_id,role='user',is_active=true;
insert into public.organization_members(organization_id,user_id,role,is_active)
select org_a,user_a,'user',true from quick_reply_sql_fixture
union all select org_a,user_b,'user',true from quick_reply_sql_fixture
union all select org_b,user_a,'user',true from quick_reply_sql_fixture
on conflict(user_id,organization_id) do update set is_active=true;

-- service_role is a backend role with BYPASSRLS, not a browser role. Exercise
-- real SQL under it so FORCE RLS cannot accidentally disable persistence.
set local role service_role;
insert into private.whatsapp_quick_replies(organization_id,user_id,shortcut,content)
select org_a,user_a,'same-shortcut','  Synthetic text'||chr(10)||'🧡  ' from quick_reply_sql_fixture;
insert into private.whatsapp_quick_replies(organization_id,user_id,shortcut,content)
select org_a,user_b,'same-shortcut','Another owner' from quick_reply_sql_fixture;
insert into private.whatsapp_quick_replies(organization_id,user_id,shortcut,content)
select org_b,user_a,'same-shortcut','Another organization' from quick_reply_sql_fixture;
do $$
declare count_saved integer;
begin
  select count(*) into count_saved from private.whatsapp_quick_replies q,quick_reply_sql_fixture f
  where q.organization_id in(f.org_a,f.org_b);
  if count_saved <> 3 then raise exception 'backend persistence or independent scopes failed'; end if;
  begin
    insert into private.whatsapp_quick_replies(organization_id,user_id,shortcut,content)
    select org_a,user_a,'same-shortcut','Duplicate' from quick_reply_sql_fixture;
    raise exception 'duplicate own shortcut accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into private.whatsapp_quick_replies(organization_id,user_id,shortcut,content)
    select org_a,user_a,'invalid-shortcut',repeat('x',4001) from quick_reply_sql_fixture;
    raise exception 'oversized content was accepted or truncated';
  exception when check_violation then null;
  end;
  begin
    insert into private.whatsapp_quick_replies(organization_id,user_id,shortcut,content)
    select org_a,user_a,'blank',' '||chr(9)||chr(10) from quick_reply_sql_fixture;
    raise exception 'blank content accepted';
  exception when check_violation then null;
  end;
  begin
    update private.whatsapp_quick_replies q set user_id=f.user_b
    from quick_reply_sql_fixture f where q.organization_id=f.org_a and q.user_id=f.user_a;
    raise exception 'saved message owner was mutable';
  exception when check_violation then null;
  end;
  begin
    update private.whatsapp_quick_replies q set organization_id=f.org_b
    from quick_reply_sql_fixture f where q.organization_id=f.org_a and q.user_id=f.user_a;
    raise exception 'saved message organization was mutable';
  exception when check_violation then null;
  end;
end;
$$;
update private.whatsapp_quick_replies q set content='Updated synthetic text'
from quick_reply_sql_fixture f where q.organization_id=f.org_a and q.user_id=f.user_a;
delete from private.whatsapp_quick_replies q using quick_reply_sql_fixture f
where q.organization_id=f.org_a and q.user_id=f.user_a;
reset role;

-- Grant checks and actual commands both deny browser roles. No auth claims or
-- membership can turn this private backend table into a browser endpoint.
do $$
declare browser_role text; operation text;
begin
  foreach browser_role in array array['anon','authenticated'] loop
    foreach operation in array array['select','insert','update','delete'] loop
      if has_table_privilege(browser_role,'private.whatsapp_quick_replies',operation) then
        raise exception 'browser % unexpectedly has % privilege',browser_role,operation;
      end if;
    end loop;
    execute format('set local role %I',browser_role);
    foreach operation in array array[
      'select * from private.whatsapp_quick_replies',
      'insert into private.whatsapp_quick_replies(organization_id,user_id,shortcut,content) select null::uuid,null::uuid,''blocked'',''blocked'' where false',
      'update private.whatsapp_quick_replies set content=''blocked'' where false',
      'delete from private.whatsapp_quick_replies where false'
    ] loop
      begin
        execute operation;
        raise exception 'browser role unexpectedly reached private table';
      exception when insufficient_privilege then null;
      end;
    end loop;
    execute 'reset role';
  end loop;
end;
$$;

select 'whatsapp_personal_quick_replies: all assertions passed';
rollback;
