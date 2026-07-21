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

Para Web Push, reuse o par VAPID atual sempre que possivel. A API valida se `WEB_PUSH_VAPID_PUBLIC_KEY` e `WEB_PUSH_VAPID_PRIVATE_KEY` pertencem ao mesmo par antes de iniciar e entrega somente a chave publica ao navegador em `/v1/public/push-config`. Assim, a chave VAPID nao fica congelada no build web e a chave privada continua somente no Portainer/segredos da API.

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

FCM_PROJECT_ID=id-do-projeto-firebase
FCM_SERVICE_ACCOUNT_JSON=json-da-service-account-compactado-ou-base64
FCM_SERVICE_ACCOUNT_FILE=

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

`FCM_SERVICE_ACCOUNT_JSON` habilita notificacoes push nativas pelo Firebase Cloud Messaging HTTP v1. Use o JSON da service account como segredo compactado em uma linha ou base64. `FCM_PROJECT_ID` pode ficar vazio se o JSON tiver `project_id`. `FCM_SERVICE_ACCOUNT_FILE` e alternativa para ambientes que montam o arquivo como secret.

`EVOLUTION_GO_API_URL` e `EVOLUTION_GO_API_KEY` fazem a API Go criar instancias, consultar QR Code, status e enviar mensagens diretamente no Evo Go. `EVOLUTION_GO_BACKEND_WEBHOOK_URL` e obrigatoria quando a Evolution esta habilitada e deve apontar para `/v1/whatsapp/webhook/evolution-go` da API Go. Ela e o callback de **todas** as sessoes e pode conter somente `session_id` e `instance_id`; nunca inclua `token`, `apikey` ou `webhook_token`. `EVOLUTION_GO_WEBHOOK_URL` e apenas o receptor interno da Edge Function: quando o processador esta em `edge`/fallback, a API o chama com `x-webhook-token` no header.

Para picos de uso, mantenha o backend com pool pequeno contra o Supabase (`DATABASE_MAX_CONNS=8`, `DATABASE_MIN_CONNS=0`) e controle a pressao dos workers de WhatsApp pelas variaveis `WHATSAPP_*_WORKER_INTERVAL` e `WHATSAPP_*_WORKER_BATCH`. Aumente throughput primeiro pelo batch; reduza intervalo apenas se o banco estiver com folga.

`WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS` controla somente o processador nativo e as configuracoes avancadas do canario. Ele nao controla mais a URL do callback: criacao, recriacao e supervisor sempre usam o ingresso seguro da API. Com a lista vazia e modo `edge`, a Evolution chama a API, a API grava a fila duravel e o worker encaminha o evento para a Edge usando header. Uma lista de UUIDs libera `native_fallback`/`native` apenas para aquelas sessoes; `*` libera o processador nativo para todas.

## Canary e rollback do WhatsApp

Nunca use `latest` no canario. Antes do deploy, registre os dois tags atualmente executados e fixe `VIMOB_API_IMAGE` e `VIMOB_WEB_IMAGE` no mesmo tag imutavel `${github.sha}` publicado pelo workflow. Guarde os tags anteriores como par de rollback; nao misture uma API nova com um web antigo sem uma validacao especifica dessa combinacao.

Para iniciar o canario do processador, mantenha `WHATSAPP_WEBHOOK_PROCESSOR_MODE=native_fallback` e coloque somente o UUID aprovado em `WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS`. O callback permanece na API tanto durante o canario quanto durante o rollback.

O rollback do processador deve ocorrer nesta ordem:

1. Mude `WHATSAPP_WEBHOOK_PROCESSOR_MODE` para `edge`, mantendo a imagem que conhece a fila duravel. Eventos continuam chegando ao backend e passam a ser encaminhados para a Edge via header.
2. Aguarde as filas de inbox e outbox abaixo chegarem a zero. Nao remova a imagem que conhece essas filas enquanto existir trabalho pendente.
3. Esvazie `WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS`; isso desativa o processador nativo, mas nao devolve credenciais para a URL.
4. Confirme que a primeira consulta abaixo nao retorna nenhuma URL com segredo e que as duas filas continuam vazias.
5. Restaure somente uma imagem que mantenha o callback tokenless da API e rejeite autenticacao por query. Imagens anteriores a esse contrato nao sao rollback seguro.
6. Valide `/readyz`, envio, recebimento e historico antes de encerrar o rollback.

