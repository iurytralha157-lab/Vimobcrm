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
VIMOB_NEXT_PUBLIC_VAPID_PUBLIC_KEY=chave-publica-vapid
```

Essas variaveis entram no build do Next.js. Se trocar a URL da API, o dominio publico ou a chave publica VAPID depois, gere uma nova imagem web.

Para Web Push, reuse o par VAPID atual sempre que possivel. A chave publica do build web (`VIMOB_NEXT_PUBLIC_VAPID_PUBLIC_KEY`) deve ser a mesma chave publica configurada na API/stack (`WEB_PUSH_VAPID_PUBLIC_KEY`). A chave privada correspondente deve ficar somente no Portainer/segredos da API como `WEB_PUSH_VAPID_PRIVATE_KEY`.

## Variaveis da Stack no Portainer

Configure na Stack, sem commitar valores reais:

```env
VIMOB_WEB_IMAGE=ghcr.io/iurytralha157-lab/vimob-crm-web:<github.sha>
VIMOB_API_IMAGE=ghcr.io/iurytralha157-lab/vimob-crm-api:<github.sha>

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
DATABASE_MAX_CONNS=8
DATABASE_MIN_CONNS=0
DATABASE_MAX_CONN_IDLE_TIME=2m

RESEND_API_KEY=
RESEND_FROM_EMAIL=Vimob CRM <naoresponde@vimobcrm.com.br>
RESEND_REPLY_TO=contato@vimobcrm.com.br
RESEND_WEBHOOK_SECRET=
EMAIL_ASSET_BASE_URL=https://vimobcrm.com.br
EMAIL_INTERNAL_SECRET=
SUPPORT_EMAIL=contato@vimobcrm.com.br

WEB_PUSH_VAPID_PUBLIC_KEY=chave-publica-vapid
WEB_PUSH_VAPID_PRIVATE_KEY=chave-privada-vapid
WEB_PUSH_VAPID_SUBJECT=mailto:contato@vimobcrm.com.br

ASAAS_API_KEY=
ASAAS_BASE_URL=https://api.asaas.com/v3

EVOLUTION_GO_API_URL=https://seu-evolution-go
EVOLUTION_GO_API_KEY=sua-chave-evolution-go
EVOLUTION_GO_WEBHOOK_URL=https://seu-projeto.supabase.co/functions/v1/evolution-go-webhook
EVOLUTION_GO_BACKEND_WEBHOOK_URL=https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go
WHATSAPP_WEBHOOK_PROCESSOR_MODE=native_fallback
WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS=13eea7e8-a74f-4bfb-bb36-024e3d26ccc9
WHATSAPP_OUTBOX_WORKER_INTERVAL=2s
WHATSAPP_OUTBOX_WORKER_BATCH=10
WHATSAPP_WEBHOOK_WORKER_INTERVAL=2s
WHATSAPP_WEBHOOK_WORKER_BATCH=10
WHATSAPP_SESSION_SUPERVISOR_INTERVAL=2m
WHATSAPP_SESSION_SUPERVISOR_BATCH=3

