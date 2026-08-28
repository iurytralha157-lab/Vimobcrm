#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${SOURCE_DB_URL:?Defina SOURCE_DB_URL com a conexão percent-encoded da origem}"
: "${TARGET_DB_URL:?Defina TARGET_DB_URL com a conexão do self-hosted}"
: "${MIGRATION_DIR:?Defina MIGRATION_DIR em um volume com pelo menos 400 GiB livres}"

if [[ "${MIGRATION_CONFIRMED:-no}" != "yes" ]]; then
  echo "Defina MIGRATION_CONFIRMED=yes somente depois de congelar todas as escritas."
  exit 2
fi

if [[ "$SOURCE_DB_URL" == "$TARGET_DB_URL" ]]; then
  echo "Origem e destino não podem ser iguais."
  exit 2
fi

for command_name in supabase psql sha256sum df; do
  command -v "$command_name" >/dev/null || {
    echo "Comando ausente: $command_name"
    exit 2
  }
done

mkdir -p "$MIGRATION_DIR"
cd "$MIGRATION_DIR"
df -h .

supabase db dump --db-url "$SOURCE_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$SOURCE_DB_URL" -f schema.sql
supabase db dump --db-url "$SOURCE_DB_URL" -f data.sql --use-copy --data-only

sha256sum roles.sql schema.sql data.sql > SHA256SUMS
sha256sum --check SHA256SUMS

psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file roles.sql \
  --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "$TARGET_DB_URL"

echo "Dump e restore concluídos. Execute copy-vault.sh, o rewrite pós-restore e verify.sql."

