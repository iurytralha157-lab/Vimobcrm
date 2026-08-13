# Contingencia: migracao Supabase cloud-to-cloud

Este e o Plano B. Use somente se a transferencia nativa estiver bloqueada ou
se o Vimob precisar deliberadamente de um novo `project ref`, outra regiao ou
um dump logico que remova bloat fisico.

Para a troca urgente de conta, prefira o runbook de transferencia. Um clone ou
restore para outro projeto copia o banco, mas nao copia os bytes do Storage,
Edge Functions, secrets, Auth settings, API keys, Realtime settings, read
replicas nem todas as configuracoes da plataforma.

## Escolha do metodo

1. **Restore to a New Project**: preferido em plano pago quando backups fisicos
   estiverem habilitados. Cria um projeto independente na mesma regiao e copia
   o banco. Storage e configuracoes ainda sao manuais.
2. **Dump/restore logico**: usar para trocar de regiao, reduzir bloat fisico ou
   quando o clone nao estiver disponivel. Para banco acima de 150 GB, envolver
   o suporte do Supabase antes da execucao.

O projeto restaurado fisicamente nao deve ser usado para disparar cron,
`pg_net`, wrappers ou webhooks enquanto ainda for homologacao. Desabilite os
efeitos externos antes de liberar qualquer escrita.

## Variaveis operacionais

Mantenha fora do Git:

```dotenv
SOURCE_PROJECT_REF=iemalzlfnbouobyjwlwi
TARGET_PROJECT_REF=
SOURCE_DB_URL=
TARGET_DB_URL=
SOURCE_STORAGE_S3_ENDPOINT=
TARGET_STORAGE_S3_ENDPOINT=
SOURCE_STORAGE_ACCESS_KEY_ID=
SOURCE_STORAGE_SECRET_ACCESS_KEY=
TARGET_STORAGE_ACCESS_KEY_ID=
TARGET_STORAGE_SECRET_ACCESS_KEY=
MIGRATION_ARTIFACT_DIR=
```

Nunca coloque uma chave `service_role`, `sb_secret`, senha ou access token em
argumentos versionados, logs, screenshots ou arquivos deste repositorio.

## Fase 1 - construir o destino

- criar projeto pago com Postgres 17 e capacidade de compute/disco suficiente;
- preferir a mesma regiao para minimizar tempo e egress, salvo quando a mudanca
  de regiao for o objetivo;
- habilitar as extensoes usadas na origem e Database Webhooks;
- aplicar SSL e restricoes de rede equivalentes;
- configurar Auth Site URL, redirects, SMTP, providers, hooks e CAPTCHA;
- manter cron/webhooks/workers do destino desabilitados;
- preparar buckets com a mesma configuracao, sem ainda expor o destino;
- preparar Edge Functions e nomes de secrets, mas nao usar valores antigos sem
  revisao/rotacao planejada.

## Fase 2 - ensaio de banco

Com Supabase CLI atual, Docker e PostgreSQL client 17:

```bash
supabase db dump --db-url "$SOURCE_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$SOURCE_DB_URL" -f schema.sql
supabase db dump --db-url "$SOURCE_DB_URL" -f data.sql \
  --use-copy --data-only \
  -x "storage.buckets_vectors" \
  -x "storage.vector_indexes"

supabase db dump --db-url "$SOURCE_DB_URL" \
  -f history_schema.sql --schema supabase_migrations
supabase db dump --db-url "$SOURCE_DB_URL" \
  -f history_data.sql --use-copy --data-only --schema supabase_migrations

sha256sum roles.sql schema.sql data.sql history_schema.sql history_data.sql \
  > SHA256SUMS
sha256sum --check SHA256SUMS
```

Antes do restore, revogar defaults amplos no destino conforme o guia oficial:

```sql
alter default privileges in schema public
  revoke all on tables from anon, authenticated;
```

Restore:

```bash
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file roles.sql \
  --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "$TARGET_DB_URL"

psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file history_schema.sql \
  --file history_data.sql \
  --dbname "$TARGET_DB_URL"
```

