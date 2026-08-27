#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/.local-secrets"
mkdir -p "$DIR"
chmod 700 "$DIR"
if [[ ! -s "$DIR/db_password" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24 > "$DIR/db_password"
  else
    tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48 > "$DIR/db_password"
  fi
  chmod 600 "$DIR/db_password"
  echo "[OK] Se generó .local-secrets/db_password"
else
  echo "[OK] El secreto local ya existe"
fi
