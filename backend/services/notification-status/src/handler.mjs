import { apiHandler } from "./lib/lambda.mjs";
import { processBackgroundWork } from "./worker.mjs";

export async function handler(event) {
  if (Array.isArray(event?.Records)) return processBackgroundWork();
  if (event?.source === "aws.events" || event?.detailType === "Scheduled Event") return processBackgroundWork();
  return apiHandler(event);
}
