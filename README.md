# Emergency Resilience Platform v2

**Creado por: Jorge Luis Osorio**

Reconstrucción local-first del parcial **Arquitectura de Microservicios Serverless Resiliente para Gestión de Emergencias**.

## Objetivo de esta versión

Antes de tocar AWS, todas las piezas importantes se ejecutan y se prueban en Docker de forma independiente:

- `frontend`: React/Vite compilado y servido por Nginx.
- `gateway`: Nginx local que imita el punto único de entrada y aplica rate limiting.
- `intake-triage`: recepción, validación, idempotencia y triage P1-P4.
- `dispatch-resource`: asignación transaccional del recurso geográficamente más cercano.
- `geospatial-zone`: consultas PostGIS y clustering de hotspots.
- `notification-status`: procesamiento desacoplado de Transactional Outbox.
- `db`: PostgreSQL 16 + PostGIS, esquemas separados, RLS y datos de prueba.
- `webhook-sink`: receptor local de laboratorio para comprobar entregas webhook reales.

**No necesitas Node/npm/NVM/PostgreSQL instalados en el host para la prueba local.** Las dependencias se construyen dentro de Docker.

## Arquitectura local

```text
Browser :3000
    |
    v
Frontend container
    | /api
    v
Local Gateway :8080
    |-------------|---------------|----------------|
    v             v               v                v
 Intake :3101  Dispatch :3102  Geo :3103   Notification :3104
    |             |               |                |
    +-------------+---------------+----------------+
                          |
                          v
                  PostgreSQL/PostGIS :55432
```

Redes Docker:

- `edge`: frontend <-> gateway
- `backend`: gateway <-> microservicios
- `data`: microservicios <-> DB

El frontend no comparte la red `data` y no puede conectarse directamente a PostgreSQL.

## 1. Preparar secretos locales

```bash
cd emergency-resilience-platform-v2
./scripts/bootstrap-local.sh
```

Esto crea `.local-secrets/db_password`, que está ignorado por Git. No se usa `.env`.

## 2. Levantar componentes por separado

### Solo DB

```bash
docker compose up -d --build db
docker compose ps
```

PostgreSQL queda publicado únicamente para diagnóstico en `localhost:55432`.

### Solo frontend

```bash
docker compose up -d --build frontend
```

Abre `http://localhost:3000`. La interfaz debe cargar incluso sin gateway/backend.

### Intake + DB

```bash
docker compose up -d --build db intake-triage
curl http://localhost:3101/health/live
curl http://localhost:3101/health/ready
```

### Dispatch + DB

```bash
docker compose up -d --build db dispatch-resource
curl http://localhost:3102/health/ready
```

### Geospatial + DB

```bash
docker compose up -d --build db geospatial-zone
curl http://localhost:3103/health/ready
```

### Notification + DB

```bash
docker compose up -d --build db notification-status
curl http://localhost:3104/health/ready
```

## 3. Levantar la plataforma completa

```bash
./scripts/bootstrap-local.sh
docker compose up -d --build
docker compose ps
```

URLs:

| Componente | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Gateway local | http://localhost:8080 |
| Intake | http://localhost:3101 |
| Dispatch | http://localhost:3102 |
| Geospatial | http://localhost:3103 |
| Notification | http://localhost:3104 |
| PostgreSQL/PostGIS | localhost:55432 |
| Webhook sink de prueba | http://localhost:3200/events |

## 4. Tokens de laboratorio

Solo existen en `LOCAL_DOCKER=true`:

```text
Ciudadano: Bearer local-citizen
Operador:   Bearer local-operator
```

En AWS se reemplazan por JWT de Supabase Auth; los servicios recuperan configuración desde SSM y Secrets Manager.

## 5. Smoke test completo

Con la plataforma arriba:

```bash
./scripts/smoke-local.sh
```

Valida automáticamente:

1. health de los cuatro microservicios;
2. los cuatro tipos de emergencia P1-P4;
3. las cuatro zonas Chocó, Pereira, Cali y Manizales;
4. idempotencia;
5. autorización ciudadano/operador;
6. consulta geoespacial;
7. asignación de recurso y bloqueo de doble despacho;
8. procesamiento de Transactional Outbox;
9. notificaciones;
10. entrega webhook real a otro contenedor;
11. RLS real a nivel PostgreSQL.

El resultado esperado termina con:

```text
SMOKE TEST COMPLETO: VERDE
```

## 6. Prueba de aislamiento/caídas

```bash
./scripts/chaos-local.sh
```

Prueba que:

- cae Notification -> Intake continúa;
- cae Geospatial -> Intake continúa;
- cae DB -> Frontend y Gateway sobreviven, los backends pasan a `NOT READY`;
- al restaurar DB se recupera la dependencia.

La base de datos es una dependencia compartida, por lo que su caída sí degrada los cuatro servicios que requieren datos. La arquitectura evita que esa caída tumbe el frontend/gateway y expone healthchecks correctos para retirar instancias no saludables.

## 7. Transactional Outbox

Intake y Dispatch guardan el cambio de dominio y el evento pendiente dentro de la misma transacción de PostgreSQL.

```text
BEGIN
  cambio de dominio
  INSERT notification.outbox
COMMIT

HTTP success
       |
       v
Notification worker / EventBridge-SQS
```

Si Notification o EventBridge fallan, no se pierde el evento. La outbox permanece pendiente y se procesa al recuperar el componente.

## 8. Contrato de API

Ver [`contracts/openapi.yaml`](contracts/openapi.yaml).

Rutas principales:

```text
POST  /v1/emergencias
GET   /v1/emergencias/mias
GET   /v1/emergencias/zona/{ciudad}
POST  /v1/despachos
PATCH /v1/despachos/{id}
GET   /v1/notificaciones
GET   /v1/webhooks
POST  /v1/webhooks
```

## 9. Paso posterior: AWS

No se recomienda desplegar hasta que `smoke-local.sh` y `chaos-local.sh` estén verdes.

La carpeta `infrastructure/aws/` contiene la segunda etapa:

- AWS Lambda con imágenes OCI independientes;
- API Gateway stage `prod`;
- EventBridge -> SQS -> Notification;
- DLQ;
- Secrets Manager y Parameter Store;
- Canary 10%/5 minutos;
- alarmas CloudWatch;
- AWS Budget de USD 10 con alertas 50% y 85%;
- pipeline GitLab CI con OIDC.

Consulta [`docs/AWS_PHASE.md`](docs/AWS_PHASE.md) cuando la etapa local esté validada.

## Limpieza

Apagar sin borrar BD:

```bash
docker compose down
```

Borrar todo, incluida la persistencia local:

```bash
docker compose down -v --remove-orphans
rm -rf .local-secrets
```
