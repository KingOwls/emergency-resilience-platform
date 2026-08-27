# Plan de validación local

## Criterio de salida de la fase Docker

No subir a AWS mientras exista un rojo en esta tabla.

| Prueba | Comando | Esperado |
|---|---|---|
| DB aislada | `docker compose up -d db` | healthy |
| Front aislado | `docker compose up -d frontend` | UI carga en :3000 |
| Intake | `curl :3101/health/ready` | 200 |
| Dispatch | `curl :3102/health/ready` | 200 |
| Geo | `curl :3103/health/ready` | 200 |
| Notification | `curl :3104/health/ready` | 200 |
| API contract | `./scripts/smoke-local.sh` | VERDE |
| Notification caída | `./scripts/chaos-local.sh` | Intake continúa |
| Geo caída | `./scripts/chaos-local.sh` | Intake continúa |
| DB caída | `./scripts/chaos-local.sh` | front/gateway vivos; back not ready |

## Evidencias útiles para la sustentación

```bash
docker compose ps
docker compose logs --tail=100 intake-triage
docker compose logs --tail=100 notification-status
```

Toma capturas del estado healthy, del smoke test verde y del test de caída de Notification.
