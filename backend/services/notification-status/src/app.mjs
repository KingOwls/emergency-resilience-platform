import { authenticate, requireRole } from "./lib/auth.mjs";
import { getConfig } from "./lib/config.mjs";
import { healthDb, withClaims } from "./lib/db.mjs";
import { response } from "./lib/http.mjs";
import { processBackgroundWork } from "./worker.mjs";

const CITIES = new Set(["CHOCO", "PEREIRA", "CALI", "MANIZALES"]);

export async function route(req) {
  if (req.path === "/health/live") return response(200, { service: "notification-status", status: "live" });
  if (req.path === "/health/ready") return response((await healthDb()) ? 200 : 503, { service: "notification-status", status: "ready" });

  const claims = await authenticate(req.headers);

  if (req.method === "GET" && req.path === "/v1/notificaciones") {
    const rows = await withClaims(claims, async db => (await db.query(`
      select id,emergency_id,city,status,message,source,created_at
      from notification.events order by created_at desc limit 100
    `)).rows);
    return response(200, { notifications: rows });
  }

  if (req.path === "/v1/webhooks" && req.method === "GET") {
    requireRole(claims, "operator");
    const rows = await withClaims(claims, async db => (await db.query(`select id,city,target_url,active,created_at from notification.webhook_subscriptions order by created_at desc`)).rows);
    return response(200, { subscriptions: rows });
  }

  if (req.path === "/v1/webhooks" && req.method === "POST") {
    requireRole(claims, "operator");
    const { city, target_url: targetUrl } = req.body || {};
    if (!CITIES.has(city)) throw Object.assign(new Error("INVALID_CITY"), { statusCode: 400 });
    const cfg = await getConfig();
    if (typeof targetUrl !== "string" || !(cfg.local ? /^https?:\/\// : /^https:\/\//).test(targetUrl)) throw Object.assign(new Error("INVALID_WEBHOOK_URL"), { statusCode: 400 });
    const sub = await withClaims(claims, async db => (await db.query(`
      insert into notification.webhook_subscriptions(city,target_url) values($1,$2)
      on conflict(city,target_url) do update set active=true
      returning id,city,target_url,active,created_at
    `,[city,targetUrl])).rows[0]);
    return response(201, { subscription: sub });
  }

  if (req.method === "POST" && req.path === "/internal/outbox/process") {
    requireRole(claims, "operator");
    return response(200, await processBackgroundWork());
  }

  return response(404, { error: "NOT_FOUND" });
}
