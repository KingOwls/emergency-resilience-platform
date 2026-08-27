#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
API="${API:-http://localhost:8080}"
CIT="Authorization: Bearer local-citizen"
OP="Authorization: Bearer local-operator"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

ok(){ printf '\033[32m[OK]\033[0m %s\n' "$1"; }
fail(){ printf '\033[31m[FAIL]\033[0m %s\n' "$1"; exit 1; }
code(){ curl -sS -o "$2" -w '%{http_code}' "$1" "${@:3}"; }
json_get(){ python3 - "$1" "$2" <<'PY'
import json,sys
p=sys.argv[2].split('.')
x=json.load(open(sys.argv[1]))
for k in p: x=x[k]
print(x)
PY
}

for ep in health _health/intake _health/dispatch _health/geospatial _health/notification; do
  c=$(code "$API/$ep" "$TMP/h")
  [[ "$c" == "200" ]] || fail "$ep respondió $c"
done
ok "Gateway y 4 microservicios están READY"

C=$(curl -sS -o "$TMP/sink" -w '%{http_code}' http://localhost:3200/health)
[[ "$C" == "200" ]] || fail "Webhook sink no está disponible"
C=$(curl -sS -o "$TMP/webhook" -w '%{http_code}' -X POST "$API/v1/webhooks" -H "$OP" -H 'Content-Type: application/json' -d '{"city":"CALI","target_url":"http://webhook-sink:3200/hook"}')
[[ "$C" == "201" ]] || { cat "$TMP/webhook"; fail "No se pudo registrar webhook local"; }
ok "Webhook de laboratorio registrado"

STAMP=$(date +%s)
declare -a payloads=(
'{"type":"USAR_MEDICAL","city":"CALI","latitude":3.4516,"longitude":-76.5320,"critical_data":{"people_affected":3,"imminent_risk":"COLLAPSE"},"idempotency_key":"smoke-usar-'$STAMP'"}'
'{"type":"SHELTER","city":"PEREIRA","latitude":4.8143,"longitude":-75.6946,"critical_data":{"adults":4,"children":2,"older_adults":1,"home_habitability":"UNINHABITABLE"},"idempotency_key":"smoke-shelter-'$STAMP'"}'
'{"type":"SUPPLIES","city":"CHOCO","latitude":5.6947,"longitude":-76.6611,"critical_data":{"category":"WATER","quantity":30},"idempotency_key":"smoke-supplies-'$STAMP'"}'
'{"type":"DAMAGE_ASSESSMENT","city":"MANIZALES","latitude":5.0703,"longitude":-75.5138,"critical_data":{"building_type":"RESIDENTIAL","crack_level":"HIGH","collapse_risk":"HIGH","evidence_photo_url":"https://example.invalid/evidence.jpg"},"idempotency_key":"smoke-damage-'$STAMP'"}'
)

ids=()
for i in "${!payloads[@]}"; do
  c=$(curl -sS -o "$TMP/e$i" -w '%{http_code}' -X POST "$API/v1/emergencias" -H "$CIT" -H 'Content-Type: application/json' -d "${payloads[$i]}")
  [[ "$c" == "201" ]] || { cat "$TMP/e$i"; fail "Creación tipo $i respondió $c"; }
  ids+=("$(json_get "$TMP/e$i" emergency.id)")
done
ok "Los 4 tipos P1-P4 fueron creados en las 4 zonas"

c=$(curl -sS -o "$TMP/idem" -w '%{http_code}' -X POST "$API/v1/emergencias" -H "$CIT" -H 'Content-Type: application/json' -d "${payloads[0]}")
[[ "$c" == "200" ]] || fail "Idempotencia esperaba 200 y recibió $c"
[[ "$(json_get "$TMP/idem" duplicate)" == "True" || "$(json_get "$TMP/idem" duplicate)" == "true" ]] || fail "La respuesta no marcó duplicate=true"
ok "Idempotencia evita solicitudes duplicadas"

c=$(curl -sS -o "$TMP/forbidden" -w '%{http_code}' "$API/v1/emergencias/zona/CALI" -H "$CIT")
[[ "$c" == "403" ]] || fail "RLS/autorización esperaba 403 para ciudadano y recibió $c"
ok "Ciudadano no puede consultar el panel operativo"

c=$(curl -sS -o "$TMP/zone" -w '%{http_code}' "$API/v1/emergencias/zona/CALI" -H "$OP")
[[ "$c" == "200" ]] || { cat "$TMP/zone"; fail "Geospatial respondió $c"; }
ok "Operador consulta agregación geoespacial"

c=$(curl -sS -o "$TMP/dispatch" -w '%{http_code}' -X POST "$API/v1/despachos" -H "$OP" -H 'Content-Type: application/json' -d '{"emergency_id":"'"${ids[0]}"'"}')
[[ "$c" == "201" ]] || { cat "$TMP/dispatch"; fail "Dispatch respondió $c"; }
DISPATCH_ID=$(json_get "$TMP/dispatch" assignment.dispatch_id)
ok "Asignación del recurso más cercano creada: $DISPATCH_ID"

c=$(curl -sS -o "$TMP/dispatch-dup" -w '%{http_code}' -X POST "$API/v1/despachos" -H "$OP" -H 'Content-Type: application/json' -d '{"emergency_id":"'"${ids[0]}"'"}')
[[ "$c" == "409" ]] || { cat "$TMP/dispatch-dup"; fail "Un segundo despacho activo debía responder 409, respondió $c"; }
ok "No se permite doble despacho activo para la misma emergencia"

sleep 3
c=$(curl -sS -o "$TMP/notifications" -w '%{http_code}' "$API/v1/notificaciones" -H "$CIT")
[[ "$c" == "200" ]] || fail "Notifications respondió $c"
COUNT=$(python3 - "$TMP/notifications" <<'PY'
import json,sys
print(len(json.load(open(sys.argv[1])).get('notifications',[])))
PY
)
[[ "$COUNT" -ge 1 ]] || fail "No se procesaron eventos de outbox"
ok "Notification procesó la outbox y el ciudadano ve $COUNT notificación(es)"

HOOKS=$(curl -sS http://localhost:3200/events)
HCOUNT=$(python3 - "$HOOKS" <<'PY2'
import json,sys
print(len(json.loads(sys.argv[1]).get('events',[])))
PY2
)
[[ "$HCOUNT" -ge 1 ]] || fail "No llegó ningún webhook al sink"
ok "Webhook real entregado a un proceso independiente ($HCOUNT evento(s))"

./scripts/test-rls.sh

echo
echo "SMOKE TEST COMPLETO: VERDE"
