import { getConfig } from "./config.mjs";

const LOCAL_USERS = {
  "local-citizen": { sub: "11111111-1111-4111-8111-111111111111", role: "citizen" },
  "local-operator": { sub: "22222222-2222-4222-8222-222222222222", role: "operator" },
};

let remoteJwks;

export async function authenticate(headers = {}) {
  const authorization = headers.authorization || headers.Authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const cfg = await getConfig();

  if (cfg.local) {
    const user = LOCAL_USERS[token];
    if (!user) throw Object.assign(new Error("UNAUTHORIZED"), { statusCode: 401 });
    return user;
  }

  if (!token || !cfg.supabaseUrl) throw Object.assign(new Error("UNAUTHORIZED"), { statusCode: 401 });
  const { createRemoteJWKSet, jwtVerify } = await import("jose");
  remoteJwks ||= createRemoteJWKSet(new URL(`${cfg.supabaseUrl}/auth/v1/.well-known/jwks.json`));
  const { payload } = await jwtVerify(token, remoteJwks, { issuer: `${cfg.supabaseUrl}/auth/v1` });
  const role = payload.app_metadata?.role === "operator" ? "operator" : "citizen";
  return { sub: String(payload.sub), role };
}

export function requireRole(claims, ...allowed) {
  if (!allowed.includes(claims.role)) throw Object.assign(new Error("FORBIDDEN"), { statusCode: 403 });
}
