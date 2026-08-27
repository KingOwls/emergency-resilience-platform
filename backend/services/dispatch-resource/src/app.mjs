import { authenticate, requireRole } from "./lib/auth.mjs";
import { healthDb, withClaims } from "./lib/db.mjs";
import { response } from "./lib/http.mjs";
import { publishDomainEvent } from "./lib/events.mjs";

export async function route(req) {
  if (req.path === "/health/live") return response(200, { service: "dispatch-resource", status: "live" });
  if (req.path === "/health/ready") return response((await healthDb()) ? 200 : 503, { service: "dispatch-resource", status: "ready" });

  const claims = await authenticate(req.headers);
  requireRole(claims, "operator");

  if (req.method === "POST" && req.path === "/v1/despachos") {
    const emergencyId = req.body?.emergency_id;
    if (!emergencyId) throw Object.assign(new Error("MISSING_EMERGENCY_ID"), { statusCode: 400 });
    let assignment;
    try {
      assignment = await withClaims(claims, async db => {
        const result = await db.query(`select * from dispatch.assign_nearest_resource($1,$2)`, [emergencyId, claims.sub]);
        if (!result.rowCount) throw new Error("NO_RESOURCE_AVAILABLE");
        return result.rows[0];
      });
    } catch (error) {
      const message = String(error?.message || "");
      if (message.includes("ACTIVE_DISPATCH_EXISTS") || message.includes("NO_RESOURCE_AVAILABLE")) error.statusCode = 409;
      else if (message.includes("EMERGENCY_NOT_FOUND")) error.statusCode = 404;
      throw error;
    }
    const detail = { dispatch_id: assignment.dispatch_id, emergency_id: assignment.emergency_id, resource_id: assignment.resource_id, city: assignment.city, status: assignment.status };
    await publishDomainEvent("dispatch.assigned", detail);
    return response(201, { assignment });
  }

  const match = req.path.match(/^\/v1\/despachos\/([0-9a-fA-F-]+)$/);
  if (match && req.method === "PATCH") {
    const status = req.body?.status;
    const allowed = new Set(["ASSIGNED", "EN_ROUTE", "ON_SCENE", "COMPLETED", "CANCELLED"]);
    if (!allowed.has(status)) throw Object.assign(new Error("INVALID_DISPATCH_STATUS"), { statusCode: 400 });
    let assignment;
    try {
      assignment = await withClaims(claims, async db => {
        const result = await db.query(`select * from dispatch.update_dispatch_status($1,$2,$3)`, [match[1], status, claims.sub]);
        if (!result.rowCount) throw new Error("DISPATCH_NOT_FOUND");
        return result.rows[0];
      });
    } catch (error) {
      if (String(error?.message || "").includes("DISPATCH_NOT_FOUND")) error.statusCode = 404;
      throw error;
    }
    const detail = { dispatch_id: assignment.dispatch_id, emergency_id: assignment.emergency_id, resource_id: assignment.resource_id, city: assignment.city, status: assignment.status };
    await publishDomainEvent("dispatch.updated", detail);
    return response(200, { assignment });
  }

  return response(404, { error: "NOT_FOUND" });
}
