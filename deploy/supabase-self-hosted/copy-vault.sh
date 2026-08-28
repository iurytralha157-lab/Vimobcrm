#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${SOURCE_DB_URL:?Defina SOURCE_DB_URL}"
: "${TARGET_DB_URL:?Defina TARGET_DB_URL}"
: "${TARGET_ANON_KEY:?Defina TARGET_ANON_KEY com a chave anon nova}"

if [[ "${VAULT_COPY_CONFIRMED:-no}" != "yes" ]]; then
  echo "Defina VAULT_COPY_CONFIRMED=yes para copiar os segredos diretamente entre os bancos."
  exit 2
fi

# O SQL com valores descriptografados passa apenas pelo pipe e não é salvo em disco.
psql "$SOURCE_DB_URL" --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 \
  --command "select format('select vault.create_secret(%L, %L, %L, %L::uuid);', decrypted_secret, name, description, id) from vault.decrypted_secrets where name <> 'anon_key' order by name" \
| psql "$TARGET_DB_URL" --no-psqlrc --set ON_ERROR_STOP=1

# A chave anon do projeto antigo não serve no destino. Grave a chave recém-gerada.
psql "$TARGET_DB_URL" --no-psqlrc --set ON_ERROR_STOP=1 \
  --set target_anon_key="$TARGET_ANON_KEY" \
  --command "select vault.create_secret(:'target_anon_key', 'anon_key', 'Chave anônima pública do Supabase') where not exists (select 1 from vault.secrets where name = 'anon_key')"

psql "$TARGET_DB_URL" --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 \
  --command "select count(*) from vault.secrets"

