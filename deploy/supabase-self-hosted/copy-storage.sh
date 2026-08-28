#!/usr/bin/env bash
set -Eeuo pipefail

: "${RCLONE_CONFIG:?Defina RCLONE_CONFIG apontando para o arquivo root-only}"

SOURCE_REMOTE="${SOURCE_REMOTE:-platform}"
TARGET_REMOTE="${TARGET_REMOTE:-self-hosted}"
RCLONE_TRANSFERS="${RCLONE_TRANSFERS:-8}"
RCLONE_CHECKERS="${RCLONE_CHECKERS:-16}"

rclone lsd "${SOURCE_REMOTE}:"
rclone lsd "${TARGET_REMOTE}:"

while IFS= read -r bucket; do
  [[ -z "$bucket" ]] && continue
  echo "Copiando bucket: $bucket"
  rclone copy \
    "${SOURCE_REMOTE}:${bucket}" \
    "${TARGET_REMOTE}:${bucket}" \
    --transfers "$RCLONE_TRANSFERS" \
    --checkers "$RCLONE_CHECKERS" \
    --size-only \
    --timeout 30m \
    --retries 10 \
    --low-level-retries 20 \
    --stats 30s \
    --progress
done < <(rclone lsf "${SOURCE_REMOTE}:" --dirs-only | tr -d '/')

echo "Comparando contagem e tamanho por bucket."
while IFS= read -r bucket; do
  [[ -z "$bucket" ]] && continue
  echo "SOURCE $bucket"
  rclone size "${SOURCE_REMOTE}:${bucket}"
  echo "TARGET $bucket"
  rclone size "${TARGET_REMOTE}:${bucket}"
done < <(rclone lsf "${SOURCE_REMOTE}:" --dirs-only | tr -d '/')
