import { getConfig } from "./config.mjs";
import { log } from "./log.mjs";

export async function publishDomainEvent(detailType, detail) {
  const cfg = await getConfig();
  if (cfg.local) return { published: false, reason: "local_outbox_worker" };
  try {
    const { EventBridgeClient, PutEventsCommand } = await import("@aws-sdk/client-eventbridge");
    const client = new EventBridgeClient({});
    const result = await client.send(new PutEventsCommand({ Entries: [{ EventBusName: cfg.eventBusName, Source: "rescue.platform", DetailType: detailType, Detail: JSON.stringify(detail) }] }));
    return { published: (result.FailedEntryCount || 0) === 0 };
  } catch (error) {
    log("warn", "eventbridge_publish_failed_outbox_will_recover", { detailType, error: error?.message });
    return { published: false, reason: "eventbridge_failed" };
  }
}
