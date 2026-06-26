update public.users
set whatsapp = phone
where whatsapp is null
  and phone is not null;

revoke update (
  organization_id,
  name,
  avatar_url,
  language,
  phone,
  whatsapp,
  cpf,
  cep,
  endereco,
  numero,
  complemento,
  bairro,
  cidade,
  uf,
  updated_at
) on public.users from authenticated;

alter table public.users
  drop column if exists phone,
  drop column if exists cep,
  drop column if exists endereco,
  drop column if exists numero,
  drop column if exists complemento,
  drop column if exists bairro,
  drop column if exists cidade,
  drop column if exists uf;

grant update (
  organization_id,
  name,
  avatar_url,
  language,
  whatsapp,
  cpf,
  updated_at
) on public.users to authenticated;
