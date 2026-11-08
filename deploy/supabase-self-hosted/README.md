# Migração emergencial do Supabase Vimob

Este diretório contém o material operacional para migrar o projeto gerenciado
`iemalzlfnbouobyjwlwi` para uma instalação self-hosted sem levar credenciais
para o Git.

## Snapshot de origem

Capturado em 2026-08-09 12:41 UTC:

- PostgreSQL 17.6;
- banco: 172.163.214.483 bytes (aprox. 160,3 GiB);
- Auth: 177 usuários;
- Storage: 7 buckets, 522.510 objetos e 242.773.678.474 bytes
  (aprox. 226,1 GiB);
- Edge Functions: 81 ativas;
- Cron: 12 jobs, 11 ativos;
- Vault: 14 segredos.

O computador de desenvolvimento tem somente 103 GiB livres. O dump não deve
ser executado nele. Faça a exportação diretamente no servidor de destino.

## Infraestrutura mínima para esta janela

Para a migração emergencial, use PostgreSQL 17 e reserve, no mínimo:

- 16 vCPU;
- 64 GiB de RAM;
- 1 TiB de NVMe quando o Storage usar um backend S3 separado;
- 2 TiB de NVMe quando os objetos também ficarem no mesmo host;
- backup externo fora do servidor.

Os valores acima são um piso operacional do Vimob, não os mínimos genéricos do
Supabase. O banco restaurado, o dump lógico temporário, índices e WAL precisam
caber ao mesmo tempo.

Use o Docker Compose oficial do Supabase e registre o commit exato instalado:

```sh
git rev-parse HEAD
```

Não acompanhe `master` automaticamente em produção. A pilha self-hosted está
em transição para PostgreSQL 17 e Envoy. Termine TLS em Caddy, Nginx ou Traefik
e mantenha somente a porta HTTPS pública.

Configuração de URL esperada, usando o domínio definitivo escolhido:

```dotenv
SUPABASE_PUBLIC_URL=https://supabase.vimobcrm.com.br
API_EXTERNAL_URL=https://supabase.vimobcrm.com.br/auth/v1
SITE_URL=https://app.vimobcrm.com.br
ADDITIONAL_REDIRECT_URLS=https://app.vimobcrm.com.br/reset-password,https://app.vimobcrm.com.br/login?emailConfirmation=success
```

### Auth: SMTP e template de recuperação

O bloco `[auth.email.template.recovery]` de `supabase/config.toml` configura
somente o Supabase CLI local. Commitar `supabase/templates/recovery.html` não
altera o Auth self-hosted nem o projeto gerenciado.

Um e-mail com assunto `Reset Your Password`, corpo `Follow this link...` ou a
alternativa `enter the code` é evidência de fallback do GoTrue. Nesse estado, o
cutover do template falhou mesmo que SMTP e remetente estejam funcionando.

No self-hosted atual, o GoTrue não lê templates diretamente de volumes
montados. O arquivo precisa ser servido por HTTP e a URL deve responder a um
`GET` feito de dentro da rede do serviço `auth`. A URL não precisa ser pública;
um `templates-server` privado na mesma rede Docker é suficiente. Se a busca
falhar ou o conteúdo não for um template Go válido, o Auth usa o template
padrão, por isso a disponibilidade desse endpoint faz parte do cutover.

Use `auth-email.env.example` como checklist e mescle os valores no `.env`
operacional da stack oficial; não use o arquivo de exemplo como fonte de
segredos. A linha abaixo representa apenas o conjunto mínimo conhecido pelo
repositório.
Antes de alterar produção, leia o valor vigente e **mescle** essas duas URLs com
todas as entradas já configuradas; nunca substitua a allowlist inteira. O
redirect de `/login?emailConfirmation=success` é usado pela confirmação e pelo
reenvio do onboarding público e deve permanecer autorizado.