Durante o canario, mantenha a acao de falha do update do Swarm em `pause`; nao habilite rollback automatico da imagem da API. A stack fixa atualizacao `start-first`, uma replica por vez e monitor de oito minutos, suficiente para o healthcheck atravessar o retry inicial do banco. O `pause` e intencional: a ordem acima e obrigatoria porque a imagem anterior nao deve receber uma instancia que ainda aponta para o webhook novo.

```sql
select id, instance_name, status
from public.whatsapp_sessions
where provider = 'evolution_go'
  and coalesce(advanced_settings->>'webhook_url', '') ~* '([?&])(webhook_token|apikey|token)=';

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

Se a primeira consulta retornar uma sessao, o corte de seguranca ainda nao terminou: confira a conectividade com a Evolution Go e os logs do supervisor. Se a segunda retornar trabalho pendente, nao troque a imagem da API ate a drenagem. Nunca imprima a URL completa de um webhook legado.

### Corte definitivo das credenciais em URL

Este corte deve ser executado uma unica vez e nesta ordem. Nao aplique a migration antes da convergencia das sessoes: ela possui uma trava proposital e falhara enquanto existir callback ativo fora do backend tokenless.

1. Suba a nova imagem da API no Portainer com `EVOLUTION_GO_BACKEND_WEBHOOK_URL=https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go`. Ainda nao publique a versao endurecida da Edge Function e nao aplique a migration.
2. Confirme `/readyz` e acompanhe o supervisor ate a consulta de URLs com segredo retornar zero. O ingresso da API autentica o token da instancia em memoria, remove campos de credencial do payload antes de gravar a inbox e encaminha para a Edge com `x-webhook-token`.
3. Confirme que inbox e outbox nao possuem itens parados e valide recebimento em pelo menos uma sessao conectada e uma desconectada/reconectada.
4. Aplique `supabase/migrations/20260719015030_complete_whatsapp_webhook_token_cutover.sql`. Ela rotaciona os tokens de webhook, remove campos de autenticacao dos payloads historicos da inbox, remove o marcador legado e instala constraints que impedem novas credenciais tanto nas URLs armazenadas quanto no payload duravel.
5. Publique `supabase/functions/evolution-go-webhook`. A funcao endurecida rejeita `token`, `apikey` e `webhook_token` na query em qualquer metodo; o worker interno continua autenticando pelo header.
6. Repita as consultas de URL e filas, verifique os logs sem imprimir query strings e execute o teste funcional de envio, recebimento, historico, QR Code e reconexao.

Se qualquer passo falhar, pare antes do seguinte. O rollback seguro mantem a nova API e o callback tokenless; nunca restaure uma imagem que volte a gravar segredo na URL.

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

Se `WEB_PUSH_VAPID_PUBLIC_KEY` ou `WEB_PUSH_VAPID_PRIVATE_KEY` estiverem ausentes, malformadas ou nao pertencerem ao mesmo par, a API falha ao iniciar em vez de subir com push quebrado. Se a chave privada antiga tiver sido perdida, gere um novo par, configure as duas chaves correspondentes na API/stack e publique a nova API; nao e necessario reconstruir a imagem web somente por causa da rotacao VAPID. Usuarios com subscriptions antigas sao reinscritos automaticamente quando abrirem o app novamente. Para push nativo do app, configure `FCM_SERVICE_ACCOUNT_JSON` ou `FCM_SERVICE_ACCOUNT_FILE`; `FCM_SERVER_KEY` e legado e nao deve ser usado em deploy novo.

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
