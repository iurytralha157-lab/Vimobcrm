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

## Publicacao com Cloudflare

O modelo recomendado para dominios de clientes e usar um Cloudflare Worker como proxy na frente do app novo.

Fluxo:

Visitante -> Cloudflare Worker -> `app.vimobcrm.com.br` -> Vimob API Go -> Supabase

O Worker nao deve consultar `/v1/public/site/resolve` antes de renderizar. Essa decisao fica com o Next.js, que recebe o dominio original em `X-Forwarded-Host`. Assim evitamos falso `site nao encontrado` quando a API oscila por alguns segundos.

Regras do Worker:

- Enviar todas as requisicoes para `https://app.vimobcrm.com.br`.
- Preservar o dominio do cliente com `X-Forwarded-Host`.
- Responder `/.well-known/vimob-domain-verification` com o token exclusivo gerado para o site.
- Encaminhar HTML de `GET`/`HEAD` com `Cache-Control: no-store`, pois o documento
  transporta a configuracao corrente de consentimento e integracoes.
- Nao cachear formularios, tracking, contatos ou qualquer chamada `POST`.

Para testar, use sempre o dominio real configurado na rota do Cloudflare. O endereco `.workers.dev` nao representa o dominio do cliente e pode nao carregar o site correto.

O codigo base do Worker fica em `deploy/cloudflare-public-site-worker.js` e tambem aparece pronto para copiar dentro da configuracao de site do CRM.
Workers ja publicados nao recebem essa alteracao automaticamente: republique o
codigo gerado em cada dominio durante o rollout e confirme o header
`Cache-Control: no-store` no HTML real.

## Verificacao do dominio

O dominio proprio so participa da resolucao publica depois de `domain_verified = true`.
Ao salvar ou trocar `custom_domain`, a API:

1. remove a verificacao anterior;
2. gera um novo `domain_verification_token`;
3. entrega um Worker com esse token no painel;
4. confirma a posse em `POST /v1/site/domain/verify`, lendo o desafio no dominio real;
5. marca o dominio como verificado apenas quando o valor confere.

A verificacao bloqueia enderecos privados, loopback e link-local antes de fazer a
requisicao externa. O token e uma prova publica de controle do dominio, nao uma
credencial do Cloudflare.

## Resiliencia

As chamadas server-side de dados do site usam revalidacao de 60 segundos. A
resolucao da configuracao usa `revalidate: 0`, para que inclusao ou remocao de
GA, GTM e Search Console apareca na proxima navegacao. Quando uma consulta
publica falha, o servidor tenta usar o ultimo conteudo valido em memoria por ate
24 horas, mas remove do fallback qualquer tracker, pixel, script customizado e
token de verificacao. Se nao existir cache valido, a tela nao exibe erro tecnico
para o visitante: ela mostra estado vazio ou site temporariamente indisponivel.

Assets e consultas de catalogo continuam usando os caches proprios da aplicacao;
o HTML configuravel nao usa cache de borda para evitar reativar uma integracao
removida.
