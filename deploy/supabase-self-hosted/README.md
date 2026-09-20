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

No self-hosted atual, o GoTrue não lê templates diretamente de volumes
montados. O arquivo precisa ser servido por HTTP e a URL deve responder a um
`GET` feito de dentro da rede do serviço `auth`. A URL não precisa ser pública;
um `templates-server` privado na mesma rede Docker é suficiente. Se a busca
falhar ou o conteúdo não for um template Go válido, o Auth usa o template
padrão, por isso a disponibilidade desse endpoint faz parte do cutover.

Mantenha SMTP e a allowlist fora do Git no `.env` operacional da stack oficial.
A linha abaixo representa apenas o conjunto mínimo conhecido pelo repositório.
Antes de alterar produção, leia o valor vigente e **mescle** essas duas URLs com
todas as entradas já configuradas; nunca substitua a allowlist inteira. O
redirect de `/login?emailConfirmation=success` é usado pela confirmação e pelo
reenvio do onboarding público e deve permanecer autorizado.

```dotenv
SMTP_ADMIN_EMAIL=no-reply@auth.vimobcrm.com.br
SMTP_HOST=<host-smtp>
SMTP_PORT=587
SMTP_USER=<usuario-smtp>
SMTP_PASS=<segredo-no-cofre>
SMTP_SENDER_NAME=Vimob CRM
SITE_URL=https://app.vimobcrm.com.br
ADDITIONAL_REDIRECT_URLS=https://app.vimobcrm.com.br/reset-password,https://app.vimobcrm.com.br/login?emailConfirmation=success
```

No `environment` do serviço `auth`, preserve os mapeamentos SMTP/URL da stack
oficial e acrescente as duas variáveis específicas do recovery:

```yaml
services:
  auth:
    environment:
      GOTRUE_SITE_URL: ${SITE_URL}
      GOTRUE_URI_ALLOW_LIST: ${ADDITIONAL_REDIRECT_URLS}
      GOTRUE_SMTP_ADMIN_EMAIL: ${SMTP_ADMIN_EMAIL}
      GOTRUE_SMTP_HOST: ${SMTP_HOST}
      GOTRUE_SMTP_PORT: ${SMTP_PORT}
      GOTRUE_SMTP_USER: ${SMTP_USER}
      GOTRUE_SMTP_PASS: ${SMTP_PASS}
      GOTRUE_SMTP_SENDER_NAME: ${SMTP_SENDER_NAME}
      GOTRUE_MAILER_TEMPLATES_RECOVERY: http://templates-server/recovery.html
      GOTRUE_MAILER_SUBJECTS_RECOVERY: Redefina sua senha no Vimob CRM
```

O endpoint `http://templates-server/recovery.html` acima é um contrato de rede,
não uma aplicação automática deste repositório. Antes do restart controlado do
Auth, publique exatamente `supabase/templates/recovery.html` nesse endpoint e
confirme, a partir da rede/container do `auth`, resposta `200`, HTML íntegro e
presença literal de `{{ .RedirectTo }}`, `{{ .TokenHash }}` e `type=recovery`.
Não use `file://`, caminho de volume ou `localhost` apontando para outro
container. Desative link tracking/click rewriting no provedor SMTP para não
alterar o link de recuperação.

Faça um canário com uma conta dedicada antes de liberar produção:

1. Solicitar uma única recuperação em `https://app.vimobcrm.com.br/login`.
2. Confirmar remetente/domínio, assunto, logo, faixa e botão laranja no e-mail
   recebido, sem fallback para o template padrão nos logs do Auth.
3. Inspecionar o destino do botão: ele deve começar em
   `https://app.vimobcrm.com.br/reset-password`, ter um único `token_hash` e
   `type=recovery`, sem o provedor de e-mail reescrever a URL.
4. Abrir o link uma vez, definir uma senha nova e validar login com ela; a senha
   anterior deve falhar e a reutilização do link deve ser recusada.
5. Só então executar os canários restantes de Auth. Se qualquer etapa falhar,
   interromper o cutover e manter a origem ativa.

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
3. Antes do SQL, ler o trigger esperado; a migration também falha de propósito
   se ele estiver ausente, desabilitado ou apontar para outra função:

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
8. Repetir a consulta do trigger e confirmar `tgenabled` em `O` ou `A`, função
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
6. Copiar `supabase/functions/_shared` e somente as funções com status `ACTIVE`
   em `supabase/functions/production-manifest.json` para `volumes/functions`.
   Entradas `RETIRED` permanecem apenas como inventário e o roteador responde
   `404` para elas.
7. Instalar o roteador em `functions-main/index.ts` e o override
   `docker-compose.vimob-functions.yml`. Ele preserva `verify_jwt` por função.
8. Habilitar o endpoint S3 no self-hosted, gerar credenciais e iniciar a
   primeira cópia com `copy-storage.sh`.

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
- webhooks Meta, Evolution/WhatsApp, Google Calendar e Asaas;
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
- 81 funções presentes e regras JWT iguais ao manifest;
- 12 Cron jobs presentes, com 11 ativos e nenhuma URL do projeto antigo;
- 14 entradas do Vault, com `anon_key` substituída pela chave nova;
- login, reset de senha e convite por e-mail;
- recebimento de lead Meta;
- envio e recebimento WhatsApp, incluindo mídia;
- Google Calendar OAuth/sync/webhook;
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

