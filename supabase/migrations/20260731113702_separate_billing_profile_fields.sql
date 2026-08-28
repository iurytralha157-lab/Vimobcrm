alter table public.organizations
  add column if not exists billing_legal_name text,
  add column if not exists billing_tax_id text,
  add column if not exists billing_email text,
  add column if not exists billing_phone text,
  add column if not exists billing_postal_code text,
  add column if not exists billing_address text,
  add column if not exists billing_address_number text,
  add column if not exists billing_address_complement text,
  add column if not exists billing_neighborhood text,
  add column if not exists billing_city text,
  add column if not exists billing_state text;

update public.organizations
set
  billing_legal_name = coalesce(
    nullif(btrim(billing_legal_name), ''),
    nullif(btrim(razao_social), ''),
    nullif(btrim(name), '')
  ),
  billing_tax_id = coalesce(
    nullif(btrim(billing_tax_id), ''),
    nullif(btrim(cnpj), '')
  ),
  billing_email = coalesce(
    nullif(btrim(billing_email), ''),
    nullif(btrim(email), '')
  ),
  billing_phone = coalesce(
    nullif(btrim(billing_phone), ''),
    nullif(btrim(telefone), ''),
    nullif(btrim(whatsapp), '')
  ),
  billing_postal_code = coalesce(
    nullif(btrim(billing_postal_code), ''),
    nullif(btrim(cep), '')
  ),
  billing_address = coalesce(
    nullif(btrim(billing_address), ''),
    nullif(btrim(endereco), '')
  ),
  billing_address_number = coalesce(
    nullif(btrim(billing_address_number), ''),
    nullif(btrim(numero), '')
  ),
  billing_address_complement = coalesce(
    nullif(btrim(billing_address_complement), ''),
    nullif(btrim(complemento), '')
  ),
  billing_neighborhood = coalesce(
    nullif(btrim(billing_neighborhood), ''),
    nullif(btrim(bairro), '')
  ),
  billing_city = coalesce(
    nullif(btrim(billing_city), ''),
    nullif(btrim(cidade), '')
  ),
  billing_state = upper(coalesce(
    nullif(btrim(billing_state), ''),
    nullif(btrim(uf), '')
  ));

comment on column public.organizations.billing_tax_id is
  'CPF ou CNPJ usado exclusivamente no faturamento; nao altera o cadastro operacional da organizacao.';
comment on column public.organizations.billing_email is
  'Contato financeiro usado para checkout, faturas e comunicacoes de cobranca.';
comment on column public.organizations.billing_address is
  'Endereco fiscal separado do endereco comercial exibido no CRM.';
