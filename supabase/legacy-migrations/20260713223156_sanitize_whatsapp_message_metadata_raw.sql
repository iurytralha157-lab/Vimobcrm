create or replace function public.sanitize_whatsapp_message_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.metadata is not null then
    new.metadata = new.metadata - 'raw';

    if jsonb_typeof(new.metadata -> 'deletion_event') = 'object' then
      new.metadata = jsonb_set(
        new.metadata,
        '{deletion_event}',
        (new.metadata -> 'deletion_event') - 'raw',
        true
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists sanitize_whatsapp_message_metadata_before_write on public.whatsapp_messages;

create trigger sanitize_whatsapp_message_metadata_before_write
before insert or update of metadata on public.whatsapp_messages
for each row
execute function public.sanitize_whatsapp_message_metadata();
