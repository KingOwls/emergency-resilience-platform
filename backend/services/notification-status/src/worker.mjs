import { randomUUID } from "node:crypto";
import { withClaims } from "./lib/db.mjs";
import { log } from "./lib/log.mjs";

const SYSTEM = { sub: "00000000-0000-4000-8000-000000000001", role: "system" };

function messageFor(eventType, payload) {
  if (eventType === "emergency.created") return `Emergencia ${payload.priority || ""} recibida y clasificada para ${payload.city}.`;
  if (eventType === "dispatch.assigned") return `Recurso de respuesta asignado. Estado: ${payload.status || "ASSIGNED"}.`;
  if (eventType === "dispatch.updated") return `El despacho cambió a ${payload.status}.`;
  return `Actualización de emergencia: ${eventType}.`;
}

export async function processOutboxBatch(limit = 20) {
  return withClaims(SYSTEM, async db => {
    const claimed = await db.query(`
      select id,event_type,aggregate_id,payload
      from notification.outbox
      where processed_at is null
      order by created_at
      limit $1
      for update skip locked
    `, [limit]);
    let processed = 0;
    for (const row of claimed.rows) {
      const payload = row.payload || {};
      await db.query(`
        insert into notification.events(id,source_event_id,emergency_id,city,status,message,source)
        values($1,$2,$3,$4,$5,$6,$7)
        on conflict (source_event_id) do nothing
      `, [randomUUID(), row.id, row.aggregate_id, payload.city || "CALI", payload.status || "UPDATED", messageFor(row.event_type, payload), row.event_type]);
      await db.query(`update notification.outbox set processed_at=now(), attempts=attempts+1 where id=$1`, [row.id]);
      processed += 1;
    }
    return processed;
  });
}

export async function deliverWebhookBatch(limit = 20) {
  const tasks = await withClaims(SYSTEM, async db => (await db.query(`
    select e.id event_id,e.emergency_id,e.city,e.status,e.message,e.source,e.created_at,
           s.id subscription_id,s.target_url,coalesce(d.attempts,0) attempts
    from notification.events e
    join notification.webhook_subscriptions s on s.city=e.city and s.active=true
    left join notification.webhook_deliveries d on d.event_id=e.id and d.subscription_id=s.id
    where d.delivered_at is null and coalesce(d.attempts,0) < 5
    order by e.created_at
    limit $1
  `,[limit])).rows);

  let delivered = 0;
  for (const task of tasks) {
    let statusCode = null, lastError = null, success = false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(task.target_url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emergency_id: task.emergency_id, city: task.city, status: task.status, message: task.message, source: task.source, created_at: task.created_at }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      statusCode = res.status;
      success = res.ok;
      if (!success) lastError = `HTTP_${res.status}`;
    } catch (error) {
      lastError = error?.message || "WEBHOOK_ERROR";
    }

    await withClaims(SYSTEM, async db => {
      await db.query(`
        insert into notification.webhook_deliveries(event_id,subscription_id,attempts,status_code,last_error,delivered_at,updated_at)
        values($1,$2,1,$3,$4,$5,now())
        on conflict(event_id,subscription_id) do update set
          attempts=notification.webhook_deliveries.attempts+1,
          status_code=excluded.status_code,
          last_error=excluded.last_error,
          delivered_at=coalesce(notification.webhook_deliveries.delivered_at,excluded.delivered_at),
          updated_at=now()
      `,[task.event_id,task.subscription_id,statusCode,lastError,success ? new Date() : null]);
    });
    if (success) delivered += 1;
  }
  return delivered;
}

export async function processBackgroundWork() {
  const processed = await processOutboxBatch();
  const delivered = await deliverWebhookBatch();
  return { processed, delivered };
}

export function startOutboxWorker() {
  const tick = async () => {
    try {
      const result = await processBackgroundWork();
      if (result.processed || result.delivered) log("info", "background_work", result);
    } catch (error) {
      log("error", "background_worker_failed", { error: error?.message });
    }
  };
  tick();
  return setInterval(tick, 2000);
}
