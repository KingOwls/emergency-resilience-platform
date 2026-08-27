# Matriz de rutas y dependencias

| Ruta | Gateway local | Microservicio | Tablas/funciones principales | Rol |
|---|---|---|---|---|
| `POST /v1/emergencias` | `gateway` | Intake & Triage | `intake.emergencies`, `notification.outbox` | ciudadano |
| `GET /v1/emergencias/mias` | `gateway` | Intake & Triage | `intake.emergencies` + RLS | ciudadano/operador |
| `GET /v1/emergencias/zona/{ciudad}` | `gateway` | Geospatial | `geo.hotspots_by_city`, emergencias, recursos | operador |
| `POST /v1/despachos` | `gateway` | Dispatch | `dispatch.assign_nearest_resource` | operador |
| `PATCH /v1/despachos/{id}` | `gateway` | Dispatch | `dispatch.update_dispatch_status` | operador |
| `GET /v1/notificaciones` | `gateway` | Notification | `notification.events` + RLS | ciudadano/operador |
| `GET /v1/webhooks` | `gateway` | Notification | `notification.webhook_subscriptions` | operador |
| `POST /v1/webhooks` | `gateway` | Notification | `notification.webhook_subscriptions` | operador |

## Healthchecks

| URL directa | Propósito |
|---|---|
| `:3101/health/live` | proceso Intake vivo |
| `:3101/health/ready` | Intake + DB disponibles |
| `:3102/health/ready` | Dispatch + DB disponibles |
| `:3103/health/ready` | Geo + DB disponibles |
| `:3104/health/ready` | Notification + DB disponibles |

Un fallo de una API se observa solo en las rutas que dependen de ella. La caída total de PostgreSQL afecta el `ready` de los cuatro backends porque es una dependencia compartida, pero no derriba el frontend estático ni la vida del gateway.
