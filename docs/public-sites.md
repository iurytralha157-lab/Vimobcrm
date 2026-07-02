# Sites publicos Vimob

## Objetivo

Os sites publicos nao devem consultar Supabase diretamente no navegador. O fluxo novo e:

Visitante -> Next.js web -> Vimob API Go -> Supabase

Isso permite cache no servidor, contrato publico controlado e uma tela de fallback quando a API ou o banco estiverem instaveis.

## Rotas publicas

- `/` em dominio proprio cadastrado no site.
- `/imoveis`
- `/imoveis/[codigo]`
- `/imovel/[code]`
- `/sobre`
- `/contato`
- `/favoritos`
- `/sites/[slug]` para publicacao por subdominio/slug dentro do dominio principal.

## Contrato usado no backend

- `GET /v1/public/site/resolve?domain=...`
- `GET /v1/public/site/data?organization_id=...&endpoint=home`
- `GET /v1/public/site/data?organization_id=...&endpoint=properties`
- `GET /v1/public/site/data?organization_id=...&endpoint=property&property_code=...`
- `GET /v1/public/site/menu-items?organization_id=...`
- `GET /v1/public/site/search-filters?organization_id=...`
- `POST /v1/public/site/contact`
- `POST /v1/public/tracking/events`

## Deploy e DNS

1. O dominio do cliente deve apontar para o deploy do Next.js web, nao para Supabase.
2. A API Go deve estar publica ou acessivel pelo servidor web.
3. Configure `VIMOB_API_URL` no servidor Next para o endereco interno/publico da API.
4. Configure `NEXT_PUBLIC_VIMOB_API_URL` para o endereco publico da API usado por contato e tracking no navegador.
5. Cadastre `custom_domain`, `subdomain`, `is_active = true` e `domain_verified = true` em `organization_sites`.
6. Publique imoveis com `published_on_site = true` e `status = 'active'`.

## Resiliencia

As chamadas server-side do site usam revalidacao de 60 segundos. Quando uma consulta publica falha, a tela nao exibe erro tecnico para o visitante: ela mostra estado vazio ou site temporariamente indisponivel.

Para alta disponibilidade, colocar Cloudflare/CDN na frente do Next ajuda a segurar HTML e assets quando houver pico de acesso.
