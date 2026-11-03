begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Nullable additions keep existing desktop publications and the previous API valid.
alter table public.home_publications
  add column mobile_image_url text,
  add column mobile_image_storage_path text,
  add constraint home_publications_mobile_image_pair_check
    check ((mobile_image_url is null) = (mobile_image_storage_path is null));

commit;
