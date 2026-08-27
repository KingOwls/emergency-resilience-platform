# Fase 2 - Escalamiento a nube

La nube se aborda después de validar Docker local.

## Equivalencia local -> producción

| Local | Producción |
|---|---|
| Frontend Docker/Nginx | Vercel |
| Gateway Nginx | AWS API Gateway `prod` |
| 4 contenedores Node | 4 Lambda OCI desde ECR |
| PostgreSQL/PostGIS Docker | Supabase PostgreSQL/PostGIS |
| token de laboratorio | Supabase Auth JWT |
| outbox worker | EventBridge + SQS + Notification + outbox recovery |
| secrets Docker | Secrets Manager + Parameter Store |
| health/chaos local | CloudWatch alarms + Canary rollback |

## Orden de despliegue

1. Crear Supabase y aplicar `database/init/01_schema.sql` y `02_seed.sql` adaptando únicamente el seed si no se desea información de laboratorio.
2. Configurar Supabase Auth y asignar `app_metadata.role=operator` a operadores.
3. Crear `emergency/prod/database` en Secrets Manager con `databaseUrl`.
4. Crear `/emergency/prod/runtime` en Parameter Store usando `runtime-parameter.example.json` como forma, nunca como secreto real en Git.
5. Instalar AWS SAM CLI y autenticar AWS.
6. Validar `infrastructure/aws/template.yaml`.
7. `sam build` para construir las cuatro imágenes Lambda desde `Dockerfile.lambda`.
8. Primer deploy con `CanaryEnabled=false` para crear versiones/alias estables.
9. Segundo despliegue y siguientes con `CanaryEnabled=true` para activar Canary 10%/5 minutos.
10. Configurar frontend Vercel con la URL pública de API y Supabase.
11. Ejecutar smoke tests contra `prod`.
12. Forzar un fallo sintético y demostrar rollback Canary.
13. Capturar AWS Budget 50%/85%, CloudWatch y CodeDeploy.

## Regla de secretos

Los JSON `*.example.json` son únicamente ejemplos de forma. Nunca reemplazar los valores de ejemplo dentro del repositorio y hacer commit.
