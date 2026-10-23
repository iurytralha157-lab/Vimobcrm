-- Prepared only; execute separately in a migrated disposable local test DB.
begin;
do $$
begin
  if left(current_database(), length('vimob_contacts_p2_')) <> 'vimob_contacts_p2_' then
    raise exception 'contact import receipt test requires a disposable vimob_contacts_p2_ database';
  end if;
  begin
    insert into private.contact_import_request_receipts (
      organization_id, actor_id, request_key, payload_sha256,
      lead_id, reentry, distribution_outcome, completed_at
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333', repeat('a',64),
      '44444444-4444-4444-8444-444444444444', false, null, now()
    );
    raise exception 'completed receipt incorrectly accepted a NULL outcome';
  exception when check_violation then
    null;
  end;
end;
$$;
rollback;
