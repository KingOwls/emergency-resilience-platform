#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
API="http://localhost:8080"; CIT='Authorization: Bearer local-citizen'
ok(){ printf '\033[32m[OK]\033[0m %s\n' "$1"; }
need200(){ local c; c=$(curl --max-time 5 -sS -o /dev/null -w '%{http_code}' "$1"); [[ "$c" == 200 ]] || { echo "Esperaba 200 en $1, recibió $c"; exit 1; }; }

need200 http://localhost:3000/health
ok "Frontend vivo antes de las pruebas"

echo "[1/3] Apagando Notification..."
docker compose stop notification-status >/dev/null
sleep 2
STAMP=$(date +%s)
C=$(curl --max-time 8 -sS -o /tmp/chaos-intake.json -w '%{http_code}' -X POST "$API/v1/emergencias" -H "$CIT" -H 'Content-Type: application/json' -d '{"type":"SUPPLIES","city":"CALI","latitude":3.45,"longitude":-76.53,"critical_data":{"category":"WATER","quantity":5},"idempotency_key":"chaos-'$STAMP'"}')
[[ "$C" == 201 ]] || { cat /tmp/chaos-intake.json; echo "Intake se vio afectado por caída de Notification"; exit 1; }
EID=$(python3 - <<'PY'
import json
print(json.load(open('/tmp/chaos-intake.json'))['emergency']['id'])
PY
)
ok "Notification cayó y Intake siguió aceptando emergencias ($EID)"
docker compose start notification-status >/dev/null
for _ in {1..20}; do
  C=$(curl --max-time 3 -sS -o /dev/null -w '%{http_code}' http://localhost:3104/health/ready || true)
  [[ "$C" == 200 ]] && break
  sleep 1
done
sleep 3
N=$(curl --max-time 5 -sS "$API/v1/notificaciones" -H "$CIT")
python3 - "$EID" "$N" <<'PY'
import json,sys
emergency_id=sys.argv[1]; data=json.loads(sys.argv[2])
assert any(x.get('emergency_id')==emergency_id for x in data.get('notifications',[])), 'evento pendiente no fue recuperado'
PY
ok "Al volver Notification, la outbox pendiente fue recuperada"

echo "[2/3] Apagando Geospatial..."
docker compose stop geospatial-zone >/dev/null
sleep 1
C=$(curl --max-time 5 -sS -o /dev/null -w '%{http_code}' http://localhost:3101/health/ready)
[[ "$C" == 200 ]] || { echo "Intake dejó de estar ready al caer Geospatial"; exit 1; }
ok "Geospatial cayó y Intake permaneció READY"
docker compose start geospatial-zone >/dev/null

echo "[3/3] Apagando la base de datos compartida..."
docker compose stop db >/dev/null
sleep 2
need200 http://localhost:3000/health
need200 http://localhost:8080/health
C=$(curl --max-time 6 -sS -o /dev/null -w '%{http_code}' http://localhost:3101/health/ready || true)
[[ "$C" != 200 ]] || { echo "Intake debería dejar READY cuando DB cae"; exit 1; }
ok "Con DB caída, Front y Gateway sobreviven; el backend declara NOT READY (esperado)"
docker compose start db >/dev/null

echo "Esperando recuperación de DB y pool..."
for _ in {1..30}; do
  C=$(curl --max-time 3 -sS -o /dev/null -w '%{http_code}' http://localhost:3101/health/ready || true)
  [[ "$C" == 200 ]] && break
  sleep 1
done
[[ "$C" == 200 ]] || { echo "Intake no recuperó readiness tras volver DB"; exit 1; }
ok "DB y conexiones recuperadas sin reconstruir contenedores"

echo
echo "PRUEBA DE AISLAMIENTO COMPLETA"
