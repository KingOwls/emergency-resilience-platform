import { readFile } from "node:fs/promises";

let cached;

async function readSecretFile(path) {
  return (await readFile(path, "utf8")).trim();
}

export async function getConfig() {
  if (cached) return cached;

  const local = process.env.LOCAL_DOCKER === "true";
  if (local) {
    const password = await readSecretFile(process.env.DB_PASSWORD_FILE || "/run/secrets/db_password");
    cached = {
      local: true,
      databaseUrl: `postgresql://${process.env.DB_USER || "postgres"}:${encodeURIComponent(password)}@${process.env.DB_HOST || "db"}:${process.env.DB_PORT || "5432"}/${process.env.DB_NAME || "emergency"}`,
      dbSsl: false,
      queryTimeoutMs: 3000,
      supabaseUrl: null,
      eventBusName: null,
    };
    return cached;
  }

  const [{ SecretsManagerClient, GetSecretValueCommand }, { SSMClient, GetParameterCommand }] = await Promise.all([
    import("@aws-sdk/client-secrets-manager"),
    import("@aws-sdk/client-ssm"),
  ]);

  const sm = new SecretsManagerClient({});
  const ssm = new SSMClient({});
  const [secretResult, runtimeResult] = await Promise.all([
    sm.send(new GetSecretValueCommand({ SecretId: "emergency/prod/database" })),
    ssm.send(new GetParameterCommand({ Name: "/emergency/prod/runtime", WithDecryption: true })),
  ]);

  const secret = JSON.parse(secretResult.SecretString || "{}");
  const runtime = JSON.parse(runtimeResult.Parameter?.Value || "{}");
  if (!secret.databaseUrl) throw new Error("Missing databaseUrl in Secrets Manager");

  cached = {
    local: false,
    databaseUrl: secret.databaseUrl,
    dbSsl: runtime.dbSsl !== false,
    queryTimeoutMs: Number(runtime.queryTimeoutMs || 3000),
    supabaseUrl: runtime.supabaseUrl || null,
    eventBusName: runtime.eventBusName || "emergency-prod",
  };
  return cached;
}
