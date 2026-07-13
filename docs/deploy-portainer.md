# Deploy de homologacao no Portainer

Este deploy usa duas imagens:

- `vimob-crm-web`: Next.js em modo `standalone`, porta `3000`.
- `vimob-crm-api`: API Go, porta `8081`.

## Repositorio

- GitHub: `https://github.com/iurytralha157-lab/Vimobcrm`
- Stack recomendada no Portainer Swarm: `deploy/portainer-stack.yml`
- Stack alternativa apenas para Docker Compose standalone: `deploy/portainer-stack.build.yml`

## Fluxo recomendado

1. Configurar as variaveis do GitHub Actions.
2. Fazer push na branch `main`.
3. O GitHub Actions publica imagens no GitHub Container Registry.
4. Criar uma Stack no Portainer usando `deploy/portainer-stack.yml`.
5. Apontar os dominios no proxy/reverse proxy.

Se a tela do Portainer mostrar que o deploy usa `docker stack deploy`, voce esta em Swarm. Nesse caso, use `deploy/portainer-stack.yml`, porque Swarm espera imagens prontas e nao faz build a partir do Compose.

Se quiser testar sem GHCR, use um ambiente Docker Compose standalone apontando para `deploy/portainer-stack.build.yml`. Essa opcao faz o build das imagens no servidor, entao o primeiro deploy demora mais e precisa de mais CPU/RAM.

## Variaveis do GitHub Actions

Em `Settings > Secrets and variables > Actions > Variables`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-chave-publica
NEXT_PUBLIC_VIMOB_API_URL=https://api.vimobcrm.com.br
NEXT_PUBLIC_SITE_URL=https://app.vimobcrm.com.br
```

Essas variaveis entram no build do Next.js. Se trocar a URL da API ou o dominio publico depois, gere uma nova imagem web.

## Variaveis da Stack no Portainer

Configure na Stack, sem commitar valores reais:

```env
VIMOB_WEB_IMAGE=ghcr.io/iurytralha157-lab/vimob-crm-web:latest
VIMOB_API_IMAGE=ghcr.io/iurytralha157-lab/vimob-crm-api:latest

WEB_PORT=3000
API_PUBLIC_PORT=18081
TRAEFIK_NETWORK=public
TRAEFIK_HTTPS_ENTRYPOINT=websecure
TRAEFIK_CERT_RESOLVER=letsencrypt
VIMOB_WEB_DOMAIN=app.vimobcrm.com.br
VIMOB_API_DOMAIN=api.vimobcrm.com.br

NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-chave-publica
NEXT_PUBLIC_VIMOB_API_URL=https://api.vimobcrm.com.br
NEXT_PUBLIC_SITE_URL=https://app.vimobcrm.com.br
APP_PUBLIC_URL=https://app.vimobcrm.com.br
VIMOB_INTERNAL_API_URL=http://api:8081

API_CORS_ALLOWED_ORIGINS=https://app.vimobcrm.com.br
SUPABASE_PROJECT_URL=https://seu-projeto.supabase.co
SUPABASE_JWKS_URL=https://seu-projeto.supabase.co/auth/v1/.well-known/jwks.json
SUPABASE_JWT_ISSUER=https://seu-projeto.supabase.co/auth/v1
SUPABASE_JWT_AUDIENCE=authenticated
SUPABASE_SERVICE_ROLE_KEY=sua-chave-server-side
DATABASE_URL=postgresql://...

RESEND_API_KEY=
RESEND_FROM_EMAIL=Vimob CRM <naoresponde@vimobcrm.com.br>
RESEND_REPLY_TO=contato@vimobcrm.com.br
RESEND_WEBHOOK_SECRET=
EMAIL_ASSET_BASE_URL=https://vimobcrm.com.br
EMAIL_INTERNAL_SECRET=
SUPPORT_EMAIL=contato@vimobcrm.com.br

ASAAS_API_KEY=
ASAAS_BASE_URL=https://api.asaas.com/v3

