#!/usr/bin/env bash
set -euo pipefail
printf 'Docker: '; docker --version
printf 'Compose: '; docker compose version
docker info >/dev/null
./scripts/bootstrap-local.sh
docker compose config >/dev/null
echo '[OK] Host listo para ejecutar el laboratorio local.'
