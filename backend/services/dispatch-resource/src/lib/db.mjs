import pg from "pg";
import { getConfig } from "./config.mjs";

const { Pool } = pg;
let pool;

async function getPool() {
  if (pool) return pool;
  const cfg = await getConfig();
  pool = new Pool({
    connectionString: cfg.databaseUrl,
    ssl: cfg.dbSsl ? { rejectUnauthorized: false } : false,
    max: cfg.local ? 5 : 2,
    connectionTimeoutMillis: cfg.queryTimeoutMs,
    statement_timeout: cfg.queryTimeoutMs,
  });
  return pool;
}

export async function healthDb() {
  try {
    const p = await getPool();
    const result = await p.query("select 1 as ok");
    return result.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

export async function withClaims(claims, fn) {
  const p = await getPool();
  const client = await p.connect();
  try {
    await client.query("begin");
    await client.query("set local role app_backend");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: claims.sub, role: claims.role })]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