EVOLUTION_GO_API_URL=https://seu-evolution-go
EVOLUTION_GO_API_KEY=sua-chave-evolution-go
EVOLUTION_GO_WEBHOOK_URL=https://seu-webhook-publico/evolution-go-webhook
EVOLUTION_GO_BACKEND_WEBHOOK_URL=https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go
WHATSAPP_WEBHOOK_PROCESSOR_MODE=edge
WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS=

META_APP_SECRET=segredo-do-app-meta
META_WEBHOOK_VERIFY_TOKEN=token-igual-ao-configurado-no-meta-webhooks
META_GRAPH_VERSION=v25.0
META_GRAPH_BASE_URL=https://graph.facebook.com
```

`EVOLUTION_GO_API_URL` e `EVOLUTION_GO_API_KEY` fazem a API Go criar instancias, consultar QR Code, status e enviar mensagens diretamente no Evo Go. `EVOLUTION_GO_WEBHOOK_URL` e opcional; enquanto o webhook de entrada nao for portado para Go, ele pode apontar para a Function `evolution-go-webhook` existente.

Para um canario reversivel do webhook no backend, mantenha `EVOLUTION_GO_WEBHOOK_URL` apontando para a Edge Function, use `WHATSAPP_WEBHOOK_PROCESSOR_MODE=native_fallback` e informe em `WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS` somente os UUIDs das sessoes autorizadas. Nao use `*` antes de comprovar envio, recebimento, historico e rollback no canario.

No Portainer:

1. `Stacks` -> `Add stack`.
2. Escolher `Repository`.
3. Repository URL: `https://github.com/iurytralha157-lab/Vimobcrm`.
4. Branch: `main`.
5. Compose path:
   - Portainer Swarm: `deploy/portainer-stack.yml`;
   - Docker Compose standalone: `deploy/portainer-stack.build.yml`.
6. Colar as variaveis acima em `Environment variables`.
7. Deploy.

## Dominios

No DNS/proxy:

- `app.vimobcrm.com.br` -> Traefik -> servico `web`, porta interna `3000`.
- `api.vimobcrm.com.br` -> Traefik -> servico `api`, porta interna `8081`.
- `vimobcrm.com.br` e `www.vimobcrm.com.br` podem apontar para o app ou para o site institucional, conforme decisao de DNS.

No Supabase Auth:

- Site URL: `https://app.vimobcrm.com.br`
- Redirect URLs: `https://app.vimobcrm.com.br/**`

## Usar Supabase antigo como producao oficial

Para usar o Supabase antigo como banco oficial do Vimob novo, configure todas as variaveis de Supabase com os dados do projeto antigo:

```env
NEXT_PUBLIC_SUPABASE_URL=https://projeto-antigo.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=chave-publica-do-projeto-antigo
SUPABASE_PROJECT_URL=https://projeto-antigo.supabase.co
SUPABASE_JWKS_URL=https://projeto-antigo.supabase.co/auth/v1/.well-known/jwks.json
SUPABASE_JWT_ISSUER=https://projeto-antigo.supabase.co/auth/v1
SUPABASE_SERVICE_ROLE_KEY=service-role-do-projeto-antigo
DATABASE_URL=postgresql://...
```

Com esse apontamento, leitura, escrita, upload, edicao, exclusao, reset de senha e Auth usam o Supabase antigo normalmente.

## Checklist de verificacao

```bash
curl https://api.vimobcrm.com.br/readyz
```

Depois testar:

- Login.
- Dashboard.
- Pipeline.
- Criar/mover lead.
- Agenda.
- WhatsApp: criar conexao, gerar QR Code e conferir `/readyz` da API.
- WhatsApp/conversas.
- Configuracoes.
- Logs de erro no Super Admin.

## Cuidados

- Nunca subir `.env.local`, senha do banco ou `service_role` no GitHub.
- Se o pacote GHCR ficar privado, configure login no Portainer com um token GitHub com `read:packages`.
- Para homologacao real, manter a API em subdominio separado facilita CORS, logs e rollback.