```dotenv
AUTH_EMAIL_TEMPLATES_DIR=/opt/supabase/docker/volumes/templates
SMTP_ADMIN_EMAIL=naoresponde@vimobcrm.com.br
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=<segredo-no-cofre>
SMTP_SENDER_NAME=Vimob CRM
SITE_URL=https://app.vimobcrm.com.br
ADDITIONAL_REDIRECT_URLS=https://app.vimobcrm.com.br/reset-password,https://app.vimobcrm.com.br/login?emailConfirmation=success
```

Para Resend, `SMTP_PASS` é uma chave com permissão de envio para o domínio
remetente verificado. Insira-a diretamente no ambiente operacional; não a envie
em chat, Git ou logs. A porta 587 usa STARTTLS e é aceita pelo Resend. O guia
Supabase do provedor também mostra 465 (TLS implícito), mas essa porta é
bloqueada por padrão na Hetzner Cloud. Confirme conexão e TLS verificado a partir
do ambiente real antes de recriar o Auth; trocar de porta não comprova envio.
Referências: [Resend SMTP](https://resend.com/docs/send-with-smtp) e
[Hetzner](https://docs.hetzner.com/cloud/servers/faq/#why-can-i-not-send-any-mails-from-my-server).

Em homologação Cloud, configure Custom SMTP no projeto exclusivo e use o mesmo
HTML de `supabase/templates/recovery.html` no template de reset. Os links legais
usam `SiteURL`; CTA e fallback de recuperação usam `ConfirmationURL` sem
reconstruir o endereço. O Auth verifica o token PKCE em `/auth/v1/verify` e
redireciona para o `redirect_to` autorizado de `/reset-password`. O código deve
ser trocado no mesmo navegador que iniciou a solicitação, pois o verifier PKCE
fica nesse navegador. A mudança local não instala o template em nenhum Auth.

Não substitua esse caminho por `RedirectTo?token_hash=...` com `verifyOtp` POST:
nesse contrato o Auth emite método `otp`, enquanto o Vimob exige o método
assinado `recovery` para a troca de senha. Não trate qualquer OTP como prova de
recuperação. Uma solicitação feita no navegador interno e aberta no Chrome não
valida o fluxo PKCE; faça solicitação e abertura no mesmo navegador e perfil.

O envio administrativo de recuperação usa o Auth sem um verifier do navegador
destinatário. Ao abrir esse link por fragmento, o Vimob valida o access token
no Auth e renova o par em memória antes de gravar a sessão do navegador. O Auth
precisa devolver a mesma conta e sessão com o método `recovery`. Se o navegador
já estiver autenticado em outra conta, use um perfil separado ou saia dessa
conta antes de reabrir o link. Solicite outro link se ele já tiver expirado.

O override implantável é
`deploy/supabase-self-hosted/docker-compose.vimob-auth-email.yml`. Ele preserva
os mapeamentos SMTP/URL, acrescenta assunto e template de recovery e sobe um
`templates-server` privado, sem porta publicada. A imagem do Caddy está fixada
por versão e digest; atualizações devem passar por revisão explícita.

Antes de validar o Compose, instale exatamente o arquivo versionado no diretório
definido por `AUTH_EMAIL_TEMPLATES_DIR`:

```sh
install -d -m 0755 /opt/supabase/docker/volumes/templates
install -m 0444 /caminho/do/checkout/supabase/templates/recovery.html \
  /opt/supabase/docker/volumes/templates/recovery.html
```

Na raiz da stack oficial, valide e aplique o override. `config --quiet` evita
imprimir `SMTP_PASS` nos logs; não publique a saída integral de `config`:

```sh
docker compose \
  -f docker-compose.yml \
  -f /caminho/do/checkout/deploy/supabase-self-hosted/docker-compose.vimob-auth-email.yml \
  --env-file .env \
  config --quiet

docker compose \
  -f docker-compose.yml \
  -f /caminho/do/checkout/deploy/supabase-self-hosted/docker-compose.vimob-auth-email.yml \
  --env-file .env \
  up -d --force-recreate templates-server auth
```

Um simples `restart` não incorpora variáveis novas: `auth` precisa ser recriado.
Antes do canário, faça o readback sem expor as credenciais SMTP:

```sh
AUTH_CONTAINER_ID="$(docker compose \
  -f docker-compose.yml \
  -f /caminho/do/checkout/deploy/supabase-self-hosted/docker-compose.vimob-auth-email.yml \
  --env-file .env \
  ps -q auth)"
# Interrompa se houver zero ou mais de um ID. Não escolha por grep/head:
# confirme projeto, serviço e imagem da stack antes de inspecionar o container.
docker inspect "$AUTH_CONTAINER_ID" \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^GOTRUE_MAILER_(TEMPLATES|SUBJECTS)_RECOVERY='

docker compose \
  -f docker-compose.yml \
  -f /caminho/do/checkout/deploy/supabase-self-hosted/docker-compose.vimob-auth-email.yml \
  --env-file .env \
  exec -T templates-server \
  curl --fail --silent --show-error http://127.0.0.1/recovery.html \
  > /tmp/vimob-recovery-served.html

sha256sum /tmp/vimob-recovery-served.html
sha256sum /opt/supabase/docker/volumes/templates/recovery.html
grep -F '{{ .ConfirmationURL }}' /tmp/vimob-recovery-served.html
grep -F '{{ .SiteURL }}' /tmp/vimob-recovery-served.html
! grep -F '{{ .TokenHash }}' /tmp/vimob-recovery-served.html
```

Os dois SHA-256 devem ser iguais. O endpoint
`http://templates-server/recovery.html` é um contrato de rede: não use `file://`
nem `localhost` no valor entregue ao Auth. Desative link tracking/click
rewriting no provedor SMTP para não alterar o link de recuperação.
Ao compartilhar diagnóstico, não copie logs brutos filtrados por `recover` ou
`mail`: essas linhas ainda podem conter e-mail, token ou URL de recuperação.
Reporte somente horário, código/status, contagens e presença das configurações;
nunca imprima `Config.Env` completo ou `SMTP_PASS`.

Faça um canário com uma conta dedicada antes de liberar produção:

1. Solicitar uma única recuperação em `https://app.vimobcrm.com.br/login` no
   navegador e perfil em que o e-mail será aberto; não usar outro navegador,
   perfil ou janela anônima para concluir a troca PKCE.
2. Confirmar remetente/domínio, assunto, logo compacto, layout claro sem
   cartão e botão laranja no e-mail recebido, todo o texto em português e
   ausência das frases de fallback
   `Reset Your Password`, `Follow this link` e `enter the code`, inclusive nos
   logs do Auth.
3. Confirmar somente origem, caminho e nomes dos parâmetros, sem copiar o
   token: o destino do botão deve ser o `/auth/v1/verify` do Auth configurado,
   com `token`, `type=recovery` e `redirect_to` para
   `https://app.vimobcrm.com.br/reset-password`. Não reconstruir esse endereço
   nem permitir que o provedor SMTP o reescreva. Após a verificação, o retorno
   deve chegar a `/reset-password?code=...` para a troca PKCE nesse navegador.
4. Abrir o link uma vez no mesmo navegador/perfil, definir uma senha nova e validar login com ela; a senha
   anterior deve falhar e a reutilização do link deve ser recusada.
5. Só então executar os canários restantes de Auth. Se qualquer etapa falhar,
   interromper o cutover e manter a origem ativa.

### Auth: sessões e limites de tentativas

O código da API Go consulta `auth.sessions` antes de resolver a organização e
as permissões de uma requisição de usuário. Uma sessão revogada recebe 401.
Uma falha nessa consulta retorna 503. Confirme a leitura de `auth.sessions`
pelo papel de `DATABASE_URL` na stack de destino e teste sessões ativas e
revogadas antes de publicar a API. Entradas autenticadas por chave de API,
webhooks e workers continuam usando suas credenciais próprias. Na Data API do
Supabase, o isolamento depende dos grants e das políticas RLS.

Em Configurações, a API exige a senha atual da conta e valida o identificador
retornado pelo Supabase Auth. O papel de `DATABASE_URL` precisa ler o e-mail
canônico em `auth.users`. A sessão temporária usada para a confirmação
precisa ser encerrada antes de a API atualizar a senha. A recuperação por link
continua usando a sessão de recuperação. Publique a API e o formulário
compatível na mesma janela e drene as réplicas antigas da API. Formulários
abertos na versão anterior precisam ser recarregados para enviar a senha atual.
Se for necessário voltar à API anterior, suspenda a rota de troca de senha
até restabelecer a verificação. A recuperação fica indisponível nesse intervalo.

O endpoint direto `PUT /auth/v1/user` do GoTrue segue a configuração da
própria stack. Verifique na versão implantada se
`GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD` está habilitada e
teste em ambiente isolado a recusa de uma troca sem senha atual em contas
com senha, a criação de senha em contas sem senha e a recuperação por link.
Esta alteração no CRM não ativa a opção no GoTrue.

O Auth do Supabase possui [limites para `/auth/v1/token`, envio de e-mail e
verificação](https://supabase.com/docs/guides/auth/rate-limits). O repositório oferece o overlay **opcional**
`docker-compose.vimob-auth-rate-limits.yml`, com valores obrigatórios em
`auth-email.env.example`. Nenhum valor foi escolhido para a stack ativa: a
topologia do gateway, o cabeçalho de IP confiável e o volume normal por IP ainda
precisam de readback. Antes de incluir esse overlay:

1. Confirme que o gateway remove o cabeçalho vindo do cliente e grava nele o IP
   verificado. `GOTRUE_RATE_LIMIT_HEADER` não pode confiar em um
   `X-Forwarded-For` encaminhado sem limpeza.
2. Meça o tráfego de login, refresh e recuperação, inclusive usuários atrás do
   mesmo NAT, para definir limites sem bloquear acessos legítimos.
3. Valide a composição com `docker compose config --quiet`, sem imprimir a
   configuração inteira com segredos. Faça readback apenas dos quatro nomes de
   variável do overlay, sem valores de SMTP ou chaves.
4. Em ambiente isolado, teste 429 após o limite, resposta pública genérica na
   recuperação para e-mail existente e inexistente, login normal após a janela e
   revogação global de sessões. Repita com conta dedicada em canário antes de
   considerar o ajuste ativo em produção.

Este checkout local não comprova os limites nem os privilégios da stack que
está executando o CRM.

### Convites provisórios: ordem obrigatória do rollout

A migration
`supabase/migrations/20260920143000_harden_invitation_provisional_auth_profiles.sql`
torna inativos perfis criados por convite até o aceite transacional. Por isso,
ela **não pode anteceder a API compatível**: a API antiga interpreta qualquer
linha de `auth.users` como conta pronta para login, enquanto o cliente expulsa
perfis inativos. Aplicar o SQL primeiro recria exatamente o bloqueio que esta
correção elimina.

Ordem segura:

1. Publicar uma imagem imutável da API que contenha a classificação
   `admin_invitation`, a retomada de identidade provisória e o lock de aceite.
2. Drenar as réplicas antigas e comprovar que todas executam o mesmo SHA. Se
   isso não puder ser comprovado, pausar criação, reenvio e aceite de convites
   durante a janela.
3. Antes do SQL, ler o trigger esperado. Em restores self-hosted, a ausência
   completa do trigger canônico é reparada pela migration depois de substituir
   a função. Se um trigger chamado `on_auth_user_created` existir desabilitado,
   com predicado, evento ou função divergente, a migration falha de propósito:

```sql
select
  trigger.tgname,
  trigger.tgenabled,
  procedure_namespace.nspname as function_schema,
  procedure.proname as function_name,
  pg_catalog.pg_get_expr(trigger.tgqual, trigger.tgrelid) as when_predicate,
  pg_catalog.pg_get_triggerdef(trigger.oid) as trigger_definition
from pg_catalog.pg_trigger as trigger
join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
join pg_catalog.pg_namespace as relation_namespace on relation_namespace.oid = relation.relnamespace
join pg_catalog.pg_proc as procedure on procedure.oid = trigger.tgfoid
join pg_catalog.pg_namespace as procedure_namespace on procedure_namespace.oid = procedure.pronamespace
where relation_namespace.nspname = 'auth'
  and relation.relname = 'users'
  and trigger.tgname = 'on_auth_user_created'
  and trigger.tgisinternal = false;
```

4. Pausar criação, reenvio e aceite de convites e drenar requisições em voo.
   Mantenha esses três writers pausados desde antes do snapshot até o readback
   com `mismatch_count = 0`; sem essa janela fechada, o CSV não é um ledger
   exato do `UPDATE`.
5. Gerar um snapshot dos IDs que o backfill pode inativar. Execute a consulta
   abaixo com acesso administrativo somente leitura, exporte o resultado em CSV
   para o cofre de artefatos da mudança e registre contagem e SHA-256 do arquivo.
   Não prossiga sem revisar a lista; ela é o ledger exato para readback e eventual
   rollback coordenado:

```sql
select
  profile.id as user_id,
  profile.is_active as was_active,
  case
    when btrim(coalesce(auth_user.raw_app_meta_data ->> 'provisioning_source', '')) = 'admin_invitation'
      then 'admin_invitation'
    else 'native_invite'
  end as marker_kind,
  btrim(coalesce(auth_user.raw_app_meta_data ->> 'invitation_id', '')) as invitation_id
from public.users as profile
join auth.users as auth_user on auth_user.id = profile.id
where coalesce(profile.is_active, false) = true
  and profile.organization_id is null
  and coalesce(lower(nullif(btrim(profile.role), '')), 'user') = 'user'
  and auth_user.deleted_at is null
  and not exists (
    select 1 from public.organization_members as membership
    where membership.user_id = auth_user.id
  )
  and not exists (
    select 1 from public.organizations as organization
    where organization.created_by = auth_user.id
  )
  and not exists (
    select 1 from public.onboarding_requests as onboarding_request
    where onboarding_request.user_id = auth_user.id
  )
  and not exists (
    select 1 from public.legal_consents as consent
    where consent.user_id = auth_user.id
  )
  and (
    (
      btrim(coalesce(auth_user.raw_app_meta_data ->> 'provisioning_source', '')) = 'admin_invitation'
      and btrim(coalesce(auth_user.raw_user_meta_data ->> 'provisioning_source', '')) = ''
      and btrim(coalesce(auth_user.raw_app_meta_data ->> 'invitation_id', ''))
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    or (
      btrim(coalesce(auth_user.raw_app_meta_data ->> 'provisioning_source', '')) = ''
      and btrim(coalesce(auth_user.raw_user_meta_data ->> 'provisioning_source', '')) = ''
      and btrim(coalesce(auth_user.raw_app_meta_data ->> 'invitation_id', '')) = ''
      and btrim(coalesce(auth_user.raw_user_meta_data ->> 'invitation_id', '')) = ''
      and auth_user.invited_at is not null
      and auth_user.email_confirmed_at is null
      and auth_user.last_sign_in_at is null
      and coalesce(auth_user.encrypted_password, '') = ''
    )
  )
order by profile.id;
```

6. Validar a migration completa primeiro contra um clone descartável/full-chain
   em PostgreSQL 17.x (preferencialmente o mesmo minor do destino, hoje 17.6).
   PostgreSQL 15 não substitui esse gate de compatibilidade.
7. Aplicar a migration uma única vez pelo runner oficial e registrar o
   readback. Não aplicar manualmente apenas trechos do arquivo.
8. Repetir a consulta do trigger e confirmar exatamente uma linha, `tgenabled`
   em `O` ou `A`, função
   `public.handle_new_auth_user`, `when_predicate` nulo e definição
   `AFTER INSERT ... FOR EACH ROW`. Importe o CSV em uma tabela temporária e
   faça o post-check objetivo:

```sql
create temp table invitation_profile_backfill_snapshot (
  user_id uuid primary key,
  was_active boolean not null,
  marker_kind text not null,
  invitation_id text not null
) on commit preserve rows;

-- No psql, importe o mesmo arquivo guardado no passo 5:
-- \copy invitation_profile_backfill_snapshot from '/caminho/seguro/snapshot.csv' with (format csv, header true)

select
  count(*) as snapshot_count,
  count(*) filter (
    where profile.id is not null and profile.is_active = false
  ) as inactive_count,
  count(*) filter (
    where profile.id is null or profile.is_active is distinct from false
  ) as mismatch_count
from invitation_profile_backfill_snapshot as snapshot
left join public.users as profile on profile.id = snapshot.user_id;

select snapshot.user_id, profile.is_active
from invitation_profile_backfill_snapshot as snapshot
left join public.users as profile on profile.id = snapshot.user_id
where profile.id is null or profile.is_active is distinct from false
order by snapshot.user_id;
```

   `mismatch_count` deve ser zero e a segunda consulta deve retornar zero linhas.
   Nunca reative em massa apenas pela data: um rollback deve usar exclusivamente
   os IDs desse snapshot e repetir as guardas atuais de ausência de membership,
   organização, onboarding e consentimento.
9. Com o readback limpo, liberar somente os canários e executá-los separadamente
   antes de reabrir o fluxo geral:
   convite novo, reenvio antes do aceite, retomada após falha parcial, conta já
   existente e dois aceites concorrentes (um sucesso; o outro conflito/replay,
   sem troca posterior de senha).

A API nova tolera o trigger antigo na curta janela anterior ao SQL, pois faz a
checagem e a inativação guardada antes de ativar membership. O caminho inverso
não é compatível. Depois da migration, não faça rollback isolado para a API
antiga; pause convites e siga um rollback coordenado ou corrija por roll-forward.

## Ordem de execução

### 1. Antes da janela de manutenção

1. Provisionar o host e o backend S3.
2. Instalar Docker, Compose, Supabase CLI atual, PostgreSQL client 17, `jq` e
   `rclone`.
3. Subir a pilha oficial vazia com PostgreSQL 17.
4. Gerar chaves novas e configurar SMTP, URLs e os secrets de
   `edge-functions.env.example` fora do Git.
5. Executar `node scripts/supabase/verify-edge-functions.mjs`. O corte deve ser
   interrompido se inventário, lifecycle, JWT ou hashes da fonte divergirem.
6. Copiar `supabase/functions/_shared`, o arquivo
   `supabase/functions/production-manifest.json` e somente as funções com status
   `ACTIVE` para `volumes/functions`. O roteador versionado lê o manifesto em
   `/home/deno/functions/production-manifest.json` ao iniciar; omiti-lo faz
   todas as rotas desse roteador retornarem `404`. Entradas `RETIRED` permanecem
   apenas como inventário e o roteador responde `404` para elas.
7. Instalar o roteador em `functions-main/index.ts` e o override
   `docker-compose.vimob-functions.yml`. Ele preserva `verify_jwt` por função.
8. Habilitar o endpoint S3 no self-hosted, gerar credenciais e iniciar a
   primeira cópia com `copy-storage.sh`.

Esses passos descrevem a **instalação inicial** do roteador versionado. Para
atualizar seletivamente as funções do Google Agenda no ambiente já em execução,
use o [preflight local](google-calendar-release-readiness.md). Em 2026-10-06, o
runtime observado servia apenas cinco slugs e respondia com um formato de `404`
diferente do roteador deste repositório. Inspecione o roteador, os mounts e o
manifesto efetivos antes de substituí-los; não copie o manifesto completo ou o
roteador versionado sobre esse runtime sem reconciliar as rotas existentes.
O fluxo atual da Agenda é Vimob → Google; publicar apenas OAuth e worker de
envio. Não configurar webhook ou jobs de entrada para este corte.
A primeira publicação da Agenda permite conectar a conta Google a todos os
usuários Vimob com acesso ativo e permissão de gerenciar Agenda; não há lista
de UUIDs no serviço Functions. Confirme previamente o status do cliente OAuth
no Google Cloud: em `Testing`, apenas as contas de teste cadastradas conseguem
autorizar, mesmo que o botão esteja visível no Vimob. Verifique o gate local,
o banco, o Vault, o Cron e a ordem do teste controlado no
[preflight](google-calendar-release-readiness.md) antes da publicação.

O comando `supabase secrets list` devolve nomes e hashes, não os valores. Os
valores reais devem vir do cofre operacional/Portainer ou ser rotacionados nos
provedores antes do corte.

### 2. Janela de manutenção

1. Colocar o app em manutenção e interromper todos os writers: web, API Go,
   workers, Edge Functions, Cron, webhooks e sincronizadores.
2. Confirmar que a fila de entrada do WhatsApp não está crescendo.
3. Executar `dump-restore.sh` no host de destino.
4. Executar `copy-vault.sh`. O dump oficial exclui o schema `vault`; sem essa
   etapa, Google Calendar, Vista, Imoview e jobs privados quebram.
5. Executar `post-restore-rewrite.sql` para trocar as referências ao projeto
   antigo em seis Cron jobs e na função `private.invoke_google_calendar_worker`.
6. Executar novamente `copy-storage.sh` para trazer o delta dos objetos.
7. Executar `rewrite-public-storage-urls-v1.sql` primeiro com `apply=0`; para
   aplicar, repetir com `apply=1` e as cinco contagens exibidas pela auditoria.
   O script recusa buckets privados, URLs assinadas e objetos ausentes.
8. Reiniciar os serviços e executar `verify.sql`.

O banco recebe escrita durante o dump lógico. Por isso, depois do início do
dump final, a origem deve permanecer em manutenção até o cutover. Não faça
dual-write entre os dois bancos.

### 3. Cutover

Atualize ao mesmo tempo:

- `NEXT_PUBLIC_SUPABASE_URL` e a chave pública no build do Next.js;
- `SUPABASE_PROJECT_URL`, JWKS, issuer e chaves server-side da API Go;
- callbacks de Auth e OAuth;
- webhooks Meta, Evolution/WhatsApp e Asaas; o webhook legado do Google
  Calendar não integra o fluxo de mão única;
- jobs e integrações que chamem `*.supabase.co`;
- DNS/Cloudflare do domínio do Supabase.

Os 177 usuários são preservados com seus hashes de senha, mas as sessões do
projeto gerenciado não são válidas com as novas chaves. Planeje logout e novo
login no primeiro acesso.

## Critérios obrigatórios de aceite

- `verify.sql` sem erro e contagens compatíveis com a origem congelada;
- 177 usuários em `auth.users`;
- 7 buckets e igualdade de contagem/tamanho no `rclone size`;
- download real de amostras dos 7 buckets;
- todas as funções `ACTIVE` do manifesto aprovado para o corte presentes e
  regras JWT iguais ao manifesto (67 entradas `ACTIVE` no manifesto local em
  2026-10-06; as 81 funções acima são o snapshot histórico da origem);
- 12 Cron jobs presentes, com 11 ativos e nenhuma URL do projeto antigo;
- 14 entradas do Vault, com `anon_key` substituída pela chave nova;
- login, reset de senha e convite por e-mail;
- recebimento de lead Meta;
- envio e recebimento WhatsApp, incluindo mídia;
- Google Calendar OAuth e envio Vimob → Google;
- Asaas checkout/webhook;
- Vista e Imoview;
- Realtime do CRM;
- backup completo criado e restauração de teste validada.

Não desligue nem apague a origem manualmente. Mantenha o dump, os checksums e
uma cópia externa até o novo ambiente passar pelos testes.

## Referências oficiais

- https://supabase.com/docs/guides/self-hosting/docker
- https://supabase.com/docs/guides/self-hosting/restore-from-platform
- https://supabase.com/docs/guides/self-hosting/copy-from-platform-s3
- https://supabase.com/docs/guides/self-hosting/self-hosted-functions
