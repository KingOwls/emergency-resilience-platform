#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
CIT1="11111111-1111-4111-8111-111111111111"
CIT2="33333333-3333-4333-8333-333333333333"
STAMP="$(date +%s)"

OUT=$(docker compose exec -T db psql -U postgres -d emergency -At <<SQL
begin;
insert into intake.emergencies(citizen_id,type,priority,city,status,latitude,longitude,critical_data,idempotency_key)
values
('$CIT1','SUPPLIES','P3','CALI','TRIAGED',3.45,-76.53,'{"category":"WATER","quantity":1}','rls-a-$STAMP'),
('$CIT2','SUPPLIES','P3','CALI','TRIAGED',3.46,-76.54,'{"category":"WATER","quantity":1}','rls-b-$STAMP');
set local role app_backend;
select set_config('request.jwt.claims','{"sub":"$CIT1","role":"citizen"}',true);
select 'citizen='||count(*) from intake.emergencies where idempotency_key in ('rls-a-$STAMP','rls-b-$STAMP');
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"operator"}',true);
select 'operator='||count(*) from intake.emergencies where idempotency_key in ('rls-a-$STAMP','rls-b-$STAMP');
rollback;
SQL
)

C=$(printf '%s\n' "$OUT" | grep '^citizen=' | tail -1)
O=$(printf '%s\n' "$OUT" | grep '^operator=' | tail -1)
[[ "$C" == "citizen=1" ]] || { echo "[FAIL] RLS ciudadano: $C"; exit 1; }
[[ "$O" == "operator=2" ]] || { echo "[FAIL] RLS operador: $O"; exit 1; }
echo "[OK] RLS real en PostgreSQL: ciudadano=1 fila propia, operador=2 filas"