O ensaio deve ocorrer sem congelar a producao, com paralelismo conservador e
monitoramento de CPU/IO. Ele serve para descobrir incompatibilidades; nao e o
cutover.

## Fase 3 - Auth

O dump preserva `auth.users`, identities e hashes de senha. Com uma chave JWT
diferente, tokens existentes deixam de ser validos e os usuarios precisam
entrar novamente.

Nao reaproveite automaticamente o segredo legado apenas para evitar logout.
Primeiro identifique se a origem usa legacy HS256 ou signing keys assimetricas
e monte uma rotacao segura. Atualizar JWT secret tambem altera chaves legadas
anon/service role. Prefira publishable/secret keys atuais para novos projetos.

Teste obrigatoriamente senha, social login, convite, reset, refresh token e
logout antes do corte.

## Fase 4 - Storage

O restore do banco leva metadados de buckets/objetos, mas nao os bytes do S3.
Copie os objetos pela API S3 oficial ou pelo script oficial de migracao em
lotes, sem usar `sync --delete`.

Para este volume, prefira um host temporario proximo da regiao e `rclone copy`
com S3 de origem e destino. Execute uma copia inicial online e uma segunda
copia incremental durante a janela congelada. Compare por bucket:

- quantidade de objetos;
- soma de bytes;
- lista de falhas/retries;
- download real e checksum de amostras;
- acesso publico/privado e signed URL.

Nao considere a migracao concluida apenas porque `storage.objects` tem linhas.

## Fase 5 - Edge Functions e configuracao

- usar o codigo versionado como fonte canonica;
- comparar com `supabase functions list/download` da origem;
- restaurar `deno.json` e import maps, pois `functions download` nao os inclui;
- implantar apenas o manifest de producao e preservar `verify_jwt` por funcao;
- recriar secrets a partir do cofre operacional; o Supabase devolve nomes e
  hashes, nao os valores;
- reconfigurar Auth, Realtime, SMTP, Custom Domain, network restrictions,
  GitHub, Log Drains e read replicas;
- trocar callbacks externos que contenham o project ref antigo.

## Fase 6 - cutover

1. Ativar manutencao e parar web, API Go, Edge workers, cron, webhooks e
   sincronizadores que escrevem.
2. Confirmar que as filas nao crescem.
3. Fazer dump/restore final ou aplicar o mecanismo de clone escolhido.
4. Copiar o delta final do Storage e verificar contagem/bytes.
5. Reescrever URLs/ref antigo em cron, funcoes, Vault e configuracoes.
6. Atualizar atomicamente web/API/Portainer com URL, keys, JWKS, issuer e banco
   do destino.
7. Atualizar callbacks nos provedores e DNS/domino customizado.
8. Executar fingerprint, smoke tests e testes funcionais.
9. Liberar writers gradualmente e observar filas/logs.

Nao use dual-write entre os projetos.

## Aceite e rollback

Aceite exige igualdade ou explicacao para:

- usuarios/identities Auth;
- organizacoes, usuarios do CRM, leads, imoveis e configuracoes;
- conversas/mensagens/fila WhatsApp;
- buckets, objetos e bytes;
- extensions, policies/RLS, publications, cron e migrations;
- Edge Functions e nomes de secrets;
- login, Storage, Realtime, Meta, WhatsApp, Google Calendar, Asaas, Vista e
  Imoview.

Rollback antes de liberar writes: apontar app e provedores de volta para a
origem. Depois que o destino receber escrita, rollback exige novo freeze e
reconciliacao; nunca volte simplesmente as URLs e crie split-brain.

Mantenha a origem sem exclusao, os dumps e checksums por no minimo 7 dias apos
o aceite.

## Fontes oficiais

- https://supabase.com/docs/guides/platform/migrating-within-supabase
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- https://supabase.com/docs/guides/platform/clone-project
- https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects
- https://supabase.com/docs/guides/storage/s3/compatibility
- https://supabase.com/docs/guides/functions/secrets
