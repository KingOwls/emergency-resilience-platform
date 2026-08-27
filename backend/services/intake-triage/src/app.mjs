import { randomUUID } from "node:crypto";
import { authenticate } from "./lib/auth.mjs";
import { healthDb, withClaims } from "./lib/db.mjs";
import { response } from "./lib/http.mjs";
import { publishDomainEvent } from "./lib/events.mjs";

const TYPES = {
  USAR_MEDICAL: "P1",
  SHELTER: "P2",
  SUPPLIES: "P3",
  DAMAGE_ASSESSMENT: "P4",
};
const CITIES = new Set(["CHOCO", "PEREIRA", "CALI", "MANIZALES"]);

function bad(message) { throw Object.assign(new Error(message), { statusCode: 400 }); }

function validateCritical(type, data = {}) {
  if (type === "USAR_MEDICAL") {
    if (!Number.isFinite(Number(data.people_affected)) || Number(data.people_affected) < 1) bad("INVALID_PEOPLE_AFFECTED");
    if (!data.imminent_risk) bad("MISSING_IMMINENT_RISK");
  } else if (type === "SHELTER") {
    for (const key of ["adults", "children", "older_adults"]) if (!Number.isFinite(Number(data[key])) || Number(data[key]) < 0) bad(`INVALID_${key.toUpperCase()}`);
    if (!data.home_habitability) bad("MISSING_HOME_HABITABILITY");
  } else if (type === "SUPPLIES") {
    if (!data.category) bad("MISSING_SUPPLY_CATEGORY");
    if (!Number.isFinite(Number(data.quantity)) || Number(data.quantity) < 1) bad("INVALID_QUANTITY");
  } else if (type === "DAMAGE_ASSESSMENT") {
    if (!data.building_type || !data.crack_level || !data.collapse_risk || !data.evidence_photo_url) bad("MISSING_DAMAGE_DATA");
  }
}

export async function route(req) {
  if (req.path === "/health/live") return response(200, { service: "intake-triage", status: "live" });
  if (req.path === "/health/ready") return response((await healthDb()) ? 200 : 503, { service: "intake-triage", status: "ready" });

  const claims = await authenticate(req.headers);

  if (req.method === "GET" && req.path === "/v1/emergencias/mias") {
    const rows = await withClaims(claims, async db => (await db.query(`
      select id, type, priority, city, status, latitude, longitude, critical_data, created_at, updated_at
      from intake.emergencies order by created_at desc limit 100
    `)).rows);
    return response(200, { emergencies: rows });
  }

  if (req.method === "POST" && req.path === "/v1/emergencias") {
    const b = req.body || {};
    if (!TYPES[b.type]) bad("INVALID_TYPE");
    if (!CITIES.has(b.city)) bad("INVALID_CITY");
    const lat = Number(b.latitude), lng = Number(b.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) bad("INVALID_LATITUDE");
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) bad("INVALID_LONGITUDE");
    if (!b.idempotency_key || String(b.idempotency_key).length < 8) bad("INVALID_IDEMPOTENCY_KEY");
    validateCritical(b.type, b.critical_data);
    const priority = TYPES[b.type];
    const emergencyId = randomUUID();
    const eventId = randomUUID();

    const result = await withClaims(claims, async db => {
      const existing = await db.query(`select * from intake.emergencies where idempotency_key=$1`, [b.idempotency_key]);
      if (existing.rowCount) return { emergency: existing.rows[0], duplicate: true, event: null };

      const inserted = await db.query(`
        insert into intake.emergencies(id,citizen_id,type,priority,city,status,latitude,longitude,critical_data,idempotency_key)
        values($1,$2,$3,$4,$5,'TRIAGED',$6,$7,$8::jsonb,$9)
        returning id,citizen_id,type,priority,city,status,latitude,longitude,critical_data,created_at,updated_at
      `,[emergencyId, claims.sub, b.type, priority, b.city, lat, lng, JSON.stringify(b.critical_data || {}), b.idempotency_key]);

      const detail = { event_id: eventId, emergency_id: emergencyId, city: b.city, priority, status: "TRIAGED", citizen_id: claims.sub };
      await db.query(`insert into notification.outbox(id,event_type,aggregate_id,payload) values($1,'emergency.created',$2,$3::jsonb)`, [eventId, emergencyId, JSON.stringify(detail)]);
      return { emergency: inserted.rows[0], duplicate: false, event: detail };
    });

    if (result.event) await publishDomainEvent("emergency.created", result.event);
    return response(result.duplicate ? 200 : 201, result);
  }

  return response(404, { error: "NOT_FOUND" });
}
