import { authenticate, requireRole } from "./lib/auth.mjs";
import { healthDb, withClaims } from "./lib/db.mjs";
import { response } from "./lib/http.mjs";

const CITIES = new Set(["CHOCO", "PEREIRA", "CALI", "MANIZALES"]);

export async function route(req) {
  if (req.path === "/health/live") return response(200, { service: "geospatial-zone", status: "live" });
  if (req.path === "/health/ready") return response((await healthDb()) ? 200 : 503, { service: "geospatial-zone", status: "ready" });

  const claims = await authenticate(req.headers);
  requireRole(claims, "operator");

  const match = req.path.match(/^\/v1\/emergencias\/zona\/([A-Za-z_]+)$/);
  if (match && req.method === "GET") {
    const city = match[1].toUpperCase();
    if (!CITIES.has(city)) throw Object.assign(new Error("INVALID_CITY"), { statusCode: 400 });
    const data = await withClaims(claims, async db => {
      const [emergencies, hotspots, resources] = await Promise.all([
        db.query(`select id,type,priority,city,status,latitude,longitude,created_at from intake.emergencies where city=$1 and status not in ('RESOLVED','CLOSED') order by case priority when 'P1' then 1 when 'P2' then 2 when 'P3' then 3 else 4 end, created_at`, [city]),
        db.query(`select * from geo.hotspots_by_city($1)`, [city]),
        db.query(`select id,agency,resource_type,city,status,latitude,longitude,capabilities from dispatch.rescue_resources where city=$1 order by status,agency`, [city]),
      ]);
      return { city, emergencies: emergencies.rows, hotspots: hotspots.rows, resources: resources.rows };
    });
    return response(200, data);
  }

  return response(404, { error: "NOT_FOUND" });
}
