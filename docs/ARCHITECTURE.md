# Arquitectura v2

## Decisiones centrales

### 1. Local-first

Docker Compose es el primer entorno de integración. No se usa AWS para descubrir errores básicos de conectividad, rutas o persistencia.

### 2. Microservicios autónomos

Cada servicio posee su propio `package.json`, `Dockerfile`, `Dockerfile.lambda`, handler HTTP/Lambda y ciclo de despliegue.

### 3. Base compartida, dominio aislado

PostgreSQL es una dependencia de infraestructura compartida, pero el modelo se divide por esquemas:

- `intake`
- `dispatch`
- `geo`
- `notification`

RLS se fuerza para `app_backend`; cada petición establece claims en la transacción PostgreSQL.

### 4. Transactional Outbox

Los cambios de dominio y eventos se confirman juntos. La caída de Notification/EventBridge no revierte una emergencia ya aceptada ni pierde el evento pendiente.

### 5. Dos tipos de healthcheck

- `/health/live`: el proceso está vivo y no toca dependencias.
- `/health/ready`: comprueba PostgreSQL; una instancia sin DB no debe recibir tráfico de producción.

### 6. Migración sin reescribir dominio

El `app.mjs` de cada microservicio es compartido por el servidor Docker local y el adaptador Lambda. Al pasar a AWS cambia el adaptador/infraestructura, no la lógica de negocio.
