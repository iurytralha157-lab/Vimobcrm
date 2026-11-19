begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Nullable additions preserve existing publications and the previous API.
alter table public.home_publications
  add column dark_image_url text,
  add column dark_image_storage_path text,
  add column dark_mobile_image_url text,
  add column dark_mobile_image_storage_path text,
  add constraint home_publications_dark_image_pair_check
    check ((dark_image_url is null) = (dark_image_storage_path is null)),
  add constraint home_publications_dark_mobile_image_pair_check
    check ((dark_mobile_image_url is null) = (dark_mobile_image_storage_path is null));

commit;
