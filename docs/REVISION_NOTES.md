# Qué cambia respecto a la primera versión

1. El host ya no necesita Node/npm/NVM para ejecutar la fase local.
2. Frontend, DB y cada microservicio backend tienen contenedor propio.
3. Se agrega gateway Docker local para verificar todas las rutas antes de API Gateway.
4. Se separan redes Docker `edge`, `backend` y `data`.
5. Se agregan `/health/live` y `/health/ready` por microservicio.
6. Se reemplaza el acoplamiento síncrono evento/BD por Transactional Outbox.
7. Se impide doble despacho activo por emergencia.
8. Se agrega prueba RLS directamente en PostgreSQL.
9. Se agrega receptor webhook local y validación de entrega real.
10. Se agrega contrato OpenAPI como fuente de verdad de las rutas.
11. Se agregan smoke tests y pruebas de caída reproducibles.
12. Canary queda desactivable para el primer deploy y activable desde la segunda versión.
13. La capa AWS reutiliza la misma lógica de dominio mediante adaptadores Lambda.