META_APP_SECRET=segredo-do-app-meta
META_WEBHOOK_VERIFY_TOKEN=token-igual-ao-configurado-no-meta-webhooks
META_GRAPH_VERSION=v25.0
META_GRAPH_BASE_URL=https://graph.facebook.com
```

`EVOLUTION_GO_API_URL` e `EVOLUTION_GO_API_KEY` fazem a API Go criar instancias, consultar QR Code, status e enviar mensagens diretamente no Evo Go. `EVOLUTION_GO_WEBHOOK_URL` e a rota legada da Edge Function, usada por todas as sessoes fora do rollout. `EVOLUTION_GO_BACKEND_WEBHOOK_URL` deve apontar para `/v1/whatsapp/webhook/evolution-go` da API Go e so e usada por sessoes allowlisted. Mantenha `WHATSAPP_WEBHOOK_PROCESSOR_MODE=native_fallback` durante o canario; use `native` somente depois de eliminar todos os eventos ainda dependentes da Edge Function.

Para picos de uso, mantenha o backend com pool pequeno contra o Supabase (`DATABASE_MAX_CONNS=8`, `DATABASE_MIN_CONNS=0`) e controle a pressao dos workers de WhatsApp pelas variaveis `WHATSAPP_*_WORKER_INTERVAL` e `WHATSAPP_*_WORKER_BATCH`. Aumente throughput primeiro pelo batch; reduza intervalo apenas se o banco estiver com folga.

`WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS` e o gate unico da criacao, recriacao, supervisor e processador. Vazio e o padrao seguro: sessoes novas/recriadas continuam na Edge, o supervisor nao altera URL nem assinaturas e todo evento que eventualmente chegar ao backend ainda e encaminhado para a Edge; a consulta e a atualizacao de status continuam funcionando. Para o primeiro canario, use somente `13eea7e8-a74f-4bfb-bb36-024e3d26ccc9`: apenas essa sessao recebe a URL do backend e pode executar `native_fallback`. Uma lista de UUIDs separados por virgula libera apenas aquelas sessoes; `*` libera todas explicitamente e so deve ser usado depois da validacao completa dos canarios. Um UUID invalido, `*` misturado com UUIDs ou rollout sem `EVOLUTION_GO_BACKEND_WEBHOOK_URL` impede a API de iniciar.

## Canary e rollback do WhatsApp

Nunca use `latest` no canario. Antes do deploy, registre os dois tags atualmente executados e fixe `VIMOB_API_IMAGE` e `VIMOB_WEB_IMAGE` no mesmo tag imutavel `${github.sha}` publicado pelo workflow. Guarde os tags anteriores como par de rollback; nao misture uma API nova com um web antigo sem uma validacao especifica dessa combinacao.

Para iniciar o canario, mantenha `WHATSAPP_WEBHOOK_PROCESSOR_MODE=native_fallback` e coloque somente o UUID aprovado em `WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS`. Quando o supervisor configurar a URL do backend, ele grava `advanced_settings.webhook_rollout_managed=true` apenas nessa sessao.

O rollback deve ocorrer nesta ordem:

1. Mude `WHATSAPP_WEBHOOK_PROCESSOR_MODE` para `edge`, mantendo o UUID do canario na allowlist e sem trocar as imagens. Eventos que ainda chegarem ao backend passam pela fila duravel antes de voltar ao receptor legado.
2. Aguarde as filas de inbox e outbox abaixo chegarem a zero. Nao remova a imagem que conhece essas filas enquanto existir trabalho pendente.
3. Esvazie `WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS` e aguarde o supervisor devolver toda sessao marcada para `EVOLUTION_GO_WEBHOOK_URL`. Sessoes comuns, sem a marca, nunca recebem alteracao de webhook por esse procedimento.
4. Confirme que a primeira consulta abaixo nao retorna nenhuma sessao e que as duas filas continuam vazias. O supervisor remove a marca somente depois que a Evolution Go aceita a configuracao legada.
5. Somente entao restaure `VIMOB_API_IMAGE` e `VIMOB_WEB_IMAGE` para o par de digests anterior.
6. Valide `/readyz`, envio, recebimento e historico antes de encerrar o rollback.

Durante o canario, mantenha a acao de falha do update do Swarm em `pause`; nao habilite rollback automatico da imagem da API. A stack fixa atualizacao `start-first`, uma replica por vez e monitor de oito minutos, suficiente para o healthcheck atravessar o retry inicial do banco. O `pause` e intencional: a ordem acima e obrigatoria porque a imagem anterior nao deve receber uma instancia que ainda aponta para o webhook novo.

```sql
select
  id,
  instance_name,
  coalesce(advanced_settings->>'webhook_rollout_managed', 'false') = 'true' as rollout_managed,
  case
    when coalesce(advanced_settings->>'webhook_url', '') like 'https://api.vimobcrm.com.br/%' then 'backend'
    when coalesce(advanced_settings->>'webhook_url', '') like '%supabase.co/functions/%' then 'edge'
    else 'other_or_empty'
  end as webhook_target
from public.whatsapp_sessions
where coalesce(advanced_settings->>'webhook_rollout_managed', 'false') = 'true';

select 'inbox' as queue, status, count(*)
from public.whatsapp_webhook_inbox
where status in ('pending', 'retry', 'processing')
group by status
union all
select 'outbox', status, count(*)
from public.whatsapp_outbox
where status in ('pending', 'retry', 'processing')
group by status;
```

Se a primeira consulta continuar retornando uma sessao, ou se a segunda retornar qualquer fila pendente, nao reverta a imagem da API: confira a conectividade com a Evolution Go e os logs do supervisor/workers. Uma URL backend ainda ativa ou trabalho duravel nao drenado com a imagem antiga pode interromper o recebimento/envio. Nunca imprima a URL completa do webhook: ela pode conter credenciais em ambientes legados.

A imagem da API usa `/healthz` como liveness depois de um periodo inicial de cinco minutos, compativel com o retry de conexao inicial ao banco. O gate operacional do deploy continua sendo `/readyz`, que tambem confirma acesso ao Postgres. Nao considere o canario pronto apenas porque o container esta `healthy`.

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

Se `WEB_PUSH_VAPID_PUBLIC_KEY` ou `WEB_PUSH_VAPID_PRIVATE_KEY` estiverem ausentes, a stack/API deve falhar em vez de subir com push quebrado. Se a chave privada antiga tiver sido perdida, gere um novo par VAPID, configure a publica no build web e na stack, configure a privada na API, e gere nova imagem web. Usuarios com subscriptions antigas so serao reinscritos quando abrirem o app novamente.

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
- Canary Vetter: confirmar exatamente as tres conversas historicas e 175 mensagens do lead `2136b3b3-5a1a-4983-b4ff-50746fa2e341`, sem misturar mensagens de outro lead.
- Canary Vetter: enviar para o telefone canonico do lead (`5522999922093`), receber uma resposta, reagir, anexar uma midia e recarregar a pagina para provar que nenhum item some.
- Canary Vetter: autenticar como um segundo corretor sem atribuicao e como usuario de outra organizacao; ambos devem receber `404/403` e nunca metadados, links de midia ou contagens do historico.
- Configuracoes.
- Logs de erro no Super Admin.

## Cuidados

- Nunca subir `.env.local`, senha do banco ou `service_role` no GitHub.
- Se o pacote GHCR ficar privado, configure login no Portainer com um token GitHub com `read:packages`.
- Para homologacao real, manter a API em subdominio separado facilita CORS, logs e rollback.
